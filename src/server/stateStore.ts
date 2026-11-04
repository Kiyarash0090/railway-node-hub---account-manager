import fs from 'fs';
import path from 'path';
import type { BotMonitorSnapshot, TelegramConfig } from '../types';

export interface HubState {
  accounts: unknown[];
  alerts: unknown[];
  updatedAt: string | null;
}

/** In-process mutex so bot mutations and web PUTs never clobber each other.
 *  `fn` receives the raw state object and returns the mutated `accounts` array
 *  (or the full object); the result is atomically persisted under the lock. */
let stateLock: Promise<void> = Promise.resolve();

export async function mutateState<T>(fn: (raw: Record<string, unknown>) => T): Promise<T> {
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  const prev = stateLock;
  stateLock = next;
  await prev;
  try {
    const raw = { ...(readRawState() || {}) };
    const result = fn(raw);
    // fn may mutate raw.accounts in place (like syncAccount) or return a new
    // accounts array (like addAccountFromToken / updateAccountTags /
    // deleteAccount). Persist whichever accounts array ended up current.
    if (Array.isArray(result)) raw.accounts = result;
    const updatedAt = new Date().toISOString();
    persist({ ...raw, updatedAt });
    return result;
  } finally {
    release();
  }
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
  // Support both Telegram and Bale configurations
  const hasTelegram = typeof v.telegramBotToken === 'string' && typeof v.telegramChatId === 'string';
  const hasBale = typeof v.baleBotToken === 'string' && typeof v.baleChatId === 'string';
  return hasTelegram || hasBale;
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

export function writeState(
  input: { accounts: unknown[]; alerts: unknown[] },
  opts?: { baseUpdatedAt?: string | null }
): HubState | { conflict: true; state: Record<string, unknown> } {
  const prev = readRawState();
  if (opts?.baseUpdatedAt && prev?.updatedAt && opts.baseUpdatedAt !== prev.updatedAt) {
    return { conflict: true, state: prev || {} };
  }
  const updatedAt = new Date().toISOString();
  persist({
    accounts: input.accounts,
    alerts: input.alerts,
    ...(prev && prev.telegram !== undefined ? { telegram: prev.telegram } : {}),
    ...(prev && prev.botMonitor !== undefined ? { botMonitor: prev.botMonitor } : {}),
    updatedAt,
  });
  return { accounts: input.accounts, alerts: input.alerts, updatedAt };
}

export function readStateVersion(): string | null {
  const data = readRawState();
  return typeof data?.updatedAt === 'string' ? data.updatedAt : null;
}

export function readBotSettings(): TelegramConfig | null {
  return readTelegram();
}

export function writeBotSettings(cfg: TelegramConfig): TelegramConfig {
  return writeTelegram(cfg);
}

export function readBotMonitorSnapshot(): BotMonitorSnapshot | null {
  const data = readRawState();
  if (!data || !data.botMonitor || typeof data.botMonitor !== 'object') return null;
  return data.botMonitor as BotMonitorSnapshot;
}

export function writeBotMonitorSnapshot(snapshot: BotMonitorSnapshot): void {
  const prev = readRawState() || {};
  persist({ ...prev, botMonitor: snapshot, updatedAt: new Date().toISOString() });
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
