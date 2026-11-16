@echo off
chcp 65001 >nul
cd /d "%~dp0"
title الأسرع - تشغيل اللعبة أونلاين عبر Cloudflare

if not exist "node_modules\" (
    echo [!] جاري تثبيت حزم المشروع لأول مرة (يرجى الانتظار)...
    call npm.cmd install
)

if not exist "cloudflared.exe" (
    echo [!] جاري تنزيل أداة Cloudflare Tunnel التلقائية...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
)

node online.js
pause
