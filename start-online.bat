@echo off
chcp 65001 >nul
title Al-Asra3 - Cloudflare Tunnel

echo ========================================================
echo        Al-Asra3 ^| Online Free via Cloudflare Tunnel
echo ========================================================
echo.
echo [1/2] Starting Node.js server...
start "Node.js Server" /B node server.js

timeout /t 2 /nobreak >nul

echo [2/2] Launching Cloudflare Tunnel...
echo.
echo Look for the URL below ending in .trycloudflare.com
echo.

.\cloudflared.exe tunnel --url http://localhost:3000
