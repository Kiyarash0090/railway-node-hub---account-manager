/** Bot lifecycle: start/stop/restart dual polling loops (Telegram + Bale) and monitor. */

import { randomBytes } from 'node:crypto';
import { setInternalBotSecret, getInternalBotSecret } from '../auth';
import { readBotSettings } from '../stateStore';
import { runPollingLoop, sendNotification } from './router';
import { startMonitor, stopMonitor, restartMonitor } from './monitor';
import { setBotPort } from './railway';
import type { TelegramConfig } from '../../types';

let telegramLoopPromise: Promise<void> | null = null;
let baleLoopPromise: Promise<void> | null = null;
let pollLoopActive = false;
let pollLoopGeneration = 0;

export function setPort(port: number): void {
  setBotPort(port);
}

/** Create the per-process secret and inject it into the auth guard. */
export function initInternalSecret(): string {
  const secret = randomBytes(32).toString('hex');
  setInternalBotSecret(secret);
  return secret;
}

export function getSecret(): string | null {
  return getInternalBotSecret();
}

export function getPollLoopGeneration(): number {
  return pollLoopGeneration;
}

/** Start the bot (dual polling loops + monitor) if config is valid. */
export function startBot(): boolean {
  const cfg = readBotSettings();
  const hasTelegram = !!cfg?.telegramBotToken && !!cfg?.telegramChatId && cfg?.telegramEnabled !== false;
  const hasBale = !!cfg?.baleBotToken && !!cfg?.baleChatId && cfg?.baleEnabled !== false;

  if (!hasTelegram && !hasBale) return false;
  if (cfg.botEnabled === false) return false;
  if (pollLoopActive) return true;

  pollLoopActive = true;
  const generation = ++pollLoopGeneration;

  if (hasTelegram) {
    telegramLoopPromise = (async () => {
      try {
        await runPollingLoop(cfg, 'telegram');
      } catch (err) {
        console.error('[bot:telegram] polling loop crashed', err);
      } finally {
        if (generation === pollLoopGeneration) {
          telegramLoopPromise = null;
        }
      }
    })();
  }

  if (hasBale) {
    baleLoopPromise = (async () => {
      try {
        await runPollingLoop(cfg, 'bale');
      } catch (err) {
        console.error('[bot:bale] polling loop crashed', err);
      } finally {
        if (generation === pollLoopGeneration) {
          baleLoopPromise = null;
        }
      }
    })();
  }

  if (cfg.monitorEnabled) {
    startMonitor();
  }

  console.log('[bot] started', { telegram: hasTelegram, bale: hasBale });
  return true;
}

/** Stop the bot cleanly. */
export function stopBot(): void {
  ++pollLoopGeneration;
  pollLoopActive = false;
  stopMonitor();
  telegramLoopPromise = null;
  baleLoopPromise = null;
  console.log('[bot] stopped');
}

/** Restart after a config change. */
export function restartBot(): void {
  stopBot();
  const cfg = readBotSettings();
  const hasTelegram = !!cfg?.telegramBotToken && !!cfg?.telegramChatId;
  const hasBale = !!cfg?.baleBotToken && !!cfg?.baleChatId;

  if ((hasTelegram || hasBale) && cfg?.botEnabled !== false) {
    startBot();
    if (cfg.monitorEnabled) restartMonitor();
  }
}

/** Convenience for server.ts: notify all admins of an event on both platforms. */
export function notifyAdmins(
  title: string,
  message: string,
  severity: 'info' | 'warning' | 'critical' = 'info'
): void {
  const cfg = readBotSettings();
  const promises: Promise<void>[] = [];

  if (cfg?.telegramBotToken) {
    promises.push(
      sendNotification(cfg, title, message, severity, 'telegram').catch((err) => {
        console.error('[bot:telegram] notify failed', err);
      })
    );
  }

  if (cfg?.baleBotToken) {
    promises.push(
      sendNotification(cfg, title, message, severity, 'bale').catch((err) => {
        console.error('[bot:bale] notify failed', err);
      })
    );
  }

  if (promises.length > 0) {
    Promise.all(promises).catch(() => {});
  }
}
