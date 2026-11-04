/** Inline keyboard builders for the Telegram bot.
 *
 * callback_data is capped at 64 bytes by Telegram, so every button stores a
 * short ref key (`s:12`) and the real ids live in the per-chat session ref
 * table (sessions.ts).
 *
 * Layout convention: at most two buttons per row; destructive actions always
 * sit alone on the last row, directly above the back button. */

import type { InlineKeyboardButton } from '../telegram';
import { registerRef } from './sessions';
import { statusEmoji } from './format';

export interface ServiceListItem {
  ref: { accountId: string; projectId: string; serviceId: string; environmentId?: string };
  name: string;
  status: string;
}

export function btn(text: string, chatId: number, ref: Parameters<typeof registerRef>[1]) {
  return { text, callback_data: registerRef(chatId, ref) };
}

/* ------------------------------------------------------------------ main */

export function mainMenuKeyboard(chatId: number): InlineKeyboardButton[][] {
  return [
    [btn('📊 وضعیت', chatId, { kind: 'screen-status' }), btn('👤 اکانت‌ها', chatId, { kind: 'screen-accounts' })],
    [btn('🚀 پروژه‌ها', chatId, { kind: 'screen-projects' }), btn('🖥 سرویس‌ها', chatId, { kind: 'screen-services' })],
    [btn('📈 متریک', chatId, { kind: 'screen-metrics' }), btn('📜 لاگ‌ها', chatId, { kind: 'screen-logs' })],
    [btn('💾 بکاپ', chatId, { kind: 'screen-backup' }), btn('⚙️ تنظیمات', chatId, { kind: 'screen-settings' })],
  ];
}

export function backKeyboard(chatId: number, screen: string): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[] = [btn('↩️ بازگشت', chatId, { kind: screen })];
  if (screen !== 'screen-main') rows.push(btn('🏠 منوی اصلی', chatId, { kind: 'screen-main' }));
  return [rows];
}

export function confirmKeyboard(
  chatId: number,
  action: string,
  params: Record<string, string> = {}
): InlineKeyboardButton[][] {
  return [
    [
      btn('✅ تأیید', chatId, { kind: `confirm-${action}`, extra: params }),
      btn('❌ لغو', chatId, { kind: 'cancel-confirm' }),
    ],
  ];
}

export function paginationKeyboard(
  chatId: number,
  screen: string,
  page: number,
  totalPages: number
): InlineKeyboardButton[][] {
  if (totalPages <= 1) return [];
  const row: InlineKeyboardButton[] = [];
  if (page > 0) row.push(btn('◀️ قبلی', chatId, { kind: `pg:${screen}`, page: page - 1 }));
  row.push({ text: `${page + 1}/${totalPages}`, callback_data: registerRef(chatId, { kind: 'noop' }) });
  if (page < totalPages - 1) row.push(btn('بعدی ▶️', chatId, { kind: `pg:${screen}`, page: page + 1 }));
  return [row];
}

/* -------------------------------------------------------------- accounts */

export function accountListKeyboard(
  chatId: number,
  accounts: { id: string; name: string; creditRemaining: number; creditLimit: number; tags?: string[] }[],
  page: number,
  pageSize = 8
): { keyboard: InlineKeyboardButton[][]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(accounts.length / pageSize));
  const slice = accounts.slice(page * pageSize, (page + 1) * pageSize);

  const rows: InlineKeyboardButton[][] = slice.map((a) => {
    const tagText = (a.tags || []).length > 0 ? ` #${(a.tags || []).join(' #')}` : '';
    return [
      btn(`${a.name} · ${a.creditRemaining.toFixed(2)}$${tagText}`, chatId, {
        kind: 'account-select',
        accountId: a.id,
      }),
    ];
  });
  rows.push(...paginationKeyboard(chatId, 'accounts', page, totalPages));
  rows.push([
    btn('🌍 همه اکانت‌ها', chatId, { kind: 'account-select-all' }),
    btn('➕ افزودن اکانت', chatId, { kind: 'account-add' }),
  ]);
  rows.push(...backKeyboard(chatId, 'screen-main'));
  return { keyboard: rows, totalPages };
}

