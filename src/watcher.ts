import { loadConfig } from './config';
import { searchAvailableProperty } from './scraper';
import { sendNotification } from './notifier';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface WatcherStatus {
  isRunning: boolean;
  lastCheckTime?: string;
  lastResult?: string;
  totalChecks: number;
}

export interface ProgressEvent {
  step: string;
  message: string;
}

// WebSocketブロードキャスト用のコールバック
let broadcastCallback: ((message: any) => void) | null = null;

export function setBroadcastCallback(callback: (message: any) => void): void {
  broadcastCallback = callback;
}

function broadcast(message: any): void {
  if (broadcastCallback) {
    broadcastCallback(message);
  }
}

export interface LogEntry {
  timestamp: string;
  message: string;
  found: boolean;
  screenshotPath?: string;
}

const STATUS_FILE = join(process.cwd(), 'logs', 'status.json');
const LOG_FILE = join(process.cwd(), 'logs', 'history.json');

let watcherInterval: NodeJS.Timeout | null = null;
let currentStatus: WatcherStatus = {
  isRunning: false,
  totalChecks: 0,
};

/**
 * 監視を開始する
 */
export function startWatcher(): void {
  if (watcherInterval) {
    console.log('監視は既に実行中です');
    return;
  }

  console.log('監視を開始します...');
  currentStatus.isRunning = true;
  saveStatus();

  // ステータス更新をブロードキャスト
  broadcast({
    type: 'status_update',
    data: getStatus(),
  });

  // 即座に1回実行
  executeCheck();

  // 定期実行を設定
  const config = loadConfig();
  watcherInterval = setInterval(() => {
    executeCheck();
  }, config.interval_seconds * 1000);
}

/**
 * 監視を停止する
 */
export function stopWatcher(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }

  currentStatus.isRunning = false;
  saveStatus();
  console.log('監視を停止しました');

  // ステータス更新をブロードキャスト
  broadcast({
    type: 'status_update',
    data: getStatus(),
  });
}

/**
 * 1回のチェックを実行
 */
