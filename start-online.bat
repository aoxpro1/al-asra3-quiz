@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Al-Asra3 - Cloudflare Tunnel

node online.js
pause
