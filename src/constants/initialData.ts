import { RailwayAccount, LogEntry } from '../types';

export type TemplateDeployMethod = 'github' | 'image' | 'empty';

export interface ServiceTemplate {
  id: 'nodejs' | 'python' | 'telegram-bot' | 'nextjs' | 'postgres' | 'redis' | 'docker' | 'custom';
  name: string;
  description: string;
  icon: string;
  deployMethod: TemplateDeployMethod;
  repo?: string;
  branch?: string;
  image?: string;
  defaultPort: number;
  defaultImage: string;
  defaultEnv: Record<string, string>;
}

export const TEMPLATES: ServiceTemplate[] = [
  {
    id: 'nodejs',
    name: 'Node.js Express API',
    description: 'ریپوی واقعی Express REST Boilerplate — استقرار مستقیم از گیت‌هاب',
    icon: '⚡',
    deployMethod: 'github',
    repo: 'danielfsousa/express-rest-boilerplate',
    branch: 'main',
    defaultPort: 3000,
    defaultImage: 'node:20-alpine',
    defaultEnv: { NODE_ENV: 'production', PORT: '3000' },
  },
  {
    id: 'python',
    name: 'Python FastAPI',
    description: 'ریپوی واقعی FastAPI Web Starter با uvicorn و Procfile آماده ریلوی',
    icon: '🐍',
    deployMethod: 'github',
    repo: 'shinokada/fastapi-web-starter',
    branch: 'main',
    defaultPort: 8000,
    defaultImage: 'python:3.11-slim',
    defaultEnv: { ENVIRONMENT: 'production' },
  },
  {
    id: 'telegram-bot',
    name: 'Python Telegram Bot',
    description: 'ریپوی واقعی ربات تلگرام با python-telegram-bot و وب‌سرور Starlette',
    icon: '🤖',
    deployMethod: 'github',
    repo: 'hethon/ptb-starlette-starter',
    branch: 'master',
    defaultPort: 8000,
    defaultImage: 'python:3.11-slim',
    defaultEnv: { BOT_TOKEN: '', ENVIRONMENT: 'production' },
  },
  {
    id: 'nextjs',
    name: 'Next.js App',
    description: 'ریپوی رسمی nextjs/saas-starter — فریمورک فول‌استک با SSR',
    icon: '▲',
    deployMethod: 'github',
    repo: 'nextjs/saas-starter',
    branch: 'main',
    defaultPort: 3000,
    defaultImage: 'ghcr.io/vercel/next.js:latest',
    defaultEnv: { NODE_ENV: 'production' },
  },
  {
    id: 'postgres',
    name: 'PostgreSQL Database',
    description: 'ایمیج رسمی postgres:16-alpine از Docker Hub با متغیرهای واقعی',
    icon: '🐘',
    deployMethod: 'image',
    image: 'postgres:16-alpine',
    defaultPort: 5432,
    defaultImage: 'postgres:16-alpine',
    defaultEnv: {
      POSTGRES_DB: 'railway',
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: 'secure_password_123',
    },
  },
  {
    id: 'redis',
    name: 'Redis Cache & Queue',
    description: 'ایمیج رسمی redis:7-alpine از Docker Hub — کش و صف پردازش',
    icon: '🔴',
    deployMethod: 'image',
    image: 'redis:7-alpine',
    defaultPort: 6379,
    defaultImage: 'redis:7-alpine',
    defaultEnv: {},
  },
  {
    id: 'custom',
    name: 'سرویس خالی (Empty Service)',
    description: 'ساخت سرویس خالی واقعی روی ریلوی برای آپلود دستی یا اتصال ریپوی دلخواه',
    icon: '🐳',
    deployMethod: 'empty',
    defaultPort: 80,
    defaultImage: 'custom-repository',
    defaultEnv: {},
  },
];

export const INITIAL_ACCOUNTS: RailwayAccount[] = [];
export const INITIAL_LOGS: LogEntry[] = [];
