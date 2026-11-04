/** Periodic monitor: sweeps accounts, diffs service status and credit against
 *  the stored snapshot, and pushes alerts to admin chats. */

import { readBotSettings, readBotMonitorSnapshot, writeBotMonitorSnapshot } from '../stateStore';
import { getAccounts, syncAccount } from './railway';
import { sendNotification } from './router';
import type { BotMonitorSnapshot } from '../../types';

const SERVICE_TRANSITION_COOLDOWN_MS = 30 * 60_000;
const CREDIT_COOLDOWN_MS = 6 * 60 * 60_000;

let monitorTimer: ReturnType<typeof setInterval> | null = null;
const lastServiceAlert = new Map<string, number>();
const lastCreditAlert = new Map<string, number>();

function defaultThreshold(limit: number): number {
  return Math.max(0.5, limit * 0.1);
}

export function startMonitor(): void {
  if (monitorTimer) return;
  const tick = async () => {
    const cfg = readBotSettings();
    const hasBotToken = !!(cfg?.telegramBotToken || cfg?.baleBotToken);
    if (!cfg?.monitorEnabled || !hasBotToken) return;

    const accounts = getAccounts();
    if (accounts.length === 0) return;

    const threshold = cfg.creditAlertThreshold ?? 0.1;
    const snapshot: BotMonitorSnapshot = {
      services: {},
      credits: {},
      updatedAt: new Date().toISOString(),
    };

    // Sync up to 2 accounts concurrently
    const toSync = accounts.filter((a) => {
      const last = a.lastChecked ? new Date(a.lastChecked).getTime() : 0;
      return Date.now() - last > 10 * 60_000; // stale = 10min
    });

    for (let i = 0; i < toSync.length; i += 2) {
      const batch = toSync.slice(i, i + 2);
      await Promise.all(batch.map((a) => syncAccount(a.id).catch(() => {})));
    }

    const prev = readBotMonitorSnapshot();

    for (const account of getAccounts()) {
      // Credit check
      const remaining = account.creditRemaining;
      const limit = account.creditLimit;
      const creditKey = `credit:${account.id}`;
      snapshot.credits[account.id] = { remaining, limit };

      const isLow = remaining <= defaultThreshold(limit) || remaining <= limit * threshold;
      if (isLow) {
        const last = lastCreditAlert.get(creditKey) || 0;
        if (Date.now() - last > CREDIT_COOLDOWN_MS) {
          lastCreditAlert.set(creditKey, Date.now());
          sendNotification(
            cfg,
            `⚠️ اعتبار کم — ${account.name}`,
            `باقی‌مانده: ${remaining.toFixed(2)}$ از ${limit.toFixed(2)}$`,
            'warning'
          );
        }
      }

      // Service status transitions
      for (const p of account.projects || []) {
        for (const s of p.services || []) {
          const svcKey = `svc:${account.id}:${s.id}`;
          const currentStatus = s.status || '';
          snapshot.services[svcKey] = {
            status: currentStatus,
            deploymentId: s.latestDeploymentId || null,
          };

          const prevStatus = prev?.services[svcKey]?.status;
          if (!prevStatus || prevStatus === currentStatus) continue;

          const isWorse =
            currentStatus === 'crashed' ||
            currentStatus === 'stopped' ||
            currentStatus === 'deploying';
          const isBetter = currentStatus === 'healthy';

          if ((isWorse || isBetter) && (prevStatus !== currentStatus)) {
            const last = lastServiceAlert.get(svcKey) || 0;
            if (Date.now() - last > SERVICE_TRANSITION_COOLDOWN_MS) {
              lastServiceAlert.set(svcKey, Date.now());
              const sev: 'info' | 'warning' | 'critical' = isWorse ? 'warning' : 'info';
              sendNotification(
                cfg,
                `${isWorse ? '⚠️' : '✅'} وضعیت سرویس — ${account.name}`,
                `سرویس ${s.name} از ${prevStatus} به ${currentStatus} تغییر کرد`,
                sev
              );
            }
          }
        }
      }
    }

    writeBotMonitorSnapshot(snapshot);
  };

  const interval = (() => {
    const cfg = readBotSettings();
    const min = cfg?.monitorIntervalMinutes || 5;
    return Math.max(1, min) * 60_000;
  })();

  monitorTimer = setInterval(() => {
    tick().catch((err) => console.error('[monitor] tick failed', err));
  }, interval);

  // Run once immediately
  tick().catch((err) => console.error('[monitor] initial tick failed', err));
}

export function stopMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
  lastServiceAlert.clear();
  lastCreditAlert.clear();
}

export function restartMonitor(): void {
  stopMonitor();
  startMonitor();
}