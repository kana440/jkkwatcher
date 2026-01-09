@echo off
chcp 65001 > nul
echo ================================
echo   JKK Watcher セットアップ
echo ================================
echo.

REM Bunがインストールされているかチェック
where bun >nul 2>nul
if %errorlevel% neq 0 (
    echo ⚠️  Bunがインストールされていません
    echo 📥 Bunを自動インストールします...
    powershell -c "irm bun.sh/install.ps1 | iex"
    echo ✅ Bunのインストールが完了しました
    echo.
)

REM パッケージをインストール
echo 📦 依存パッケージをインストールしています...
call bun install

REM Playwrightブラウザをインストール
echo 🌐 Playwrightブラウザをインストールしています...
call bunx playwright install chromium

echo.
echo ✅ セットアップ完了！
echo 🚀 JKK Watcherを起動します...
echo.

REM アプリケーションを起動
call bun run index.ts

pause
