@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Al-Asra3 - Cloudflare Tunnel

if not exist "node_modules\" (
    echo [!] Installing dependencies for the first time...
    call npm.cmd install
)

if not exist "cloudflared.exe" (
    echo [!] Downloading Cloudflare Tunnel tool...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
)

node online.js
pause
