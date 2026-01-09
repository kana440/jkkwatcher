import { startServer } from './src/server';
import { $ } from 'bun';

console.log(`
╔══════════════════════════════════════╗
║   JKK Watcher - 都営住宅監視システム   ║
╚══════════════════════════════════════╝
`);

const PORT = 3000;

/**
 * ポート3000を使用しているプロセスをチェック
 */
async function checkPortInUse(): Promise<{ inUse: boolean; pid?: number; isOurProcess?: boolean }> {
  try {
    // lsofコマンドでポート3000を使用しているプロセスを確認
    const result = await $`lsof -ti:${PORT}`.quiet().nothrow();

    if (result.exitCode !== 0 || !result.stdout.toString().trim()) {
      return { inUse: false };
    }

    const pid = parseInt(result.stdout.toString().trim());

    // プロセス情報を取得
    const processInfo = await $`ps -p ${pid} -o command=`.quiet().nothrow();

    if (processInfo.exitCode === 0) {
      const command = processInfo.stdout.toString().trim();
      // JKK Watcherのプロセスかチェック
      const isOurProcess = command.includes('index.ts') || command.includes('jkkwatcher');
      return { inUse: true, pid, isOurProcess };
    }

    return { inUse: true, pid };
  } catch (error) {
    // lsofが使えない環境の場合はスキップ
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

  // 標準入力から読み取り
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
    console.log('🔄 既存プロセスを停止しています...');
    await $`kill ${pid}`.quiet().nothrow();
    await Bun.sleep(2000);

    // まだ動いているか確認
    const stillRunning = await $`lsof -ti:${PORT}`.quiet().nothrow();
    if (stillRunning.exitCode === 0 && stillRunning.stdout.toString().trim()) {
      console.log('⚠️  プロセスが停止しないため、強制終了します...');
      await $`kill -9 ${pid}`.quiet().nothrow();
      await Bun.sleep(1000);
    }

    console.log('✅ 既存プロセスを停止しました');
    return true;
  } catch (error) {
    console.error('❌ プロセスの停止に失敗しました:', error);
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
      console.log(`⚠️  JKK Watcherは既に起動中です (PID: ${portCheck.pid})`);
      console.log();

      const choice = await promptUser('選択してください:', [
        'そのまま継続（新しく起動しない）',
        '再起動（既存プロセスを停止して新しく起動）',
        'キャンセル',
      ]);

      switch (choice) {
        case '1':
          console.log('✅ 既存のプロセスを継続します');
          console.log(`🌐 ブラウザで http://localhost:${PORT} を開いてください`);
          process.exit(0);

        case '2':
          const killed = await killProcess(portCheck.pid!);
          if (!killed) {
            console.log('❌ プロセスの停止に失敗しました');
            process.exit(1);
          }
          console.log('🚀 JKK Watcherを起動します...');
          console.log();
          break;

        case '3':
          console.log('❌ キャンセルしました');
          process.exit(0);

        default:
          console.log('❌ 無効な選択です');
          process.exit(1);
      }
    } else {
      console.log(`⚠️  ポート${PORT}は別のプログラムが使用中です (PID: ${portCheck.pid})`);
      console.log();

      const choice = await promptUser('このプロセスを停止しますか?', [
        'はい（停止して起動）',
        'いいえ（キャンセル）',
      ]);

      if (choice === '1') {
        const killed = await killProcess(portCheck.pid!);
        if (!killed) {
          console.log('❌ プロセスの停止に失敗しました');
          process.exit(1);
        }
        console.log('🚀 JKK Watcherを起動します...');
        console.log();
      } else {
        console.log('❌ キャンセルしました');
        process.exit(0);
      }
    }
  } else {
    console.log('🚀 JKK Watcherを起動します...');
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