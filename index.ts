import { startServer } from './src/server';
import { exec } from 'child_process';

console.log(`
==================================
  JKK Watcher - 都営住宅監視システム
==================================
`);

const PORT = 3000;

/**
 * sleep関数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * コマンドを実行してPromiseを返す
 */
function execCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: error ? error.code || 1 : 0,
      });
    });
  });
}

/**
 * ポート3000を使用しているプロセスをチェック
 */
async function checkPortInUse(): Promise<{ inUse: boolean; pid?: number; isOurProcess?: boolean }> {
  try {
    const isWindows = process.platform === 'win32';

    if (isWindows) {
      // Windowsの場合
      const result = await execCommand(`netstat -ano | findstr :${PORT}`);
      if (result.exitCode !== 0 || !result.stdout.trim()) {
        return { inUse: false };
      }

      // PIDを抽出
      const lines = result.stdout.trim().split('\n');
      for (const line of lines) {
        if (line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1] || '0');
          if (!isNaN(pid)) {
            return { inUse: true, pid };
          }
        }
      }
      return { inUse: false };
    } else {
      // macOS/Linuxの場合
      const result = await execCommand(`lsof -ti:${PORT}`);

      if (result.exitCode !== 0 || !result.stdout.trim()) {
        return { inUse: false };
      }

      const pid = parseInt(result.stdout.trim());

      // プロセス情報を取得
      const processInfo = await execCommand(`ps -p ${pid} -o command=`);

      if (processInfo.exitCode === 0) {
        const command = processInfo.stdout.trim();
        const isOurProcess = command.includes('index.ts') || command.includes('jkkwatcher');
        return { inUse: true, pid, isOurProcess };
      }

      return { inUse: true, pid };
    }
  } catch (error) {
    return { inUse: false };
  }
}

/**
 * ユーザーに選択肢を提示
 */
async function promptUser(message: string, choices: string[]): Promise<string> {
  console.log(message);
  choices.forEach((choice, index) => {
    console.log(`  ${index + 1}) ${choice}`);
  });
  console.log();

  const input = await new Promise<string>((resolve) => {
    process.stdin.once('data', (data) => {
      resolve(data.toString().trim());
    });
  });

  return input;
}

/**
 * プロセスを停止
 */
async function killProcess(pid: number): Promise<boolean> {
  try {
    console.log('既存プロセスを停止しています...');
    const isWindows = process.platform === 'win32';

    if (isWindows) {
      await execCommand(`taskkill /PID ${pid} /F`);
    } else {
      await execCommand(`kill ${pid}`);
    }

    await sleep(2000);

    // まだ動いているか確認
    const stillRunning = await checkPortInUse();
    if (stillRunning.inUse) {
      console.log('プロセスが停止しないため、強制終了します...');
      if (isWindows) {
        await execCommand(`taskkill /PID ${pid} /F`);
      } else {
        await execCommand(`kill -9 ${pid}`);
      }
      await sleep(1000);
    }

    console.log('既存プロセスを停止しました');
    return true;
  } catch (error) {
    console.error('プロセスの停止に失敗しました:', error);
    return false;
  }
}

/**
 * メイン処理
 */
async function main() {
  const portCheck = await checkPortInUse();

  if (portCheck.inUse) {
    if (portCheck.isOurProcess) {
      console.log(`JKK Watcherは既に起動中です (PID: ${portCheck.pid})`);
      console.log();

      const choice = await promptUser('選択してください:', [
        'そのまま継続（新しく起動しない）',
        '再起動（既存プロセスを停止して新しく起動）',
        'キャンセル',
      ]);

      switch (choice) {
        case '1':
          console.log('既存のプロセスを継続します');
          console.log(`ブラウザで http://localhost:${PORT} を開いてください`);
          process.exit(0);

        case '2':
          const killed = await killProcess(portCheck.pid!);
          if (!killed) {
            console.log('プロセスの停止に失敗しました');
            process.exit(1);
          }
          console.log('JKK Watcherを起動します...');
          console.log();
          break;

        case '3':
          console.log('キャンセルしました');
          process.exit(0);

        default:
          console.log('無効な選択です');
          process.exit(1);
      }
    } else {
      console.log(`ポート${PORT}は別のプログラムが使用中です (PID: ${portCheck.pid})`);
      console.log();

      const choice = await promptUser('このプロセスを停止しますか?', [
        'はい（停止して起動）',
        'いいえ（キャンセル）',
      ]);

      if (choice === '1') {
        const killed = await killProcess(portCheck.pid!);
        if (!killed) {
          console.log('プロセスの停止に失敗しました');
          process.exit(1);
        }
        console.log('JKK Watcherを起動します...');
        console.log();
      } else {
        console.log('キャンセルしました');
        process.exit(0);
      }
    }
  } else {
    console.log('JKK Watcherを起動します...');
    console.log();
  }

  // Webサーバーを起動
  startServer();
}

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('\nサーバーを終了しています...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nサーバーを終了しています...');
  process.exit(0);
});

// メイン処理を実行
main().catch((error) => {
  console.error('起動中にエラーが発生しました:', error);
  process.exit(1);
});
