#!/usr/bin/env node
/**
 * Playwright スクレイパーを Node.js で実行するためのラッパー
 * Windows環境でBunがPlaywrightを正しく起動できない問題の回避策
 */

import { chromium } from 'playwright';
import type { SearchConfig } from './config';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

interface ScrapeResult {
  success: boolean;
  found: boolean;
  message: string;
  screenshotPath?: string;
  error?: string;
}

const LOGS_DIR = join(process.cwd(), 'logs');
const TARGET_URL = 'https://jhomes.to-kousya.or.jp/search/jkknet/service/akiyaJyoukenStartInit';

async function searchAvailableProperty(
  searchConfig: SearchConfig,
  headless: boolean = true
): Promise<ScrapeResult> {
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }

  let browser = null;
  let page = null;

  try {
    console.log('ブラウザを起動しています...');

    browser = await chromium.launch({
      headless: headless,
      timeout: 30000,
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    });

    page = await context.newPage();
    page.setDefaultTimeout(30000);

    console.log('検索ページにアクセスしています...');
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);

    const pages = context.pages();
    if (pages.length > 1) {
      page = pages[pages.length - 1]!;
    }

    await page.waitForLoadState('domcontentloaded');

    console.log('検索条件を入力しています...');

    const propertyInput = await page.waitForSelector('input[name="akiyaInitRM.akiyaRefM.jyutakuKanaName"]');
    await propertyInput!.fill(searchConfig.kana_name);

    const kaisoInput = await page.waitForSelector('input[name="akiyaInitRM.akiyaRefM.kaisoFrom"]');
    await kaisoInput!.fill(searchConfig.kaiso_from);

    const mensekiSelect = await page.waitForSelector('select[name="akiyaInitRM.akiyaRefM.mensekiFrom"]');
    await mensekiSelect!.selectOption({ label: searchConfig.menseki_from });

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
      const isChecked = await checkbox!.isChecked();

      if (isChecked !== shouldBeChecked) {
        await checkbox!.click();
      }
    }

    console.log('検索を実行しています...');

    const searchButton = page.locator('[name="Image1"]').first();
    await searchButton.click({ timeout: 30000 });

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

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

    console.log('物件が見つかりました！スクリーンショットを保存しています...');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const screenshotPath = join(LOGS_DIR, `property_${timestamp}.png`);

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

// メイン処理
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node scraper-runner.js <config-json> [headless]');
    process.exit(1);
  }

  const searchConfig: SearchConfig = JSON.parse(args[0]);
  const headless = args[1] !== 'false';

  const result = await searchAvailableProperty(searchConfig, headless);

  // 結果をJSONで標準出力
  console.log('__RESULT_START__');
  console.log(JSON.stringify(result));
  console.log('__RESULT_END__');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});