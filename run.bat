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

@REM パッケージをインストール
@echo [INFO] 依存パッケージをインストールしています...
@call bun install >nul 2>&1

@REM Playwrightブラウザをインストール
@echo [INFO] Playwrightブラウザをインストールしています...
@call bunx playwright install chromium >nul 2>&1

@echo.
@echo [OK] セットアップ完了！
@echo [INFO] JKK Watcherを起動します...
@echo.

@REM アプリケーションを起動
@call bun run index.ts

@pause