export function accountActionsKeyboard(chatId: number, accountId: string): InlineKeyboardButton[][] {
  return [
    [
      btn('📂 پروژه‌ها', chatId, { kind: 'account-projects', accountId }),
      btn('🖥 سرویس‌ها', chatId, { kind: 'account-services', accountId }),
    ],
    [
      btn('🔄 همگام‌سازی', chatId, { kind: 'account-sync', accountId }),
      btn('🏷 تگ‌ها', chatId, { kind: 'account-tags', accountId }),
    ],
    [btn('🗑 حذف اکانت', chatId, { kind: 'account-delete-confirm', accountId })],
    ...backKeyboard(chatId, 'screen-accounts'),
  ];
}

/* -------------------------------------------------------------- projects */

export function projectsListKeyboard(
  chatId: number,
  projects: { id: string; name: string; serviceCount?: number }[],
  page: number,
  pageSize = 8
): { keyboard: InlineKeyboardButton[][]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(projects.length / pageSize));
  const slice = projects.slice(page * pageSize, (page + 1) * pageSize);
  const rows: InlineKeyboardButton[][] = slice.map((p) => [
    btn(`${p.name}${p.serviceCount !== undefined ? ` · ${p.serviceCount} سرویس` : ''}`, chatId, {
      kind: 'project-open',
      projectId: p.id,
    }),
  ]);
  rows.push(...paginationKeyboard(chatId, 'projects', page, totalPages));
  rows.push([btn('➕ پروژه جدید', chatId, { kind: 'project-add' })]);
  rows.push(...backKeyboard(chatId, 'screen-projects'));
  return { keyboard: rows, totalPages };
}

export function projectDetailKeyboard(chatId: number, projectId: string): InlineKeyboardButton[][] {
  return [
    [
      btn('🖥 سرویس‌های پروژه', chatId, { kind: 'project-services', projectId }),
      btn('➕ سرویس جدید', chatId, { kind: 'project-service-add', projectId }),
    ],
    [btn('🗑 حذف پروژه', chatId, { kind: 'project-delete-confirm', projectId })],
    ...backKeyboard(chatId, 'project-list'),
  ];
}

/* -------------------------------------------------------------- services */

export function serviceListKeyboard(
  chatId: number,
  services: ServiceListItem[],
  page: number,
  backTo = 'screen-services',
  pageSize = 8,
  paginateAs = 'services'
): { keyboard: InlineKeyboardButton[][]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(services.length / pageSize));
  const slice = services.slice(page * pageSize, (page + 1) * pageSize);

  const rows: InlineKeyboardButton[][] = slice.map((s) => [
    btn(`${statusEmoji(s.status)} ${s.name}`, chatId, { kind: 'service-open', ...s.ref }),
  ]);
  rows.push(...paginationKeyboard(chatId, paginateAs, page, totalPages));
  rows.push([btn('➕ سرویس جدید', chatId, { kind: 'service-add' })]);
  rows.push(...backKeyboard(chatId, backTo));
  return { keyboard: rows, totalPages };
}

export function serviceActionKeyboard(
  chatId: number,
  ref: { accountId: string; projectId: string; serviceId: string; environmentId?: string }
): InlineKeyboardButton[][] {
  const base = { ...ref };
  return [
    [
      btn('🔄 ریستارت', chatId, { kind: 'svc-restart', ...base }),
      btn('🔁 دیپلوی مجدد', chatId, { kind: 'svc-redeploy', ...base }),
    ],
    [
      btn('📦 آپدیت سورس', chatId, { kind: 'svc-update', ...base }),
      btn('⏸ توقف / ▶️ استارت', chatId, { kind: 'svc-toggle', ...base }),
    ],
    [
      btn('🌐 دامنه‌ها', chatId, { kind: 'svc-domains', ...base }),
      btn('🔑 متغیرها', chatId, { kind: 'svc-vars', ...base }),
    ],
    [
      btn('💽 ولوم‌ها', chatId, { kind: 'svc-volumes', ...base }),
      btn('⚙️ تنظیمات', chatId, { kind: 'svc-settings', ...base }),
    ],
    [
      btn('📋 لاگ دیپلوی', chatId, { kind: 'svc-log-deploy', ...base }),
      btn('📋 لاگ بیلد', chatId, { kind: 'svc-log-build', ...base }),
    ],
    [btn('🗑 حذف سرویس', chatId, { kind: 'svc-delete-confirm', ...base })],
    ...backKeyboard(chatId, 'service-list'),
  ];
}

