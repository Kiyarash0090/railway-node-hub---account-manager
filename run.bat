@echo off
title Android Desktop Controller
echo Starting Android Desktop Controller...
echo Checking dependencies...

if not exist node_modules (
    echo node_modules not found. Installing dependencies...
    npm install
)

echo Starting development server...
:: دستور start برای این است که سرور در پس‌زمینه اجرا شود و اسکریپت متوقف نشود
start /b npm run dev

echo Waiting for server to initialize...
:: ایجاد ۳ ثانیه تأخیر برای آماده شدن سرور
timeout /t 3 /nobreak >nul

echo Opening browser...
:: آدرس پروژه خود را اینجا وارد کنید (مثلاً http://localhost:5173)
start http://localhost:3000

pause