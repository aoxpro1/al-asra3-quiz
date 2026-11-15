@echo off
chcp 65001 >nul
title Al-Asra3 - Stop Server

echo Stopping Al-Asra3 Server and Cloudflare Tunnel...
taskkill /F /IM cloudflared.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1

echo [OK] Server and tunnel stopped successfully!
pause
