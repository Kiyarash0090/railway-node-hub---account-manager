/** Screen dispatcher for the bot.
 *
 *  Scope rule: every list is filtered by the chat's selected account, and the
 *  project/service screens additionally by the chat's view context, so picking
 *  an account never shows another account's projects or services. */

import type { InlineKeyboardButton } from '../../telegram';
import {
  mainMenuKeyboard,
  backKeyboard,
  accountListKeyboard,
  accountActionsKeyboard,
  projectsListKeyboard,
  projectDetailKeyboard,
  serviceListKeyboard,
  serviceActionKeyboard,
  serviceCreateKeyboard,
  variablesKeyboard,
  domainsKeyboard,
  volumesKeyboard,
  settingsKeyboard,
  btn,
  type ServiceListItem,
} from '../keyboards';
import {
  getAccounts,
  listProjects,
  findProject,
  findService,
  servicesOfAccount,
  listDomains,
  listVolumes,
  findAccount,
  syncAccount,
} from '../railway';
import { faNum, faDate, statusEmoji, truncate, maskSecret } from '../format';
import { readBotSettings } from '../../stateStore';
import {
  getSelectedAccount,
  getViewProject,
  getViewService,
} from '../sessions';
import type { RailwayAccount } from '../../../types';

export interface ScreenResult {
  text: string;
  keyboard?: InlineKeyboardButton[][];
}

/* --------------------------------------------------------------- shared */

function scopeAccounts(chatId: number): RailwayAccount[] {
  const all = getAccounts();
  const id = getSelectedAccount(chatId);
  return id ? all.filter((a) => a.id === id) : all;
}

function scopeLabel(chatId: number): string {
  const accounts = scopeAccounts(chatId);
  const id = getSelectedAccount(chatId);
  if (!id) return 'همه اکانت‌ها';
  return accounts[0]?.name || 'اکانت نامشخص';
}

function balanceLine(a: RailwayAccount): string {
  return `اعتبار: ${faNum(Math.max(0, a.creditRemaining).toFixed(2))}$ از ${faNum(a.creditLimit.toFixed(2))}$`;
}

/* ------------------------------------------------------------ dispatcher */

export async function dispatch(chatId: number, screen: string, page = 0): Promise<ScreenResult> {
  switch (screen) {
    case 'main':
      return {
        text: `🚂 Railway Hub Bot\n\nنمای فعلی: ${scopeLabel(chatId)}\nبخش موردنظر را انتخاب کنید:`,
        keyboard: mainMenuKeyboard(chatId),
      };

    case 'screen-status':
      return statusScreen();
    case 'screen-accounts':
    case 'accounts':
      return accountsScreen(chatId, page);
    case 'screen-projects':
    case 'projects':
    case 'project-list':
      return projectsScreen(chatId, page);
    case 'screen-services':
    case 'services':
    case 'service-list':
      return servicesScreen(chatId, page);
    case 'screen-metrics':
    case 'metrics':
      return simpleNotice(
        '📈 متریک',
        'برای دیدن متریک زنده (CPU/حافظه/شبکه) از داشبورد وب استفاده کنید.'
      );
    case 'screen-logs':
    case 'logs':
      return simpleNotice(
        '📜 لاگ‌ها',
        'لاگ بیلد و دیپلوی را از داخل جزئیات هر سرویس ببینید:\nسرویس‌ها → انتخاب سرویس → «📋 لاگ دیپلوی / بیلد».'
      );
    case 'screen-backup':
    case 'backup':
      return backupScreen(chatId);
    case 'screen-settings':
    case 'settings':
      return settingsScreen();
    default:
      return {
        text: `🚂 Railway Hub Bot\n\nنمای فعلی: ${scopeLabel(chatId)}\nبخش موردنظر را انتخاب کنید:`,
        keyboard: mainMenuKeyboard(chatId),
      };
  }
}