export function serviceCreateKeyboard(
  chatId: number,
  accountId: string,
  projectId?: string
): InlineKeyboardButton[][] {
  const base = { accountId, ...(projectId ? { projectId } : {}) };
  return [
    [btn('🌐 GitHub', chatId, { kind: 'deploy-github', ...base }), btn('🖼 ایمیج', chatId, { kind: 'deploy-image', ...base })],
    [btn('📦 سورس (.tar.gz/.zip)', chatId, { kind: 'deploy-source', ...base }), btn('🐳 Compose', chatId, { kind: 'deploy-compose', ...base })],
    ...backKeyboard(chatId, projectId ? 'project-detail' : 'service-list'),
  ];
}

export function servicePickKeyboard(
  chatId: number,
  services: ServiceListItem[],
  kindPrefix: string,
  backTo = 'service-list',
  pageSize = 8
): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = services.slice(0, pageSize).map((s) => [
    btn(`${statusEmoji(s.status)} ${s.name}`, chatId, { kind: `${kindPrefix}`, ...s.ref }),
  ]);
  rows.push(...backKeyboard(chatId, backTo));
  return rows;
}

/* ------------------------------------------------------- service sections */

export function variablesKeyboard(chatId: number, ref: ServiceRefLike, names: string[]): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = names.slice(0, 8).map((name) => [
    btn(`🗑 ${name}`, chatId, { kind: 'var-delete-confirm', ...ref, extra: { name } }),
  ]);
  rows.push([btn('➕ افزودن متغیر', chatId, { kind: 'var-add', ...ref })]);
  rows.push(...backKeyboard(chatId, 'service-detail'));
  return rows;
}

export interface ServiceRefLike {
  accountId: string;
  projectId: string;
  serviceId: string;
  environmentId?: string;
}

export function domainsKeyboard(
  chatId: number,
  ref: ServiceRefLike,
  domains: { id: string; domain: string; kind: 'service' | 'custom'; targetPort?: number | null }[]
): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = domains.slice(0, 6).map((d) => [
    btn(`🗑 ${d.domain}`, chatId, {
      kind: 'domain-delete-confirm',
      ...ref,
      domainId: d.id,
      domainKind: d.kind,
    }),
  ]);
  rows.push([
    btn('➕ ساب‌دامین', chatId, { kind: 'domain-add-sub', ...ref }),
    btn('➕ دامنهٔ سفارشی', chatId, { kind: 'domain-add-custom', ...ref }),
  ]);
  rows.push(...backKeyboard(chatId, 'service-detail'));
  return rows;
}

export function volumesKeyboard(
  chatId: number,
  ref: ServiceRefLike,
  volumes: { id: string; name: string; mountPath?: string }[]
): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = volumes.slice(0, 6).map((v) => [
    btn(`🗑 ${v.name || v.mountPath || v.id}`, chatId, {
      kind: 'volume-delete-confirm',
      ...ref,
      volumeId: v.id,
    }),
  ]);
  rows.push([btn('➕ ساخت ولوم', chatId, { kind: 'volume-add', ...ref })]);
  rows.push(...backKeyboard(chatId, 'service-detail'));
  return rows;
}

export function settingsKeyboard(chatId: number, ref: ServiceRefLike): InlineKeyboardButton[][] {
  return [
    [
      btn('🔨 Build Command', chatId, { kind: 'setting-build', ...ref }),
      btn('▶️ Start Command', chatId, { kind: 'setting-start', ...ref }),
    ],
    [
      btn('📁 Root Directory', chatId, { kind: 'setting-root', ...ref }),
      btn('🩺 Healthcheck', chatId, { kind: 'setting-health', ...ref }),
    ],
    [btn('🐳 Builder (NIXPACKS/DOCKERFILE)', chatId, { kind: 'setting-builder', ...ref })],
    ...backKeyboard(chatId, 'service-detail'),
  ];
} // end settingsKeyboard