@echo off
rem ROOM司令部アプリ ランチャー
rem サーバーが未起動なら起動し、Edgeのアプリウィンドウで開く
cd /d E:\rakuten-room-auto-system

curl -s -o nul --max-time 2 http://localhost:3210/api/ping
if errorlevel 1 (
  start "ROOM司令部サーバー" /min cmd /c "npx tsx src/maintenance/server.ts"
  timeout /t 4 /nobreak >nul
)

start msedge --app=http://localhost:3210/
exit
