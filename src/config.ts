import yaml from 'js-yaml';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface MadoriConfig {
  madori_1R1K_1LDK: boolean;
  madori_2K_2LDK: boolean;
  madori_3K_3LDK: boolean;
  madori_4K_up: boolean;
}

export interface SearchConfig {
  kana_name: string;
  kaiso_from: string;
  menseki_from: string;
  madori: MadoriConfig;
}

export interface GmailConfig {
  user: string;
  password: string;
}

export interface RecipientsConfig {
  sender: string;
  to: string[];
}

export interface Config {
  interval_seconds: number;
  headless: boolean;
  auto_shutdown: boolean; // ブラウザを閉じたらサーバーも停止
  gmail: GmailConfig;
  recipients: RecipientsConfig;
  search: SearchConfig;
}

const CONFIG_PATH = join(process.cwd(), 'config.yaml');

/**
 * 設定ファイルを読み込む
 */
export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`設定ファイルが見つかりません: ${CONFIG_PATH}`);
  }

  const fileContent = readFileSync(CONFIG_PATH, 'utf8');
  const config = yaml.load(fileContent) as Config;

  // デフォルト値の設定
  if (config.auto_shutdown === undefined) {
    config.auto_shutdown = false;
  }

  // バリデーション
  validateConfig(config);

  return config;
}

/**
 * 設定ファイルを保存する
 */
export function saveConfig(config: Config): void {
  validateConfig(config);
  const yamlContent = yaml.dump(config, {
    indent: 2,
    lineWidth: -1,
  });
  writeFileSync(CONFIG_PATH, yamlContent, 'utf8');
}

/**
 * 設定の妥当性チェック
 */
export function validateConfig(config: Config): void {
  if (!config.gmail?.user || !config.gmail?.password) {
    throw new Error('Gmail設定が不正です');
  }

  if (!config.recipients?.sender || !config.recipients?.to?.length) {
    throw new Error('メール送信先設定が不正です');
  }

  if (!config.search?.kana_name) {
    throw new Error('検索条件が不正です');
  }

  if (config.interval_seconds < 60) {
    throw new Error('監視間隔は60秒以上に設定してください');
  }
}

/**
 * 設定ファイルが存在するかチェック
 */
export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}