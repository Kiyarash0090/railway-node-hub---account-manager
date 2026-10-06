import type { TelegramConfig } from '../types';
import { apiFetch as fetch } from './authApi';

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data?.error || fallback;
  } catch {
    return fallback;
  }
}

async function jsonFetch(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'درخواست ناموفق بود');
  return data;
}

export async function getTelegramConfig(): Promise<TelegramConfig | null> {
  const res = await fetch('/api/telegram/config');
  if (!res.ok) throw new Error(await readError(res, 'دریافت تنظیمات تلگرام ناموفق بود'));
  const data = await res.json();
  return data?.telegram ?? null;
}

export async function saveTelegramConfig(botToken: string, chatId: string): Promise<TelegramConfig> {
  const data = await jsonFetch('/api/telegram/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botToken, chatId }),
  });
  return data.telegram;
}

export async function testTelegramConnection(
  botToken: string,
  chatId: string
): Promise<{ botUsername: string; messageSent: boolean }> {
  return jsonFetch('/api/telegram/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botToken, chatId }),
  });
}

export async function backupToTelegram(): Promise<{ lastBackupAt: string; fileName: string }> {
  return jsonFetch('/api/telegram/backup', { method: 'POST' });
}

export async function restoreFromTelegram(): Promise<void> {
  await jsonFetch('/api/telegram/restore', { method: 'POST' });
}

/** Navigates to the download endpoint — Content-Disposition makes the browser
 *  save the file without leaving the page. */
export function downloadLocalBackup(): void {
  window.location.href = '/api/backup/download';
}

export async function restoreLocalBackup(stateObject: unknown): Promise<void> {
  await jsonFetch('/api/backup/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(stateObject),
  });
}
