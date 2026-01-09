@echo off
@chcp 65001 > nul
@echo ================================
@echo   JKK Watcher セットアップ
@echo ================================
@echo.

@REM Bunがインストールされているかチェック
@where bun >nul 2>nul
@if %errorlevel% neq 0 (
    @echo [WARNING] Bunがインストールされていません
    @echo [INFO] Bunを自動インストールします...
    @powershell -c "irm bun.sh/install.ps1 | iex"
    @echo [OK] Bunのインストールが完了しました
    @echo.
)

@REM Node.jsがインストールされているかチェック（Playwright用）
@where node >nul 2>nul
@if %errorlevel% neq 0 (
    @echo [WARNING] Node.jsがインストールされていません
    @echo [INFO] PlaywrightにはNode.jsが必要です
    @echo [INFO] https://nodejs.org/ からインストールしてください
    @pause
    @exit /b 1
)

@REM パッケージをインストール
@echo [INFO] 依存パッケージをインストールしています...
@call bun install >nul 2>&1

@REM Playwrightブラウザをインストール
@echo [INFO] Playwrightブラウザをインストールしています...
@call npx playwright install chromium >nul 2>&1

@echo.
@echo [OK] セットアップ完了！
@echo [INFO] JKK Watcherを起動します...
@echo.

@REM アプリケーションを起動（PlaywrightはNode.jsで実行）
@call npx ts-node index.ts

@pause