async function executeCheck(): Promise<void> {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] チェックを開始...`);

  // 進行状況を通知
  broadcast({
    type: 'progress',
    data: { step: 'start', message: 'チェックを開始しています...' },
  });

  try {
    const config = loadConfig();

    broadcast({
      type: 'progress',
      data: { step: 'searching', message: '物件を検索中...' },
    });

    const result = await searchAvailableProperty(config.search, config.headless);

    currentStatus.lastCheckTime = startTime.toISOString();
    currentStatus.lastResult = result.message;
    currentStatus.totalChecks++;

    // ログに記録
    const logEntry = {
      timestamp: startTime.toISOString(),
      message: result.message,
      found: result.found,
      screenshotPath: result.screenshotPath,
    };
    addLog(logEntry);

    // ログ追加をブロードキャスト
    broadcast({
      type: 'log_added',
      data: logEntry,
    });

    if (result.found && result.screenshotPath) {
      // 物件が見つかった場合、メール送信
      broadcast({
        type: 'progress',
        data: { step: 'found', message: '物件が見つかりました！メール送信中...' },
      });

      broadcast({
        type: 'notification',
        data: { type: 'success', message: '空き物件が見つかりました！' },
      });

      try {
        await sendNotification(config.gmail, config.recipients, result.screenshotPath);

        // メール送信成功をログに追加
        const emailLogEntry = {
          timestamp: new Date().toISOString(),
          message: 'メール送信完了。監視を停止しました。',
          found: true,
        };
        addLog(emailLogEntry);

        broadcast({
          type: 'log_added',
          data: emailLogEntry,
        });

        // 監視を停止
        stopWatcher();
        currentStatus.lastResult = '空き物件が見つかりました。メール送信完了。監視を停止しました。';
      } catch (emailError) {
        // メール送信失敗をログに記録
        console.error('メール送信に失敗しました:', emailError);
        const errorLogEntry = {
          timestamp: new Date().toISOString(),
          message: `メール送信に失敗: ${emailError instanceof Error ? emailError.message : String(emailError)}`,
          found: true,
        };
        addLog(errorLogEntry);

        broadcast({
          type: 'log_added',
          data: errorLogEntry,
        });

        broadcast({
          type: 'notification',
          data: { type: 'error', message: 'メール送信に失敗しました' },
        });

        currentStatus.lastResult = `空き物件が見つかりましたが、メール送信に失敗しました: ${emailError instanceof Error ? emailError.message : String(emailError)}`;
      }
    }

    saveStatus();

    // ステータス更新をブロードキャスト
    broadcast({
      type: 'status_update',
      data: getStatus(),
    });

    broadcast({
      type: 'progress',
      data: { step: 'complete', message: 'チェック完了' },
    });

    console.log(`結果: ${result.message}`);

  } catch (error) {
    console.error('チェック中にエラーが発生しました:', error);

    // エラーをログに記録
    const errorLogEntry = {
      timestamp: new Date().toISOString(),
      message: `エラー: ${error instanceof Error ? error.message : String(error)}`,
      found: false,
    };
    addLog(errorLogEntry);

    broadcast({
      type: 'log_added',
      data: errorLogEntry,
    });

    broadcast({
      type: 'notification',
      data: { type: 'error', message: 'チェック中にエラーが発生しました' },
    });

    currentStatus.lastResult = `エラー: ${error instanceof Error ? error.message : String(error)}`;
    saveStatus();

    broadcast({
      type: 'status_update',
      data: getStatus(),
    });

    broadcast({
      type: 'progress',
      data: { step: 'error', message: 'エラーが発生しました' },
    });
  }
}

/**
 * 現在のステータスを取得
 */
export function getStatus(): WatcherStatus {
  return { ...currentStatus };
}

/**
 * ステータスをファイルに保存
 */
function saveStatus(): void {
  try {
    writeFileSync(STATUS_FILE, JSON.stringify(currentStatus, null, 2), 'utf8');
  } catch (error) {
    console.error('ステータスの保存に失敗:', error);
  }
}

/**
 * ログエントリを追加
 */
export function addLog(entry: LogEntry): void {
  try {
    let logs: LogEntry[] = [];

    if (existsSync(LOG_FILE)) {
      const content = readFileSync(LOG_FILE, 'utf8');
      logs = JSON.parse(content);
    }

    logs.unshift(entry); // 最新を先頭に

    // 古いログをクリーンアップ
    logs = cleanupOldLogs(logs);

    writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf8');
  } catch (error) {
    console.error('ログの保存に失敗:', error);
  }
}

/**
 * 古いログをクリーンアップ
 * ルール: 1日以前のログは削除（ただし、物件が見つかったログは保持）
 */
function cleanupOldLogs(logs: LogEntry[]): LogEntry[] {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000; // 24時間前

  return logs.filter(log => {
    const logTime = new Date(log.timestamp).getTime();
    // 物件が見つかった場合は常に保持、それ以外は1日以内のみ
    return log.found || logTime > oneDayAgo;
  });
}

/**
 * ログ履歴を取得
 */
export function getLogs(limit: number = 20): LogEntry[] {
  try {
    if (!existsSync(LOG_FILE)) {
      return [];
    }

    const content = readFileSync(LOG_FILE, 'utf8');
    const logs: LogEntry[] = JSON.parse(content);
    return logs.slice(0, limit);
  } catch (error) {
    console.error('ログの読み込みに失敗:', error);
    return [];
  }
}

/**
 * 手動で1回チェックを実行（監視開始なし）
 */
export async function runOnce(): Promise<void> {
  console.log('手動チェックを実行します...');
  await executeCheck();
}

/**
 * ログ履歴をクリア
 */
export function clearLogs(): void {
  try {
    if (existsSync(LOG_FILE)) {
      writeFileSync(LOG_FILE, JSON.stringify([]), 'utf8');
      console.log('ログ履歴をクリアしました');
    }
  } catch (error) {
    console.error('ログのクリアに失敗:', error);
    throw error;
  }
}