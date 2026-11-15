@echo off
chcp 65001 >nul
cd /d "%~dp0"
title الأسرع - تشغيل اللعبة أونلاين عبر Cloudflare

echo ========================================================
echo        الأسرع ^| تشغيل اللعبة أونلاين عبر Cloudflare
echo ========================================================
echo.

echo [1/2] جاري تشغيل سيرفر اللعبة...
start "Al-Asra3 Server" node server.js

timeout /t 2 /nobreak >nul

echo [2/2] جاري فتح نفق Cloudflare الآمن (HTTPS)...
echo.
echo ========================================================
echo  ابحث في الأسطر القادمة عن الرابط الذي ينتهي بـ:
echo  .trycloudflare.com
echo ========================================================
echo.

cloudflared.exe tunnel --url http://127.0.0.1:3000
