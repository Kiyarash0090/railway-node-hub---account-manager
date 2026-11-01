# Railway Node Hub & Account Manager

سامانه مدیریت متمرکز چند اکانته نودها و سرویس‌های Railway همراه با پایش زنده منابع، لاگ‌های لایو، دپلوی هوشمند و پشتیبان‌گیری تلگرام.

Comprehensive multi-account manager for Railway nodes with live logs, real-time resource metrics, budget guard auto-shutdown, deployment engine, and Telegram backup integration.

---

## 🚀 راهنمای نصب و اجرا (Local Development)

### پیش‌نیازها (Prerequisites)
- **Node.js**: نسخه 18 یا بالاتر

### مراحل اجرا:
1. **نصب وابستگی‌ها:**
   ```bash
   npm install
   ```
2. **تنظیم فایل تنظیمات محلی:**
   فایل `.env.example` را به `.env` یا `.env.local` کپی کرده و در صورت نیاز مقادیر متغیرها را تنظیم کنید:
   ```bash
   cp .env.example .env
   ```
3. **اجرای برنامه در حالت توسعه:**
   ```bash
   npm run dev
   ```
   برنامه در آدرس `http://localhost:3000` در دسترس خواهد بود.

---

## 📦 راهنمای انتشار و ساخت حافظه Volume در Railway

هنگام دپلوی این برنامه روی ریلوی (Railway):

1. **ساخت Volume برای ماندگاری اطلاعات:**
   در پنل ریلوی، روی سرویس خود کلیک کرده و یک **Volume** ایجاد کنید و مسیر آن را `/data` قرار دهید (`Mount Path: /data`).
2. **تنظیم متغیرهای محیطی (Environment Variables):**
   متغیرهای زیر را در قسمت Variables اضافه کنید:
   - `AUTH_FILE_PATH=/data/auth.json`
   - `STATE_FILE_PATH=/data/hub-state.json`
   - `NODE_ENV=production`
   - `PORT=3000` (اختیاری)
3. **ورود اولیه:**
   در اولین ورود، فرم تعریف نام‌کاربری و رمزعبور مدیر نمایش داده می‌شود. اطلاعات حساب شما درون Volume در فایل `/data/auth.json` به‌صورت هش‌شده ذخیره می‌گردد و با ری‌استارت یا دپلوی مجدد پاک نخواهد شد.

---

## 🛠 فناوری‌های استفاده‌شده (Tech Stack)
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons, Motion (Framer Motion)
- **Backend**: Express.js (TypeScript), Server-side State Store with File Persistence
- **Integration**: Railway GraphQL API, Telegram Bot Backup API