export async function dispatchContext(chatId: number, screen: string, page = 0): Promise<ScreenResult> {
  switch (screen) {
    case 'account-detail':
      return accountDetailScreen(chatId);
    case 'account-projects':
    case 'project-list':
      return accountProjectsScreen(chatId, page);
    case 'project-detail':
      return projectDetailScreen(chatId);
    case 'service-detail':
      return serviceDetailScreen(chatId);
    case 'service-vars':
      return serviceVarsScreen(chatId);
    case 'service-domains':
      return serviceDomainsScreen(chatId);
    case 'service-volumes':
      return serviceVolumesScreen(chatId);
    case 'service-settings':
      return serviceSettingsScreen(chatId);
    case 'service-create':
      return serviceCreateScreen(chatId);
    default:
      // Screens without view context fall through to the plain dispatcher.
      return dispatch(chatId, screen, page);
  }
}

function simpleNotice(title: string, body: string): ScreenResult {
  return { text: `${title}\n\n${body}` };
}

/* -------------------------------------------------------------- overview */

async function statusScreen(): Promise<ScreenResult> {
  const accounts = getAccounts();
  let total = 0,
    healthy = 0,
    crashed = 0,
    stopped = 0;

  for (const a of accounts) {
    for (const p of a.projects || []) {
      for (const s of p.services || []) {
        total++;
        if (s.status === 'healthy') healthy++;
        else if (s.status === 'crashed') crashed++;
        else if (s.status === 'stopped') stopped++;
      }
    }
  }

  const limit = accounts.reduce((s, a) => s + (a.creditLimit || 0), 0);
  const used = accounts.reduce((s, a) => s + (a.creditUsed || 0), 0);

  const lines = [
    '📊 وضعیت کلی',
    '',
    `👤 اکانت‌ها: ${faNum(accounts.length)}`,
    `💳 اعتبار کل: ${faNum(Math.max(0, limit - used).toFixed(2))}$ از ${faNum(limit.toFixed(2))}$`,
    '',
    `🖥 سرویس‌ها: ${faNum(total)}`,
    `✅ سالم: ${faNum(healthy)}   ❌ کرش: ${faNum(crashed)}   ⏹ متوقف: ${faNum(stopped)}`,
  ];

  const low = accounts.filter((a) => a.creditRemaining <= Math.max(0.5, a.creditLimit * 0.1));
  if (low.length > 0) {
    lines.push('', '⚠️ اکانت‌های کم‌اعتبار:');
    for (const a of low) lines.push(` • ${a.name}: ${faNum(Math.max(0, a.creditRemaining).toFixed(2))}$`);
  }

  return { text: lines.join('\n') };
}

/* -------------------------------------------------------------- accounts */

async function accountsScreen(chatId: number, page: number): Promise<ScreenResult> {
  const accounts = getAccounts();
  const { keyboard } = accountListKeyboard(chatId, accounts, page);

  const lines = [`👤 اکانت‌ها (${faNum(accounts.length)})`];
  if (accounts.length === 0) {
    lines.push('', 'هنوز اکانتی ثبت نشده است. «➕ افزودن اکانت» را بزنید.');
  } else {
    lines.push(
      '',
      `نمای فعلی: ${scopeLabel(chatId)}`,
      '',
      'یک اکانت را انتخاب کنید تا پروژه‌ها و سرویس‌های همان اکانت نمایش داده شود.',
      '«🌍 همه اکانت‌ها» فیلتر را برمی‌دارد.'
    );
  }
  return { text: lines.join('\n'), keyboard };
}

async function accountDetailScreen(chatId: number): Promise<ScreenResult> {
  const id = getSelectedAccount(chatId);
  const account = id ? findAccount(id) : undefined;
  if (!account) {
    return {
      text: 'اکانتی انتخاب نشده است.',
      keyboard: [
        [btn('👤 انتخاب اکانت', chatId, { kind: 'screen-accounts' })],
        ...backKeyboard(chatId, 'screen-accounts'),
      ],
    };
  }

  const projects = listProjects(account.id);
  const services = servicesOfAccount(account.id);

  const lines = [
    `👤 ${account.name}`,
    account.email ? `✉️ ${account.email}` : '',
    '',
    `📂 پروژه‌ها: ${faNum(projects.length)}`,
    `🖥 سرویس‌ها: ${faNum(services.length)}`,
    `💳 ${balanceLine(account)}`,
    `🌍 ریجن: ${account.preferredRegion || '—'}`,
    `🕒 آخرین بررسی: ${faDate(account.lastChecked)}`,
    '',
    'از دکمه‌های زیر همین اکانت را مدیریت کنید.',
  ].filter(Boolean);

  return { text: lines.join('\n'), keyboard: accountActionsKeyboard(chatId, account.id) };
}

