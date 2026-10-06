import fs from 'fs';
import path from 'path';
import type { TelegramConfig } from '../types';

export interface HubState {
  accounts: unknown[];
  alerts: unknown[];
  updatedAt: string | null;
}

export function stateFilePath(): string {
  return process.env.STATE_FILE_PATH || path.resolve(process.cwd(), 'data', 'hub-state.json');
}

/** Raw file read (no field filtering). */
export function readRawState(): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(stateFilePath(), 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readState(): HubState | null {
  const data = readRawState();
  if (!data) return null;
  return {
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
    alerts: Array.isArray(data.alerts) ? data.alerts : [],
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
  };
}

function isTelegramConfig(value: unknown): value is TelegramConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.botToken === 'string' && typeof v.chatId === 'string';
}

export function readTelegram(): TelegramConfig | null {
  const data = readRawState();
  if (!data || !isTelegramConfig(data.telegram)) return null;
  return data.telegram;
}

function persist(full: Record<string, unknown>): void {
  const file = stateFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Atomic write: a refresh that reads mid-write must never see a truncated
  // JSON (that empty parse used to cascade into wiping the whole state).
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(full, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function writeState(input: { accounts: unknown[]; alerts: unknown[] }): HubState {
  const prev = readRawState();
  const updatedAt = new Date().toISOString();
  persist({
    accounts: input.accounts,
    alerts: input.alerts,
    // The client PUTs {accounts, alerts} on every change; keep the telegram
    // block across those rewrites or config/backup metadata is wiped within
    // a second of being saved.
    ...(prev && prev.telegram !== undefined ? { telegram: prev.telegram } : {}),
    updatedAt,
  });
  return { accounts: input.accounts, alerts: input.alerts, updatedAt };
}

export function writeTelegram(cfg: TelegramConfig): TelegramConfig {
  const prev = readRawState() || {};
  persist({ ...prev, telegram: cfg, updatedAt: new Date().toISOString() });
  return cfg;
}

/** Replace accounts/alerts with a backup. A safety copy of the current file
 *  is kept next to it; telegram connection settings survive restores that
 *  predate the feature (backup has no `telegram` key). */
export function restoreState(input: {
  accounts: unknown[];
  alerts: unknown[];
  telegram?: unknown;
}): HubState {
  const file = stateFilePath();
  const prev = readRawState();

  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, `${file}.pre-restore.json`);
    } catch {
      // Snapshot is best-effort — never block the restore on it.
    }
  }

  const telegram =
    isTelegramConfig(input.telegram) && input.telegram
      ? input.telegram
      : prev && isTelegramConfig(prev.telegram)
        ? prev.telegram
        : undefined;

  const updatedAt = new Date().toISOString();
  persist({
    accounts: input.accounts,
    alerts: input.alerts,
    ...(telegram ? { telegram } : {}),
    updatedAt,
  });
  return { accounts: input.accounts, alerts: input.alerts, updatedAt };
}
