@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Al-Asra3 - Cloudflare Tunnel

echo ========================================================
echo        Al-Asra3 ^| Online via Cloudflare Tunnel
echo ========================================================
echo.

echo [1/2] Starting Node.js server...
start "Al-Asra3 Server" node server.js

timeout /t 2 /nobreak >nul

echo [2/2] Launching Cloudflare Tunnel...
echo.
echo Look for the URL below ending in .trycloudflare.com
echo.

cloudflared.exe tunnel --url http://127.0.0.1:3000
