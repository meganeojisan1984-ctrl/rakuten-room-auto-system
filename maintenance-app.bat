@echo off
rem ROOM Command Center launcher: start server if not running, then open Edge app window
cd /d E:\rakuten-room-auto-system

curl -s -o nul --max-time 2 http://localhost:3210/api/ping
if errorlevel 1 (
  start "ROOM-HQ-server" /min cmd /c "npx tsx src/maintenance/server.ts"
  ping -n 6 127.0.0.1 >nul
)

start msedge --app=http://localhost:3210/
exit
