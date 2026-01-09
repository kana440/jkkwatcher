import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { loadConfig, saveConfig, type Config } from './config';
import { startWatcher, stopWatcher, getStatus, getLogs, runOnce, clearLogs, addLog, setBroadcastCallback } from './watcher';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';

const PORT = 3000;

// WebSocket接続を管理
const wsConnections = new Set<WebSocket>();

/**
 * 全てのWebSocketクライアントにメッセージを送信
 */
export function broadcastToClients(message: any): void {
  const data = JSON.stringify(message);
  for (const ws of wsConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// WatcherからのブロードキャストをWebSocketに接続
setBroadcastCallback(broadcastToClients);

/**
 * Webサーバーを起動
 */
export function startServer(): void {
  console.log(`Webサーバーを起動しています... http://localhost:${PORT}`);

  const app = express();
  app.use(express.json());

  // CORS対応
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // HTML UIを返す
  app.get('/', (req, res) => {
    const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf8');
    res.type('html').send(html);
  });

  // 設定を取得
  app.get('/api/config', (req, res) => {
    try {
      const config = loadConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: '設定の読み込みに失敗しました' });
    }
  });

  // 設定を保存
  app.post('/api/config', (req, res) => {
    try {
      const config = req.body as Config;
      saveConfig(config);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : '設定の保存に失敗しました',
      });
    }
  });

  // ステータスを取得
  app.get('/api/status', (req, res) => {
    const status = getStatus();
    res.json(status);
  });

  // 監視を開始
  app.post('/api/start', (req, res) => {
    try {
      startWatcher();
      res.json({ success: true, message: '監視を開始しました' });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : '監視の開始に失敗しました',
      });
    }
  });

  // 監視を停止
  app.post('/api/stop', (req, res) => {
    stopWatcher();
    res.json({ success: true, message: '監視を停止しました' });
  });

  // 手動チェック（保存済み設定を使用）
  app.post('/api/check', (req, res) => {
    try {
      runOnce();
      res.json({ success: true, message: 'チェックを開始しました' });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'チェックの実行に失敗しました',
      });
    }
  });

  // 手動チェック（指定された設定を使用、保存しない）
  app.post('/api/check-with-config', async (req, res) => {
    try {
      const config = req.body as Config;

      // バリデーションを実行（保存はしない）
      const { validateConfig } = await import('./config');
      validateConfig(config);

      // 一時的にこの設定でチェックを実行
      const { searchAvailableProperty } = await import('./scraper');
      const result = await searchAvailableProperty(config.search, config.headless);

      // ログに記録
      addLog({
        timestamp: new Date().toISOString(),
        message: result.message,
        found: result.found,
        screenshotPath: result.screenshotPath,
      });

      res.json({
        success: true,
        message: result.found ? '物件が見つかりました！' : 'チェックを完了しました'
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'チェックの実行に失敗しました',
      });
    }
  });

  // ログを取得
  app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit as string || '20');
    const logs = getLogs(limit);
    res.json(logs);
  });

  // ログをクリア
  app.delete('/api/logs', (req, res) => {
    try {
      clearLogs();
      res.json({ success: true, message: 'ログをクリアしました' });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'ログのクリアに失敗しました',
      });
    }
  });

  // スクリーンショットを取得
  app.get('/api/screenshot/:filename', (req, res) => {
    const screenshotPath = join(process.cwd(), 'logs', req.params.filename);

    if (existsSync(screenshotPath)) {
      const image = readFileSync(screenshotPath);
      res.type('png').send(image);
    } else {
      res.status(404).send('Not Found');
    }
  });

  // HTTPサーバーを作成
  const server = createServer(app);

  // WebSocketサーバーを作成
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    wsConnections.add(ws);
    console.log(`WebSocket接続確立 (接続数: ${wsConnections.size})`);

    // 初期状態を送信
    ws.send(JSON.stringify({
      type: 'initial_state',
      data: {
        status: getStatus(),
        logs: getLogs(100),
      },
    }));

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('WebSocketメッセージ受信:', data);

        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (error) {
        console.error('WebSocketメッセージ処理エラー:', error);
      }
    });

    ws.on('close', () => {
      wsConnections.delete(ws);
      console.log(`WebSocket接続切断 (残り接続数: ${wsConnections.size})`);

      // auto_shutdownが有効で、全ての接続が切断された場合はサーバーを停止
      if (wsConnections.size === 0) {
        try {
          const config = loadConfig();
          if (config.auto_shutdown) {
            console.log('\n全てのクライアント接続が切断されました');
            console.log('auto_shutdown設定が有効のため、サーバーを停止します...');

            // 監視が動いていれば停止
            stopWatcher();

            // 少し待ってからプロセスを終了
            setTimeout(() => {
              console.log('サーバーを終了します');
              process.exit(0);
            }, 1000);
          }
        } catch (error) {
          console.error('auto_shutdown処理エラー:', error);
        }
      }
    });
  });

  // サーバーを起動
  server.listen(PORT, () => {
    console.log(`サーバーが起動しました: http://localhost:${PORT}`);

    // ブラウザを自動で開く
    const url = `http://localhost:${PORT}`;
    if (process.platform === 'darwin') {
      exec(`open ${url}`);
    } else if (process.platform === 'win32') {
      exec(`start ${url}`);
    } else {
      exec(`xdg-open ${url}`);
    }
  });
}
