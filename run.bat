@echo off
chcp 65001 > nul
echo ================================
echo   JKK Watcher セットアップ
echo ================================
echo.

REM Node.jsがインストールされているかチェック
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.jsがインストールされていません
    echo [INFO] https://nodejs.org/ からインストールしてください
    pause
    exit /b 1
)

REM パッケージをインストール
echo [INFO] 依存パッケージをインストールしています...
call npm install

REM Playwrightブラウザをインストール
echo [INFO] Playwrightブラウザをインストールしています...
call npx playwright install chromium

echo.
echo [OK] セットアップ完了！
echo [INFO] JKK Watcherを起動します...
echo.

REM アプリケーションを起動
call npm start

pause