/* -------------------------------------------------------------- projects */

async function projectsScreen(chatId: number, page: number): Promise<ScreenResult> {
  const accounts = scopeAccounts(chatId);
  const id = getSelectedAccount(chatId);
  const account = id ? accounts[0] : undefined;

  if (id && !account) {
    return {
      text: 'اکانت انتخاب‌شده پیدا نشد.',
      keyboard: backKeyboard(chatId, 'screen-accounts'),
    };
  }

  const projects = accounts.flatMap((a) =>
    listProjects(a.id).map((p: any) => ({
      id: p.id,
      name: id ? p.name || 'بدون نام' : `${p.name || 'بدون نام'} · ${a.name}`,
      serviceCount: (p.services || []).length,
    }))
  );

  const lines = [`📂 پروژه‌ها — ${scopeLabel(chatId)} (${faNum(projects.length)})`];
  if (projects.length === 0) {
    lines.push('', 'پروژه‌ای یافت نشد. ابتدا همگام‌سازی کنید یا پروژهٔ جدید بسازید.');
  }

  const { keyboard } = projectsListKeyboard(chatId, projects, page);
  return { text: lines.join('\n'), keyboard };
}

async function accountProjectsScreen(chatId: number, page: number): Promise<ScreenResult> {
  return projectsScreen(chatId, page);
}

