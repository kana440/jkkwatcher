import { loadConfig, saveConfig, type Config } from './config';
import { startWatcher, stopWatcher, getStatus, getLogs, runOnce, clearLogs, addLog, setBroadcastCallback } from './watcher';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { ServerWebSocket } from 'bun';

const PORT = 3000;

// WebSocket接続を管理
const wsConnections = new Set<ServerWebSocket<unknown>>();

/**
 * 全てのWebSocketクライアントにメッセージを送信
 */
export function broadcastToClients(message: any): void {
  const data = JSON.stringify(message);
  for (const ws of wsConnections) {
    ws.send(data);
  }
}

// WatcherからのブロードキャストをWebSocketに接続
setBroadcastCallback(broadcastToClients);

/**
 * Webサーバーを起動
 */
export function startServer(): void {
  console.log(`Webサーバーを起動しています... http://localhost:${PORT}`);

  Bun.serve({
    port: PORT,
    async fetch(req, server) {
      const url = new URL(req.url);

      // WebSocketアップグレードリクエスト
      if (url.pathname === '/ws' && server.upgrade(req)) {
        return; // WebSocketにアップグレード成功
      }

      // CORS対応
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      if (req.method === 'OPTIONS') {
        return new Response(null, { headers });
      }

      // ルーティング
      if (url.pathname === '/') {
        // HTML UIを返す
        const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf8');
        return new Response(html, {
          headers: { ...headers, 'Content-Type': 'text/html' },
        });
      }

      if (url.pathname === '/api/config' && req.method === 'GET') {
        // 設定を取得
        try {
          const config = loadConfig();
          return new Response(JSON.stringify(config), {
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          return new Response(JSON.stringify({ error: '設定の読み込みに失敗しました' }), {
            status: 500,
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }
      }

      if (url.pathname === '/api/config' && req.method === 'POST') {
        // 設定を保存
        try {
          const config = await req.json() as Config;
          saveConfig(config);
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          return new Response(
            JSON.stringify({
              error: error instanceof Error ? error.message : '設定の保存に失敗しました',
            }),
            {
              status: 400,
              headers: { ...headers, 'Content-Type': 'application/json' },
            }
          );
        }
      }

      if (url.pathname === '/api/status' && req.method === 'GET') {
        // ステータスを取得
        const status = getStatus();
        return new Response(JSON.stringify(status), {
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/api/start' && req.method === 'POST') {
        // 監視を開始
        try {
          startWatcher();
          return new Response(JSON.stringify({ success: true, message: '監視を開始しました' }), {
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          return new Response(
            JSON.stringify({
              error: error instanceof Error ? error.message : '監視の開始に失敗しました',
            }),
            {
              status: 500,
              headers: { ...headers, 'Content-Type': 'application/json' },
            }
          );
        }
      }

      if (url.pathname === '/api/stop' && req.method === 'POST') {
        // 監視を停止
        stopWatcher();
        return new Response(JSON.stringify({ success: true, message: '監視を停止しました' }), {
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/api/check' && req.method === 'POST') {
        // 手動チェック（保存済み設定を使用）
        try {
          runOnce();
          return new Response(JSON.stringify({ success: true, message: 'チェックを開始しました' }), {
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          return new Response(
            JSON.stringify({
              error: error instanceof Error ? error.message : 'チェックの実行に失敗しました',
            }),
            {
              status: 500,
              headers: { ...headers, 'Content-Type': 'application/json' },
            }
          );
        }
      }

      if (url.pathname === '/api/check-with-config' && req.method === 'POST') {
        // 手動チェック（指定された設定を使用、保存しない）
        try {
          const config = await req.json() as Config;

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

          return new Response(JSON.stringify({
            success: true,
            message: result.found ? '物件が見つかりました！' : 'チェックを完了しました'
          }), {
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          return new Response(
            JSON.stringify({
              error: error instanceof Error ? error.message : 'チェックの実行に失敗しました',
            }),
            {
              status: 500,
              headers: { ...headers, 'Content-Type': 'application/json' },
            }
          );
        }
      }

      if (url.pathname === '/api/logs' && req.method === 'GET') {
        // ログを取得
        const limit = parseInt(url.searchParams.get('limit') || '20');
        const logs = getLogs(limit);
        return new Response(JSON.stringify(logs), {
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/api/logs' && req.method === 'DELETE') {
        // ログをクリア
        try {
          clearLogs();
          return new Response(JSON.stringify({ success: true, message: 'ログをクリアしました' }), {
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          return new Response(
            JSON.stringify({
              error: error instanceof Error ? error.message : 'ログのクリアに失敗しました',
            }),
            {
              status: 500,
              headers: { ...headers, 'Content-Type': 'application/json' },
            }
          );
        }
      }

      if (url.pathname.startsWith('/api/screenshot/') && req.method === 'GET') {
        // スクリーンショットを取得
        const filename = url.pathname.replace('/api/screenshot/', '');
        const screenshotPath = join(process.cwd(), 'logs', filename);

        if (existsSync(screenshotPath)) {
          const image = readFileSync(screenshotPath);
          return new Response(image, {
            headers: { ...headers, 'Content-Type': 'image/png' },
          });
        } else {
          return new Response('Not Found', { status: 404, headers });
        }
      }

      return new Response('Not Found', { status: 404, headers });
    },
    websocket: {
      open(ws) {
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
      },
      message(ws, message) {
        // クライアントからのメッセージを処理
        try {
          const data = JSON.parse(message.toString());
          console.log('WebSocketメッセージ受信:', data);

          // 必要に応じてメッセージタイプごとに処理を追加
          if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch (error) {
          console.error('WebSocketメッセージ処理エラー:', error);
        }
      },
      close(ws) {
        wsConnections.delete(ws);
        console.log(`WebSocket接続切断 (残り接続数: ${wsConnections.size})`);

        // auto_shutdownが有効で、全ての接続が切断された場合はサーバーを停止
        if (wsConnections.size === 0) {
          try {
            const config = loadConfig();
            if (config.auto_shutdown) {
              console.log('\n⚠️ 全てのクライアント接続が切断されました');
              console.log('auto_shutdown設定が有効のため、サーバーを停止します...');

              // 監視が動いていれば停止
              stopWatcher();

              // 少し待ってからプロセスを終了
              setTimeout(() => {
                console.log('👋 サーバーを終了します');
                process.exit(0);
              }, 1000);
            }
          } catch (error) {
            console.error('auto_shutdown処理エラー:', error);
          }
        }
      },
    },
  });

  console.log(`✅ サーバーが起動しました: http://localhost:${PORT}`);

  // ブラウザを自動で開く
  if (process.platform === 'darwin') {
    Bun.spawn(['open', `http://localhost:${PORT}`]);
  } else if (process.platform === 'win32') {
    Bun.spawn(['cmd', '/c', 'start', `http://localhost:${PORT}`]);
  }
}
