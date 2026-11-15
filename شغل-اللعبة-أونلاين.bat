@echo off
chcp 65001 >nul
title الأسرع - تشغيل اللعبة أونلاين عبر Cloudflare

echo ========================================================
echo        الأسرع ^| تشغيل اللعبة أونلاين مجاناً عبر Cloudflare
echo ========================================================
echo.
echo [1/2] جاري تشغيل سيرفر اللعبة...
start "سيرفر اللعبة (Node.js)" /B node server.js

timeout /t 2 /nobreak >nul

echo [2/2] جاري فتح نفق Cloudflare الآمن (HTTPS)...
echo.
echo ========================================================
echo  ابحث في الأسطر التالية عن رابط يبدأ بـ:
echo  https://xxxx.trycloudflare.com
echo  انسخه وافتحه من أي جهاز في العالم!
echo ========================================================
echo.

.\cloudflared.exe tunnel --url http://localhost:3000