async function projectDetailScreen(chatId: number): Promise<ScreenResult> {
  const accountId = getSelectedAccount(chatId);
  const projectId = getViewProject(chatId);
  const project = accountId && projectId ? findProject(accountId, projectId) : undefined;

  if (!accountId || !project) {
    return { text: 'پروژه‌ای انتخاب نشده است.', keyboard: backKeyboard(chatId, 'project-list') };
  }

  const services = project.services || [];
  const counts = services.reduce(
    (acc: Record<string, number>, s: any) => {
      const key = s.status || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {}
  );

  const lines = [
    `📂 ${project.name}`,
    '',
    `🖥 سرویس‌ها: ${faNum(services.length)}`,
    services.length > 0
      ? Object.entries(counts)
          .map(([k, v]) => `${statusEmoji(k)} ${k}: ${faNum(v)}`)
          .join('   ')
      : '',
    project.defaultEnvironmentId ? '' : '⚠️ محیط پیش‌فرض این پروژه پیدا نشد؛ ابتدا همگام‌سازی کنید.',
  ].filter(Boolean);

  return { text: lines.join('\n'), keyboard: projectDetailKeyboard(chatId, project.id) };
}

/* -------------------------------------------------------------- services */

async function servicesScreen(chatId: number, page: number): Promise<ScreenResult> {
  const accounts = scopeAccounts(chatId);
  const scoped = !!getSelectedAccount(chatId);

  const items: (ServiceListItem & { accountName: string; projectName: string })[] = [];
  for (const a of accounts) {
    for (const s of servicesOfAccount(a.id)) {
      items.push({
        ref: s.ref,
        name: s.name,
        status: s.status,
        accountName: a.name,
        projectName: s.projectName,
      });
    }
  }

  const lines = [
    `🖥 سرویس‌ها — ${scopeLabel(chatId)} (${faNum(items.length)})`,
  ];
  if (items.length === 0) {
    lines.push('', 'سرویزی یافت نشد.');
  } else if (!scoped) {
    lines.push('', 'برای محدود کردن به یک اکانت، از «👤 اکانت‌ها» اکانت را انتخاب کنید.');
  }

  const { keyboard } = serviceListKeyboard(chatId, items, page, 'screen-services');
  return { text: lines.join('\n'), keyboard };
}

async function serviceDetailScreen(chatId: number): Promise<ScreenResult> {
  const ref = getViewService(chatId);
  if (!ref) {
    return { text: 'سرویسی انتخاب نشده است.', keyboard: backKeyboard(chatId, 'service-list') };
  }

  const service = findService(ref);
  if (!service) {
    return {
      text: 'این سرویس روی حالت محلی پیدا نشد؛ ابتدا «🔄 همگام‌سازی» را بزنید.',
      keyboard: backKeyboard(chatId, 'service-list'),
    };
  }

  const domains = (service.domains || []).map((d: any) => (typeof d === 'string' ? d : d.domain));
  const vars = Object.keys(service.envVars || {});

  const lines = [
    `${statusEmoji(service.status)} ${service.name}`,
    '',
    `وضعیت: ${service.status || '—'}`,
    `پورت: ${service.port || '—'}`,
    `منبع: ${truncate(service.imageOrRepo || '—', 40)}`,
    '',
    `🌐 دامنه‌ها (${faNum(domains.length)}):`,
    domains.length ? domains.slice(0, 3).map((d) => ` • ${d}`).join('\n') : ' —',
    '',
    `🔑 متغیرها: ${faNum(vars.length)}`,
    `💽 ولوم‌ها: ${faNum((findProject(ref.accountId, ref.projectId)?.volumes || []).length)}`,
    service.deploymentStatus ? `🚀 آخرین استقرار: ${service.deploymentStatus}` : '',
  ].filter(Boolean);

  return { text: lines.join('\n'), keyboard: serviceActionKeyboard(chatId, ref) };
}

async function serviceCreateScreen(chatId: number): Promise<ScreenResult> {
  const accountId = getSelectedAccount(chatId);
  if (!accountId) {
    return {
      text: 'ابتدا از «👤 اکانت‌ها» یک اکانت انتخاب کنید، بعد سرویس جدید بسازید.',
      keyboard: backKeyboard(chatId, 'service-list'),
    };
  }
  const projectId = getViewProject(chatId);
  return {
    text:
      '🚀 ساخت سرویس جدید' +
      (projectId ? `\nپروژه: ${findProject(accountId, projectId)?.name || ''}` : '\nپروژه: ساخت خودکار') +
      '\n\nروش استقرار را انتخاب کنید:',
    keyboard: serviceCreateKeyboard(chatId, accountId, projectId),
  };
}

/* ------------------------------------------------- service sub-sections */

async function serviceVarsScreen(chatId: number): Promise<ScreenResult> {
  const ref = getViewService(chatId);
  const service = ref ? findService(ref) : undefined;
  if (!ref || !service) return { text: 'سرویسی انتخاب نشده است.', keyboard: backKeyboard(chatId, 'service-list') };

  const entries = Object.entries(service.envVars || {});
  const lines = [`🔑 متغیرهای ${service.name} (${faNum(entries.length)})`, ''];
  if (entries.length === 0) lines.push('متغیری ثبت نشده است.');
  for (const [k, v] of entries.slice(0, 20)) {
    const sensitive = /TOKEN|SECRET|KEY|PASS|PASSWORD|DSN|URL/i.test(k);
    lines.push(` • ${k} = ${sensitive ? maskSecret(String(v)) : truncate(String(v), 30)}`);
  }
  if (entries.length > 20) lines.push('', `… و ${faNum(entries.length - 20)} متغیر دیگر`);

  return { text: lines.join('\n'), keyboard: variablesKeyboard(chatId, ref, entries.map(([k]) => k)) };
}

async function serviceDomainsScreen(chatId: number): Promise<ScreenResult> {
  const ref = getViewService(chatId);
  const service = ref ? findService(ref) : undefined;
  if (!ref || !service) return { text: 'سرویسی انتخاب نشده است.', keyboard: backKeyboard(chatId, 'service-list') };

  let domains: any[] = [];
  try {
    domains = await listDomains(ref);
  } catch (e: any) {
    return { text: `خطا در خواندن دامنه‌ها: ${e.message}`, keyboard: backKeyboard(chatId, 'service-detail') };
  }

  const lines = [`🌐 دامنه‌های ${service.name} (${faNum(domains.length)})`, ''];
  if (domains.length === 0) lines.push('دامنه‌ای متصل نیست.');
  for (const d of domains) {
    lines.push(` • ${d.domain}${d.targetPort ? ` → پورت ${d.targetPort}` : ''}${d.kind === 'custom' ? ' (سفارشی)' : ''}`);
  }

  return { text: lines.join('\n'), keyboard: domainsKeyboard(chatId, ref, domains) };
}

async function serviceVolumesScreen(chatId: number): Promise<ScreenResult> {
  const ref = getViewService(chatId);
  const service = ref ? findService(ref) : undefined;
  if (!ref || !service) return { text: 'سرویسی انتخاب نشده است.', keyboard: backKeyboard(chatId, 'service-list') };

  let volumes: any[] = [];
  try {
    volumes = await listVolumes(ref);
  } catch (e: any) {
    return { text: `خطا در خواندن ولوم‌ها: ${e.message}`, keyboard: backKeyboard(chatId, 'service-detail') };
  }

  const items = volumes.map((v: any) => ({
    id: v.volume?.id || v.id,
    name: v.name || v.volume?.name,
    mountPath: v.mountPath,
  }));

  const lines = [`💽 ولوم‌های ${service.name} (${faNum(items.length)})`, ''];
  if (items.length === 0) lines.push('ولومی متصل نیست.');
  for (const v of items) lines.push(` • ${v.name || v.id}${v.mountPath ? ` → ${v.mountPath}` : ''}`);

  return { text: lines.join('\n'), keyboard: volumesKeyboard(chatId, ref, items) };
}

async function serviceSettingsScreen(chatId: number): Promise<ScreenResult> {
  const ref = getViewService(chatId);
  const service = ref ? findService(ref) : undefined;
  if (!ref || !service) return { text: 'سرویسی انتخاب نشده است.', keyboard: backKeyboard(chatId, 'service-list') };

  const lines = [
    `⚙️ تنظیمات ${service.name}`,
    '',
    'هر گزینه را بزنید تا مقدار جدید را ارسال کنید.',
    'با /cancel لغو می‌شود.',
  ];
  return { text: lines.join('\n'), keyboard: settingsKeyboard(chatId, ref) };
}

/* ---------------------------------------------------------- backup/settings */

async function backupScreen(chatId: number): Promise<ScreenResult> {
  const keyboard: InlineKeyboardButton[][] = [
    [btn('💾 ارسال بکاپ به تلگرام', chatId, { kind: 'backup-send' })],
    [btn('♻️ بازیابی از آخرین بکاپ', chatId, { kind: 'backup-restore-last' })],
    [btn('📤 بازیابی از فایل JSON', chatId, { kind: 'backup-restore-file' })],
    ...backKeyboard(chatId, 'screen-main'),
  ];
  return {
    text:
      '💾 بکاپ و بازیابی\n\n' +
      '• ارسال بکاپ: فایل وضعیت فعلی به همین چت فرستاده می‌شود.\n' +
      '• بازیابی از آخرین بکاپ: آخرین فایلی که فرستادید را برمی‌گرداند.\n' +
      '• بازیابی از فایل: یک فایل JSON بکاپ را به‌صورت Document بفرستید.\n\n' +
      '⚠️ بازیابی، اکانت‌ها و هشدارهای فعلی را جایگزین می‌کند.',
    keyboard,
  };
}

async function settingsScreen(): Promise<ScreenResult> {
  const cfg = readBotSettings();
  const lines = [
    '⚙️ تنظیمات ربات',
    '',
    `• ربات: ${cfg?.botEnabled ? 'روشن' : 'خاموش'}`,
    `• اعلان‌ها: ${cfg?.notificationsEnabled === false ? 'خاموش' : 'روشن'}`,
    `• مانیتور: ${cfg?.monitorEnabled ? `روشن (هر ${faNum(cfg.monitorIntervalMinutes || 5)} دقیقه)` : 'خاموش'}`,
    `• آستانهٔ هشدار اعتبار: ${faNum(Math.round((cfg?.creditAlertThreshold ?? 0.1) * 100))}٪`,
  ];
  if (cfg?.adminChatIds?.length) lines.push(`• ادمین‌ها: ${cfg.adminChatIds.join(', ')}`);
  lines.push('', 'این تنظیمات از مودال «تلگرام» در داشبورد وب تغییر می‌کند.');

  return { text: lines.join('\n') };
}