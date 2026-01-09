#!/bin/bash

echo "================================"
echo "  JKK Watcher セットアップ"
echo "================================"
echo ""

# Bunがインストールされているかチェック
if ! command -v bun &> /dev/null; then
    echo "⚠️  Bunがインストールされていません"
    echo "📥 Bunを自動インストールします..."
    curl -fsSL https://bun.sh/install | bash

    # Bunのパスを追加
    export PATH="$HOME/.bun/bin:$PATH"

    echo "✅ Bunのインストールが完了しました"
    echo ""
fi

# パッケージをインストール
echo "📦 依存パッケージをインストールしています..."
bun install

# Playwrightブラウザをインストール
echo "🌐 Playwrightブラウザをインストールしています..."
bunx playwright install chromium

echo ""
echo "✅ セットアップ完了！"
echo "🚀 JKK Watcherを起動します..."
echo ""

# アプリケーションを起動
bun run index.ts
