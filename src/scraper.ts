import { chromium, Browser, Page } from 'playwright';
import type { SearchConfig } from './config';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';

/**
 * Playwrightがインストールしたブラウザのパスを取得
 */
function getChromiumExecutablePath(): string | undefined {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    // Windowsの場合、Playwrightのデフォルトインストール先を確認
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    const playwrightPath = join(localAppData, 'ms-playwright');

    if (existsSync(playwrightPath)) {
      // chromium-*ディレクトリを探す
      const fs = require('fs');
      const dirs = fs.readdirSync(playwrightPath).filter((d: string) => d.startsWith('chromium-'));
      if (dirs.length > 0) {
        const chromiumDir = dirs.sort().pop(); // 最新バージョンを使用
        const exePath = join(playwrightPath, chromiumDir, 'chrome-win', 'chrome.exe');
        if (existsSync(exePath)) {
          return exePath;
        }
      }
    }
  }

  return undefined; // 他のプラットフォームはPlaywrightの自動検出に任せる
}

export interface ScrapeResult {
  success: boolean;
  found: boolean;
  message: string;
  screenshotPath?: string;
  error?: string;
}

const LOGS_DIR = join(process.cwd(), 'logs');
const TARGET_URL = 'https://jhomes.to-kousya.or.jp/search/jkknet/service/akiyaJyoukenStartInit';

/**
 * 都営住宅の空き物件を検索する
 */
export async function searchAvailableProperty(
  searchConfig: SearchConfig,
  headless: boolean = true
): Promise<ScrapeResult> {
  // logsディレクトリを作成
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }

  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    console.log('ブラウザを起動しています...');

    const executablePath = getChromiumExecutablePath();
    if (executablePath) {
      console.log(`Chromiumパス: ${executablePath}`);
    }

    browser = await chromium.launch({
      headless: headless,
      timeout: 30000,
      executablePath: executablePath,
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    });

    page = await context.newPage();
    page.setDefaultTimeout(30000);

    console.log('検索ページにアクセスしています...');
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

    // 新しいタブが開くのを待つ
    await page.waitForTimeout(2000);

    const pages = context.pages();
    if (pages.length > 1) {
      page = pages[pages.length - 1];
    }

    // ページがロードされるまで待つ
    await page.waitForLoadState('domcontentloaded');

    console.log('検索条件を入力しています...');

    // 物件名（カナ）を入力
    const propertyInput = await page.waitForSelector('input[name="akiyaInitRM.akiyaRefM.jyutakuKanaName"]');
    await propertyInput.fill(searchConfig.kana_name);

    // 階層を入力
    const kaisoInput = await page.waitForSelector('input[name="akiyaInitRM.akiyaRefM.kaisoFrom"]');
    await kaisoInput.fill(searchConfig.kaiso_from);

    // 床面積を選択
    const mensekiSelect = await page.waitForSelector('select[name="akiyaInitRM.akiyaRefM.mensekiFrom"]');
    await mensekiSelect.selectOption({ label: searchConfig.menseki_from });

    // 間取りのチェックボックスを設定
    const madoriCheckboxes = await page.$$('input[name="akiyaInitRM.akiyaRefM.madoris"]');
    const madoriValues = [
      searchConfig.madori.madori_1R1K_1LDK,
      searchConfig.madori.madori_2K_2LDK,
      searchConfig.madori.madori_3K_3LDK,
      searchConfig.madori.madori_4K_up,
    ];

    for (let i = 0; i < madoriCheckboxes.length && i < madoriValues.length; i++) {
      const checkbox = madoriCheckboxes[i];
      const shouldBeChecked = madoriValues[i];
      const isChecked = await checkbox.isChecked();

      if (isChecked !== shouldBeChecked) {
        await checkbox.click();
      }
    }

    console.log('検索を実行しています...');

    // 検索ボタンをクリック（複数ある場合は最初のものを使用）
    if (!page) {
      throw new Error('ページが初期化されていません');
    }

    // デバッグ: Image1要素の情報を取得
    console.log('Image1要素を検索中...');
    const image1Elements = await page.locator('[name="Image1"]').all();
    console.log(`Image1要素が${image1Elements.length}個見つかりました`);

    for (let i = 0; i < image1Elements.length; i++) {
      const element = image1Elements[i];
      if (element) {
        const isVisible = await element.isVisible();
        const isEnabled = await element.isEnabled();
        const boundingBox = await element.boundingBox();
        console.log(`  要素${i + 1}: visible=${isVisible}, enabled=${isEnabled}, position=${JSON.stringify(boundingBox)}`);
      }
    }

    const searchButton = page.locator('[name="Image1"]').first();
    console.log('検索ボタンをクリックします...');
    await searchButton.click({ timeout: 30000 });
    console.log('検索ボタンのクリックが完了しました');

    // 検索結果を待つ
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // エラーメッセージ（見つかりません）があるかチェック
    try {
      const errorMessage = await page.waitForSelector('.error', { timeout: 3000 });
      if (errorMessage) {
        console.log('検索結果: 該当なし');
        await browser.close();
        return {
          success: true,
          found: false,
          message: '検索中(ヒットなし)...',
        };
      }
    } catch {
      // エラーメッセージが見つからない = 物件が見つかった
    }

    // 物件が見つかった場合、スクリーンショットを保存
    console.log('物件が見つかりました！スクリーンショットを保存しています...');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const screenshotPath = join(LOGS_DIR, `property_${timestamp}.png`);

    // ページ全体のスクリーンショットを撮る
    const totalHeight = await page.evaluate(() => {
      return Math.max(
        document.body.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.clientHeight,
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight
      );
    });

    await page.setViewportSize({ width: 1920, height: totalHeight });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    await browser.close();

    return {
      success: true,
      found: true,
      message: '空きが検索されました。メールを送付して終了します。',
      screenshotPath,
    };

  } catch (error) {
    console.error('スクレイピング中にエラーが発生しました:', error);

    if (browser) {
      await browser.close();
    }

    return {
      success: false,
      found: false,
      message: 'エラーが発生しました',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}