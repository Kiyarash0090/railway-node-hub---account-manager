/** Long-polling router: getUpdates loop, admin auth, callback/text dispatch. */

import {
  tgGetUpdates,
  tgSendMessage,
  tgSendMessageWithKeyboard,
  tgEditMessageText,
  tgAnswerCallbackQuery,
  tgDownloadFileBuffer,
  tgSendDocumentByBuffer,
} from '../telegram';
import {
  getSession,
  getAwaiting,
  setAwaiting,
  getConfirmPending,
  setConfirmPending,
  setLastScreen,
  registerRef,
  getSelectedAccount,
  setSelectedAccount,
  setViewProject,
  setViewService,
  getViewProject,
  getViewService,
} from './sessions';
import { splitMessage, truncate } from './format';
import { extractTarGz } from './tar';
import {
  apiPost,
  getAccounts,
  findAccount,
  syncAccount,
  addAccountFromToken,
  deleteAccount,
  setAccountRegion,
  updateAccountTags,
  createProject,
  createService,
  createSubdomain,
  deleteDomain,
  upsertVariable,
  deleteVariable,
  createVolume,
  deleteVolume,
  updateServiceSettings,
  fetchLogs,
  deployGithub,
  deployDockerCompose,
  deploySourceUpload,
  listProjects,
  findProject,
  findService,
  servicesOfAccount,
  buildBackupPayload,
  rememberBackup,
  lastBackupRecord,
  applyBackupJson,
} from './railway';
import { readBotSettings } from '../stateStore';
import type { TelegramConfig } from '../../types';

type Ref = { accountId?: string; projectId?: string; serviceId?: string; environmentId?: string; volumeId?: string; domainId?: string; domainKind?: 'service' | 'custom'; page?: number; extra?: Record<string, string> };

/** Screen names that back buttons point at. */
const BACK_TARGET_SCREENS = new Set([
  'screen-main',
  'screen-status',
  'screen-accounts',
  'screen-projects',
  'screen-services',
  'screen-metrics',
  'screen-logs',
  'screen-backup',
  'screen-settings',
  'project-list',
  'service-list',
  'account-detail',
  'project-detail',
  'service-detail',
  'service-vars',
  'service-domains',
  'service-volumes',
  'service-settings',
  'service-create',
]);

/* ------------------------------------------------------------- helpers */

function adminIds(cfg: TelegramConfig): string[] {
  const ids = new Set<string>();
  if (cfg.telegramChatId) ids.add(String(cfg.telegramChatId));
  if (cfg.baleChatId) ids.add(String(cfg.baleChatId));
  for (const id of cfg.adminChatIds || []) if (id) ids.add(String(id));
  return [...ids];
}

function isAllowed(chatId: number, cfg: TelegramConfig): boolean {
  return adminIds(cfg).includes(String(chatId));
}

async function sendMsg(
  cfg: TelegramConfig,
  chatId: number,
  text: string,
  platform: 'telegram' | 'bale'
): Promise<number> {
  const botToken = platform === 'bale' ? cfg.baleBotToken : cfg.telegramBotToken;
  return tgSendMessage(botToken || '', String(chatId), text, platform);
}

async function sendMsgWithKeyboard(
  cfg: TelegramConfig,
  chatId: number,
  text: string,
  keyboard: import('../telegram').InlineKeyboardButton[][],
  platform: 'telegram' | 'bale'
): Promise<number> {
  const botToken = platform === 'bale' ? cfg.baleBotToken : cfg.telegramBotToken;
  return tgSendMessageWithKeyboard(botToken || '', String(chatId), text, keyboard, platform);
}

async function editMsg(
  cfg: TelegramConfig,
  chatId: string | number,
  messageId: number,
  text: string,
  keyboard: import('../telegram').InlineKeyboardButton[][] | undefined,
  platform: 'telegram' | 'bale'
): Promise<void> {
  const botToken = platform === 'bale' ? cfg.baleBotToken : cfg.telegramBotToken;
  await tgEditMessageText(botToken || '', String(chatId), messageId, text, keyboard, platform);
}

async function answerCbq(
  cfg: TelegramConfig,
  answerId: string,
  text?: string,
  showAlert = false,
  platform: 'telegram' | 'bale' = 'telegram'
): Promise<void> {
  const botToken = platform === 'bale' ? cfg.baleBotToken : cfg.telegramBotToken;
  await tgAnswerCallbackQuery(botToken || '', answerId, text, showAlert, platform);
}

async function screen(
  chatId: number,
  name: string,
  page = 0
): Promise<{ text: string; keyboard?: import('../telegram').InlineKeyboardButton[][] }> {
  const menus = await import('./menus');
  return menus.dispatchContext(chatId, name, page);
}

/** Send long text as multiple Telegram messages (Telegram caps at 4096). */
async function sendLong(
  token: string,
  chatId: number,
  text: string,
  platform: 'telegram' | 'bale'
): Promise<void> {
  for (const part of splitMessage(text, 3800)) {
    await tgSendMessage(token, String(chatId), part, platform);
  }
}

async function render(
  cfg: TelegramConfig,
  chatId: number,
  callbackQuery: any,
  name: string,
  page = 0,
  platform: 'telegram' | 'bale' = 'telegram'
): Promise<void> {
  const { text, keyboard } = await screen(chatId, name, page);
  const messageId = callbackQuery?.message?.message_id;
  const safe = truncate(text, 4000);
  const botToken = platform === 'bale' ? cfg.baleBotToken : cfg.telegramBotToken;
  if (messageId) {
    try {
      await tgEditMessageText(botToken || '', String(chatId), messageId, safe, keyboard, platform);
      return;
    } catch {
      // Editing can fail (message too old / identical content) — send fresh.
    }
  }
  await sendMsgWithKeyboard(cfg, chatId, safe, keyboard || [], platform);
}

/** Resolve the service ref a callback carries, falling back to view context. */
function refOf(chatId: number, ref: Ref) {
  if (ref.accountId && ref.projectId && ref.serviceId) {
    return {
      accountId: ref.accountId,
      projectId: ref.projectId,
      serviceId: ref.serviceId,
      environmentId: ref.environmentId,
    };
  }
  return getViewService(chatId) || null;
}

function tokenFor(accountId?: string): { token: string; name: string } | null {
  const account = accountId ? findAccount(accountId) : undefined;
  if (!account) return null;
  return { token: account.token, name: account.name };
}

/** Pick the project a new service should go into. */
function targetProject(chatId: number, accountId: string, ref: Ref): string | undefined {
  return ref.projectId || getViewProject(chatId) || listProjects(accountId)[0]?.id;
}

/* -------------------------------------------------------------- backups */

async function sendBackup(cfg: TelegramConfig, chatId: number, platform: 'telegram' | 'bale'): Promise<void> {
  const payload = buildBackupPayload();
  const stamp = (() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  })();
  const fileName = `hub-state-${stamp}.json`;

  const botToken = platform === 'bale' ? cfg.baleBotToken : cfg.telegramBotToken;
  const sent = await tgSendDocumentByBuffer(
    botToken || '',
    String(chatId),
    Buffer.from(payload, 'utf8'),
    fileName,
    'پشتیبان دیتابیس Railway Hub',
    platform
  );

  if (sent.fileId) {
    rememberBackup(sent.fileId, sent.fileName, sent.messageId);
    await sendMsg(cfg, chatId, `✅ بکاپ ارسال شد: ${sent.fileName}`, platform);
  } else {
    await sendMsg(cfg, chatId, '⚠️ فایل ارسال شد ولی شناسه‌اش ثبت نشد؛ برای بازیابی از فایل استفاده کنید.', platform);
  }
}

async function restoreLastBackup(cfg: TelegramConfig, chatId: number, platform: 'telegram' | 'bale'): Promise<void> {
  const last = lastBackupRecord();
  if (!last) {
    await sendMsg(cfg, chatId, 'هنوز بکاپی ارسال نشده است. اول «💾 ارسال بکاپ» را بزنید.', platform);
    return;
  }
  const botToken = platform === 'bale' ? cfg.baleBotToken : cfg.telegramBotToken;
  const buffer = await tgDownloadFileBuffer(botToken || '', last.fileId, platform);
  const result = applyBackupJson(buffer.toString('utf8'));
  if (!result.ok) {
    await sendMsg(cfg, chatId, `❌ بازیابی ناموفق: ${result.error}`, platform);
    return;
  }
  await sendMsg(cfg, chatId, `✅ بازیابی انجام شد.\n👤 ${result.accounts} اکانت · 🔔 ${result.alerts} هشدار`, platform);
  await render(cfg, chatId, null, 'screen-backup', 0, platform);
}

/* ------------------------------------------------------------ callbacks */

export async function dispatchCallback(cfg: TelegramConfig, cq: any, fallbackChat: number, platform: 'telegram' | 'bale' = 'telegram'): Promise<void> {
  const answerId: string = cq.id;
  const chatId: number = cq.message?.chat?.id || fallbackChat;
  const data: string = cq.data || '';

  const session = getSession(chatId);
  const ref = session.refs.get(data) || null;

  const botToken = (platform === 'bale' ? cfg.baleBotToken : cfg.telegramBotToken) || '';

  if (!ref) {
    await tgAnswerCallbackQuery(botToken, answerId, 'منقضی شده؛ /start را بزنید', true, platform);
    return;
  }

  const kind = ref.kind;

  try {
    /* --- pagination + noop --- */
    if (kind === 'noop') {
      await tgAnswerCallbackQuery(botToken, answerId, undefined, undefined, platform);
      return;
    }

    if (kind.startsWith('pg:')) {
      const name = kind.slice(3);
      const page = ref.page || 0;

      // The project's service list is scoped to that project, so it is rebuilt
      // here rather than through the generic account-scoped dispatcher.
      if (name === 'project-services') {
        const projectId = ref.projectId || getViewProject(chatId);
        const accountId = getSelectedAccount(chatId);
        const project = accountId && projectId ? findProject(accountId, projectId) : undefined;
        if (!accountId || !project) {
          await tgAnswerCallbackQuery(botToken || '', answerId, 'پروژه یافت نشد', true, platform);
          return;
        }
        const items = (project.services || []).map((s: any) => ({
          ref: {
            accountId,
            projectId: project.id,
            serviceId: s.id,
            environmentId: project.defaultEnvironmentId,
          },
          name: s.name || 'بدون نام',
          status: s.status || 'unknown',
        }));
        const { serviceListKeyboard } = await import('./keyboards');
        const { keyboard } = serviceListKeyboard(chatId, items, page, 'project-detail', 8, 'project-services');
        await tgEditMessageText(
          botToken || '',
          String(chatId),
          cq.message.message_id,
          `🖥 سرویس‌های ${project.name} (${items.length})`,
          keyboard,
          platform
        );
        await tgAnswerCallbackQuery(botToken, answerId, undefined, undefined, platform);
        return;
      }

      setLastScreen(chatId, name);
      await render(cfg, chatId, cq, name, page, platform);
      await tgAnswerCallbackQuery(botToken, answerId, undefined, undefined, platform);
      return;
    }

    /* --- generic confirmation --- */
    if (kind === 'cancel-confirm') {
      setConfirmPending(chatId, null);
      await tgAnswerCallbackQuery(botToken, answerId, 'لغو شد', undefined, platform);
      await render(cfg, chatId, cq, 'main', 0, platform);
      return;
    }

    if (kind.startsWith('confirm-')) {
      const action = kind.slice('confirm-'.length);
      const pending = getConfirmPending(chatId);
      if (!pending || pending.action !== action) {
        await tgAnswerCallbackQuery(botToken || '', answerId, 'درخواست منقضی شد', true, platform);
        return;
      }
      setConfirmPending(chatId, null);
      await tgAnswerCallbackQuery(botToken, answerId, 'در حال انجام…', undefined, platform);

      const out = await executeConfirmed(action, pending.params, chatId);
      if (out.text) await sendLong(botToken || '', chatId, out.text, platform);
      if (out.next) await render(cfg, chatId, cq, out.next, 0, platform);
      return;
    }

    /* --- plain screens --- */
    if (kind.startsWith('screen-')) {
      setLastScreen(chatId, kind);
      await render(cfg, chatId, cq, kind, 0, platform);
      await answerCbq(cfg, answerId, undefined, false, platform);
      return;
    }

    /* --- accounts --- */
    if (kind === 'account-add') {
      setAwaiting(chatId, { kind: 'account-token' });
      await answerCbq(cfg, answerId, undefined, false, platform);
      await sendMsg(cfg, chatId, 'توکن ریلوی اکانت جدید را ارسال کنید:\n\nبرای لغو /cancel', platform);
      return;
    }

    /* --- backup --- */
    if (kind === 'backup-send') {
      await tgAnswerCallbackQuery(botToken, answerId, 'در حال ساخت بکاپ…', undefined, platform);
      try {
        await sendBackup(cfg, chatId, platform);
      } catch (e: any) {
        await sendMsg(cfg, chatId, `❌ ارسال بکاپ ناموفق: ${e.message}`, platform);
      }
      return;
    }

    if (kind === 'backup-restore-last') {
      const last = lastBackupRecord();
      if (!last) {
        await tgAnswerCallbackQuery(botToken, answerId, 'بکاپی ثبت نشده', true, platform);
        return;
      }
      setConfirmPending(chatId, {
        action: 'backup-restore-last',
        params: { fileId: last.fileId },
        expiresAt: Date.now() + 60_000,
      });
      await answerCbq(cfg, answerId, undefined, false, platform);
      await tgSendMessageWithKeyboard(
        botToken || '',
        String(chatId),
        `⚠️ بازیابی از بکاپ ${last.fileName}\n` +
          `${last.at ? `تاریخ: ${new Date(last.at).toLocaleString('fa-IR')}\n` : ''}\n` +
          'اکانت‌ها و هشدارهای فعلی جایگزین می‌شوند. تأیید می‌کنید؟',
        confirmKbd(chatId, 'confirm-backup-restore-last', {}),
        platform
      );
      return;
    }

    if (kind === 'backup-restore-file') {
      setAwaiting(chatId, { kind: 'backup-json' });
      await answerCbq(cfg, answerId, undefined, false, platform);
      await sendMsg(cfg, chatId, 'فایل JSON بکاپ را بفرستید:\n\nبرای لغو /cancel', platform);
      return;
    }

    if (kind === 'account-select') {
      const account = findAccount(ref.accountId || '');
      setSelectedAccount(chatId, ref.accountId || null);
      await tgAnswerCallbackQuery(botToken, answerId, account ? `انتخاب شد: ${account.name}` : '', undefined, platform);
      await render(cfg, chatId, cq, 'account-detail', 0, platform);
      return;
    }

    if (kind === 'account-select-all') {
      setSelectedAccount(chatId, null);
      await tgAnswerCallbackQuery(botToken, answerId, 'نمای همه اکانت‌ها', undefined, platform);
      await render(cfg, chatId, cq, 'service-list', 0, platform);
      return;
    }

    if (kind === 'account-detail') {
      await answerCbq(cfg, answerId, undefined, false, platform);
      await render(cfg, chatId, cq, 'account-detail', 0, platform);
      return;
    }

    if (kind === 'account-projects' || kind === 'account-services') {
      if (ref.accountId) setSelectedAccount(chatId, ref.accountId);
      await answerCbq(cfg, answerId, undefined, false, platform);
      await render(cfg, chatId, cq, kind === 'account-projects' ? 'project-list' : 'service-list', 0, platform);
      return;
    }

    if (kind === 'account-sync') {
      const accountId = ref.accountId || getSelectedAccount(chatId);
      if (!accountId) {
        await tgAnswerCallbackQuery(botToken, answerId, 'اکانتی انتخاب نشده', true, platform);
        return;
      }
      await tgAnswerCallbackQuery(botToken, answerId, 'در حال همگام‌سازی…', undefined, platform);
      try {
        const updated = await syncAccount(accountId);
        await tgSendMessage(
          botToken || '',
          String(chatId),
          updated
            ? `✅ همگام‌سازی انجام شد\n📂 پروژه‌ها: ${updated.projects?.length || 0}\n💳 اعتبار: ${Math.max(0, updated.creditRemaining).toFixed(2)}$`
            : '❌ ارتباط با ریلوی برقرار نشد؛ چیزی تغییر نکرد.',
          platform
        );
      } catch (e: any) {
        await sendMsg(cfg, chatId, `❌ خطا: ${e.message}`, platform);
      }
      await render(cfg, chatId, cq, 'account-detail', 0, platform);
      return;
    }

    if (kind === 'account-delete-confirm') {
      const accountId = ref.accountId || getSelectedAccount(chatId);
      const account = accountId ? findAccount(accountId) : undefined;
      if (!account) {
        await tgAnswerCallbackQuery(botToken, answerId, 'اکانت یافت نشد', true, platform);
        return;
      }
      setConfirmPending(chatId, {
        action: 'account-delete',
        params: { accountId: account.id },
        expiresAt: Date.now() + 60_000,
      });
      await answerCbq(cfg, answerId, undefined, false, platform);
      await tgSendMessageWithKeyboard(
        botToken || '',
        String(chatId),
        `⚠️ حذف اکانت «${account.name}»\n\nاکانت از داشبورد حذف می‌شود (توکن و پروژه‌های محلی). روی ریلوی چیزی حذف نمی‌شود.\n\nتأیید می‌کنید؟`,
        confirmKbd(chatId, 'confirm-account-delete', { accountId: account.id }),
        platform
      );
      return;
    }

    if (kind === 'account-tags') {
      const accountId = ref.accountId || getSelectedAccount(chatId);
      const account = accountId ? findAccount(accountId) : undefined;
      if (!account) {
        await tgAnswerCallbackQuery(botToken, answerId, 'اکانت یافت نشد', true, platform);
        return;
      }
      const tags = account.tags || [];
      await answerCbq(cfg, answerId, undefined, false, platform);
      await tgSendMessageWithKeyboard(
        botToken || '',
        String(chatId),
        `🏷 تگ‌های ${account.name}\n\n${tags.length ? tags.map((t) => ` • ${t}`).join('\n') : 'بدون تگ'}\n\nبرای حذف یک تگ روی آن بزنید:`,
        [
          ...tags.map((t) => [
            { text: `🗑 ${t}`, callback_data: registerRef(chatId, { kind: 'tag-remove', accountId: account.id, extra: { tag: t } }) },
          ]),
          [{ text: '➕ افزودن تگ', callback_data: registerRef(chatId, { kind: 'tag-add', accountId: account.id }) }],
          ...backKeyboardRef(chatId, 'account-detail'),
        ],
        platform
      );
      return;
    }

    if (kind === 'tag-add') {
      const accountId = ref.accountId || getSelectedAccount(chatId);
      if (!accountId) return;
      setAwaiting(chatId, { kind: 'account-token', payload: { action: 'tag-add', accountId } });
      await answerCbq(cfg, answerId, undefined, false, platform);
      await sendMsg(cfg, chatId, 'نام تگ جدید را ارسال کنید:\n\nبرای لغو /cancel', platform);
      return;
    }

    if (kind === 'tag-remove') {
      const accountId = ref.accountId || getSelectedAccount(chatId);
      const tag = ref.extra?.tag || '';
      const account = accountId ? findAccount(accountId) : undefined;
      if (!account || !tag) {
        await tgAnswerCallbackQuery(botToken, answerId, 'تگ یافت نشد', true, platform);
        return;
      }
      const next = (account.tags || []).filter((t) => t !== tag);
      await updateAccountTags(account.id, next);
      await tgAnswerCallbackQuery(botToken, answerId, 'تگ حذف شد', undefined, platform);
      await sendMsg(cfg, chatId, `🗑 تگ «${tag}» حذف شد.`, platform);
      return;
    }

    /* --- projects --- */
    if (kind === 'project-open') {
      setViewProject(chatId, ref.projectId || null);
      setViewService(chatId, null);
      await answerCbq(cfg, answerId, undefined, false, platform);
      await render(cfg, chatId, cq, 'project-detail', 0, platform);
      return;
    }

    if (kind === 'project-detail') {
      await answerCbq(cfg, answerId, undefined, false, platform);
      await render(cfg, chatId, cq, 'project-detail', 0, platform);
      return;
    }

    if (kind === 'project-services') {
      if (ref.projectId) setViewProject(chatId, ref.projectId);
      await answerCbq(cfg, answerId, undefined, false, platform);
      const accountId = getSelectedAccount(chatId);
      const projectId = getViewProject(chatId);
      const project = accountId && projectId ? findProject(accountId, projectId) : undefined;
      if (!project) {
        await sendMsg(cfg, chatId, 'پروژه پیدا نشد.', platform);
        return;
      }
      const items = (project.services || []).map((s: any) => ({
        ref: { accountId: accountId!, projectId: project.id, serviceId: s.id, environmentId: project.defaultEnvironmentId },
        name: s.name || 'بدون نام',
        status: s.status || 'unknown',
      }));
      const { serviceListKeyboard } = await import('./keyboards');
      const { keyboard } = serviceListKeyboard(chatId, items, 0, 'project-detail', 8, 'project-services');
      await tgSendMessageWithKeyboard(
        botToken || '',
        String(chatId),
        `🖥 سرویس‌های ${project.name} (${items.length})`,
        keyboard,
        platform
      );
      return;
    }

    if (kind === 'project-add') {
      const accountId = getSelectedAccount(chatId);
      if (!accountId) {
        await tgAnswerCallbackQuery(botToken, answerId, 'اول یک اکانت انتخاب کنید', true, platform);
        return;
      }
      setAwaiting(chatId, { kind: 'project-name', payload: { accountId } });
      await answerCbq(cfg, answerId, undefined, false, platform);
      await sendMsg(cfg, chatId, '📂 نام پروژهٔ جدید را ارسال کنید:\n\nبرای لغو /cancel', platform);
      return;
    }

    if (kind === 'project-service-add') {
      const accountId = getSelectedAccount(chatId);
      if (!accountId) {
        await tgAnswerCallbackQuery(botToken, answerId, 'اول یک اکانت انتخاب کنید', true, platform);
        return;
      }
      if (ref.projectId) setViewProject(chatId, ref.projectId);
      const { serviceCreateKeyboard } = await import('./keyboards');
      await answerCbq(cfg, answerId, undefined, false, platform);
      await tgSendMessageWithKeyboard(
        botToken || '',
        String(chatId),
        '🚀 روش ساخت سرویس جدید در این پروژه:',
        serviceCreateKeyboard(chatId, accountId, ref.projectId),
        platform
      );
      return;
    }

    if (kind === 'project-delete-confirm') {
      const projectId = ref.projectId || getViewProject(chatId);
      const accountId = getSelectedAccount(chatId);
      const project = accountId && projectId ? findProject(accountId, projectId) : undefined;
      if (!accountId || !project) {
        await tgAnswerCallbackQuery(botToken, answerId, 'پروژه یافت نشد', true, platform);
        return;
      }
      setConfirmPending(chatId, {
        action: 'project-delete',
        params: { accountId, projectId: project.id },
        expiresAt: Date.now() + 60_000,
      });
      await answerCbq(cfg, answerId, undefined, false, platform);
      await tgSendMessageWithKeyboard(
        botToken || '',
        String(chatId),
        `⚠️ حذف پروژهٔ «${project.name}» با ${(project.services || []).length} سرویس.\n\nاین عملیات روی ریلوی غیرقابل بازگشت است.\nتأیید می‌کنید؟`,
        confirmKbd(chatId, 'confirm-project-delete', { accountId, projectId: project.id }),
        platform
      );
      return;
    }

    /* --- services --- */
    if (kind === 'service-open') {
      const serviceRef = refOf(chatId, ref);
      if (!serviceRef) {
        await tgAnswerCallbackQuery(botToken || '', answerId, 'سرویس یافت نشد', true, platform);
        return;
      }
      setViewService(chatId, serviceRef);
      await answerCbq(cfg, answerId, undefined, false, platform);
      await render(cfg, chatId, cq, 'service-detail', 0, platform);
      return;
    }

    if (kind === 'service-detail') {
      await answerCbq(cfg, answerId, undefined, false, platform);
      await render(cfg, chatId, cq, 'service-detail', 0, platform);
      return;
    }

    if (kind === 'service-add') {
      await answerCbq(cfg, answerId, undefined, false, platform);
      await render(cfg, chatId, cq, 'service-create', 0, platform);
      return;
    }

    /* --- service actions --- */
    if (kind === 'svc-delete-confirm') {
      const serviceRef = refOf(chatId, ref);
      if (!serviceRef) {
        await tgAnswerCallbackQuery(botToken || '', answerId, 'سرویس یافت نشد', true, platform);
        return;
      }
      const service = findService(serviceRef);
      setConfirmPending(chatId, {
        action: 'svc-delete',
        params: { accountId: serviceRef.accountId, projectId: serviceRef.projectId, serviceId: serviceRef.serviceId, environmentId: serviceRef.environmentId || '' },
        expiresAt: Date.now() + 60_000,
      });
      await answerCbq(cfg, answerId, undefined, false, platform);
      await tgSendMessageWithKeyboard(
        botToken || '',
        String(chatId),
        `⚠️ حذف سرویس «${service?.name || ''}»\n\nاین عملیات روی ریلوی غیرقابل بازگشت است.\nتأیید می‌کنید؟`,
        confirmKbd(chatId, 'confirm-svc-delete', {
          accountId: serviceRef.accountId,
          projectId: serviceRef.projectId,
          serviceId: serviceRef.serviceId,
          environmentId: serviceRef.environmentId || '',
        }),
        platform
      );
      return;
    }

    if (kind.startsWith('svc-') || kind.startsWith('svc_')) {
      const serviceRef = refOf(chatId, ref);
      if (!serviceRef) {
        await tgAnswerCallbackQuery(botToken || '', answerId, 'سرویس یافت نشد', true, platform);
        return;
      }
      setViewService(chatId, serviceRef);
      await tgAnswerCallbackQuery(botToken, answerId, 'در حال انجام…', undefined, platform);
      const out = await executeServiceAction(kind, serviceRef, chatId);
      if (out.text) await sendLong(botToken || '', chatId, out.text, platform);
      if (out.next) await render(cfg, chatId, cq, out.next, 0, platform);
      return;
    }

    /* --- domains / vars / volumes / settings --- */
    if (kind === 'domain-delete-confirm') {
      const serviceRef = refOf(chatId, ref);
      const domainId = ref.domainId || '';
      if (!serviceRef || !domainId) {
        await tgAnswerCallbackQuery(botToken || '', answerId, 'دامنه یافت نشد', true, platform);
        return;
      }
      setConfirmPending(chatId, {
        action: 'domain-delete',
        params: { accountId: serviceRef.accountId, id: domainId, kind: ref.domainKind || 'service' },
        expiresAt: Date.now() + 60_000,
      });
      await answerCbq(cfg, answerId, undefined, false, platform);
      await tgSendMessageWithKeyboard(
        botToken || '',
        String(chatId),
        '⚠️ حذف این دامنه؟ ترافیک این آدرس قطع می‌شود.',
        confirmKbd(chatId, 'confirm-domain-delete', {
          accountId: serviceRef.accountId,
          id: domainId,
          kind: ref.domainKind || 'service',
        }),
        platform
      );
      return;
    }

    if (kind === 'domain-add-sub' || kind === 'domain-add-custom') {
      const serviceRef = refOf(chatId, ref);
      const service = serviceRef ? findService(serviceRef) : undefined;
      if (!serviceRef) {
        await tgAnswerCallbackQuery(botToken || '', answerId, 'سرویس یافت نشد', true, platform);
        return;
      }
      const payload = {
        accountId: serviceRef.accountId,
        projectId: serviceRef.projectId,
        serviceId: serviceRef.serviceId,
        environmentId: serviceRef.environmentId || '',
        port: String(service?.port || 3000),
      };
      if (kind === 'domain-add-sub') {
        setAwaiting(chatId, { kind: 'domain-port', payload });
        await answerCbq(cfg, answerId, undefined, false, platform);
        await tgSendMessage(
          botToken || '',
          String(chatId),
          `پورت سرویس را ارسال کنید (پیش‌فرض ${payload.port}):\n\nبرای لغو /cancel`,
          platform
        );
      } else {
        setAwaiting(chatId, { kind: 'domain-custom', payload });
        await answerCbq(cfg, answerId, undefined, false, platform);
        await tgSendMessage(
          botToken || '',
          String(chatId),
          'دامنهٔ سفارشی را ارسال کنید (مثال: app.example.com):\n\nبرای لغو /cancel',
          platform
        );
      }
      return;
    }

    if (kind === 'var-add') {
      const serviceRef = refOf(chatId, ref);
      if (!serviceRef) {
        await tgAnswerCallbackQuery(botToken || '', answerId, 'سرویس یافت نشد', true, platform);
        return;
      }
      setAwaiting(chatId, {
        kind: 'var-name',
        payload: {
          accountId: serviceRef.accountId,
          projectId: serviceRef.projectId,
          serviceId: serviceRef.serviceId,
          environmentId: serviceRef.environmentId || '',
        },
      });
      await answerCbq(cfg, answerId, undefined, false, platform);
      await sendMsg(cfg, chatId, 'نام متغیر را ارسال کنید (مثال: DATABASE_URL):\n\nبرای لغو /cancel', platform);
      return;
    }

    if (kind === 'var-delete-confirm') {
      const serviceRef = refOf(chatId, ref);
      const name = ref.extra?.name || '';
      if (!serviceRef || !name) {
        await tgAnswerCallbackQuery(botToken || '', answerId, 'متغیر یافت نشد', true, platform);
        return;
      }
      setConfirmPending(chatId, {
        action: 'var-delete',
        params: { ...serviceRef, environmentId: serviceRef.environmentId || '', name },
        expiresAt: Date.now() + 60_000,
      });
      await answerCbq(cfg, answerId, undefined, false, platform);
      await tgSendMessageWithKeyboard(
        botToken || '',
        String(chatId),
        `⚠️ حذف متغیر «${name}»؟`,
        confirmKbd(chatId, 'confirm-var-delete', {
          accountId: serviceRef.accountId,
          projectId: serviceRef.projectId,
          serviceId: serviceRef.serviceId,
          environmentId: serviceRef.environmentId || '',
          name,
        }),
        platform
      );
      return;
    }

    if (kind === 'volume-add') {
      const serviceRef = refOf(chatId, ref);
      if (!serviceRef) {
        await tgAnswerCallbackQuery(botToken || '', answerId, 'سرویس یافت نشد', true, platform);
        return;
      }
      setAwaiting(chatId, {
        kind: 'volume-mount',
        payload: {
          accountId: serviceRef.accountId,
          projectId: serviceRef.projectId,
          serviceId: serviceRef.serviceId,
          environmentId: serviceRef.environmentId || '',
        },
      });
      await answerCbq(cfg, answerId, undefined, false, platform);
      await sendMsg(cfg, chatId, 'مسیر mount را ارسال کنید (پیش‌فرض /app/data):\n\nبرای لغو /cancel', platform);
      return;
    }

    if (kind === 'volume-delete-confirm') {
      const serviceRef = refOf(chatId, ref);
      const volumeId = ref.volumeId || '';
      if (!serviceRef || !volumeId) {
        await tgAnswerCallbackQuery(botToken || '', answerId, 'ولوم یافت نشد', true, platform);
        return;
      }
      setConfirmPending(chatId, {
        action: 'volume-delete',
        params: { accountId: serviceRef.accountId, volumeId },
        expiresAt: Date.now() + 60_000,
      });
      await answerCbq(cfg, answerId, undefined, false, platform);
      await tgSendMessageWithKeyboard(
        botToken || '',
        String(chatId),
        '⚠️ حذف این ولوم؟ تمام داده‌های روی دیسک پاک می‌شود.',
        confirmKbd(chatId, 'confirm-volume-delete', { accountId: serviceRef.accountId, volumeId }),
        platform
      );
      return;
    }

    if (kind.startsWith('setting-')) {
      const serviceRef = refOf(chatId, ref);
      if (!serviceRef) {
        await tgAnswerCallbackQuery(botToken || '', answerId, 'سرویس یافت نشد', true, platform);
        return;
      }
      const field = kind.slice('setting-'.length);
      const prompt: Record<string, string> = {
        build: 'دستور build را ارسال کنید (مثال: npm run build):',
        start: 'دستور start را ارسال کنید (مثال: npm start):',
        root: 'مسیر ریشه (Root Directory) را ارسال کنید (مثال: /apps/api):',
        health: 'مسیر healthcheck را ارسال کنید (مثال: /health):',
        builder: 'builder را انتخاب کنید — NIXPACKS یا DOCKERFILE:',
      };
      setAwaiting(chatId, {
        kind: (`setting-${field}`) as any,
        payload: {
          accountId: serviceRef.accountId,
          projectId: serviceRef.projectId,
          serviceId: serviceRef.serviceId,
          environmentId: serviceRef.environmentId || '',
        },
      });
      await answerCbq(cfg, answerId, undefined, false, platform);
      await sendMsg(cfg, chatId, `${prompt[field] || 'مقدار جدید را ارسال کنید:'}\n\nبرای لغو /cancel`, platform);
      return;
    }

    /* --- deploy flows --- */
    if (kind.startsWith('deploy-')) {
      const accountId = ref.accountId || getSelectedAccount(chatId);
      if (!accountId) {
        await tgAnswerCallbackQuery(botToken || '', answerId, 'اول یک اکانت انتخاب کنید', true, platform);
        return;
      }
      const projectId = targetProject(chatId, accountId, ref);
      const payload = { accountId, ...(projectId ? { projectId } : {}) };
      const flow = kind.slice('deploy-'.length);

      if (flow === 'github') {
        setAwaiting(chatId, { kind: 'github-repo', payload });
        await answerCbq(cfg, answerId, undefined, false, platform);
        await tgSendMessage(
          botToken || '',
          String(chatId),
          'آدرس ریپوی GitHub را ارسال کنید:\nowner/repo یا https://github.com/owner/repo\n\nبرای لغو /cancel',
          platform
        );
        return;
      }
      if (flow === 'image') {
        setAwaiting(chatId, { kind: 'image-name', payload });
        await answerCbq(cfg, answerId, undefined, false, platform);
        await tgSendMessage(
          botToken || '',
          String(chatId),
          'نام سرویس و ایمیج را در یک پیام بفرستید:\n<نام سرویس> | <image:tag> | <پورت>\n\nمثال:\napi | nginx:latest | 80\n\nبرای لغو /cancel',
          platform
        );
        return;
      }
      if (flow === 'source') {
        setAwaiting(chatId, { kind: 'source-tar', payload });
        await answerCbq(cfg, answerId, undefined, false, platform);
        await tgSendMessage(
          botToken || '',
          String(chatId),
          'فایل سورس را به‌صورت .tar.gz ارسال کنید.\n(فایل ‎.zip پشتیبانی نمی‌شود)\n\nبرای لغو /cancel',
          platform
        );
        return;
      }
      if (flow === 'compose') {
        setAwaiting(chatId, { kind: 'compose-file', payload });
        await answerCbq(cfg, answerId, undefined, false, platform);
        await tgSendMessage(
          botToken || '',
          String(chatId),
          'فایل docker-compose.yml را ارسال کنید (یا متن YAML را پیست کنید).\n\nبرای لغو /cancel',
          platform
        );
        return;
      }
    }

    // Any remaining unknown kind that names a real screen is a navigation
    // button (every "↩️ بازگشت" emits its target's screen name), so render it
    // instead of failing. This is what makes back buttons universally work.
    if (BACK_TARGET_SCREENS.has(kind)) {
      setLastScreen(chatId, kind);
      await render(cfg, chatId, cq, kind, 0, platform);
      await answerCbq(cfg, answerId, undefined, false, platform);
      return;
    }

    await tgAnswerCallbackQuery(botToken, answerId, 'دکمهٔ ناشناخته', true, platform);
  } catch (err: any) {
    console.error('[bot] callback error', err);
    await tgAnswerCallbackQuery(botToken, answerId, `خطا: ${truncate(err?.message || String(err), 90)}`, true, platform).catch(() => {});
  }
}

function confirmKbd(chatId: number, kind: string, params: Record<string, string>) {
  return [
    [
      { text: '✅ تأیید', callback_data: registerRef(chatId, { kind, extra: params }) },
      { text: '❌ لغو', callback_data: registerRef(chatId, { kind: 'cancel-confirm' }) },
    ],
  ];
}

function backKeyboardRef(chatId: number, screenName: string) {
  return [[{ text: '↩️ بازگشت', callback_data: registerRef(chatId, { kind: screenName }) }]];
}

/* ------------------------------------------------------- service actions */

async function executeServiceAction(
  kind: string,
  ref: { accountId: string; projectId: string; serviceId: string; environmentId?: string },
  chatId: number
): Promise<{ text?: string; next?: string }> {
  const auth = tokenFor(ref.accountId);
  const service = findService(ref);
  if (!auth || !service) return { text: 'سرویس یا اکانت پیدا نشد.' };

  const body = {
    token: auth.token,
    projectId: ref.projectId,
    serviceId: ref.serviceId,
    environmentId: ref.environmentId,
  };

  const run = async (label: string, path: string, payload: any = body) => {
    try {
      const data = await apiPost<any>(path, payload);
      const errors = data?.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        return `❌ ${label} ناموفق: ${errors[0]?.message || 'خطای ریلوی'}`;
      }
      await syncAccount(ref.accountId).catch(() => {});
      return `✅ ${label} انجام شد.`;
    } catch (e: any) {
      return `❌ ${label} ناموفق: ${e.message}`;
    }
  };

  switch (kind) {
    case 'svc-restart':
      return { text: await run('ریستارت', '/api/railway/service/restart'), next: 'service-detail' };

    case 'svc-redeploy':
      return { text: await run('دیپلوی مجدد', '/api/railway/service/redeploy'), next: 'service-detail' };

    case 'svc-update':
      return { text: await run('آپدیت از سورس', '/api/railway/service/manual-update'), next: 'service-detail' };

    case 'svc-stop':
      return { text: await run('توقف سرویس', '/api/railway/service/stop'), next: 'service-detail' };

    case 'svc-toggle': {
      const stopped = !!service.deploymentStopped || service.status === 'stopped';
      if (stopped) {
        return { text: await run('استارت سرویس', '/api/railway/service/restart'), next: 'service-detail' };
      }
      return { text: await run('توقف سرویس', '/api/railway/service/stop'), next: 'service-detail' };
    }

    case 'svc-domains':
      return { next: 'service-domains' };

    case 'svc-vars':
      return { next: 'service-vars' };

    case 'svc-volumes':
      return { next: 'service-volumes' };

    case 'svc-settings':
      return { next: 'service-settings' };

    case 'svc-log-deploy':
    case 'svc-log-build': {
      const which = kind === 'svc-log-deploy' ? 'deploy' : 'build';
      try {
        const logs = await fetchLogs(ref, which);
        const title = which === 'deploy' ? '📋 لاگ دیپلوی' : '📋 لاگ بیلد';
        return { text: `${title} — ${service.name}\n\n${truncate(logs, 12000)}` };
      } catch (e: any) {
        return { text: `❌ خطا در خواندن لاگ: ${e.message}` };
      }
    }

    default:
      return { text: `عملیات ${kind} پشتیبانی نمی‌شود.` };
  }
}

/* ------------------------------------------------- confirmed (destructive) */

async function executeConfirmed(
  action: string,
  params: Record<string, string>,
  chatId: number
): Promise<{ text?: string; next?: string }> {
  switch (action) {
    case 'account-delete': {
      const account = findAccount(params.accountId || '');
      if (!account) return { text: 'اکانت پیدا نشد.' };
      await deleteAccount(account.id);
      setSelectedAccount(chatId, null);
      return { text: `🗑 اکانت «${account.name}» حذف شد.`, next: 'screen-accounts' };
    }

    case 'project-delete': {
      const account = tokenFor(params.accountId);
      if (!account) return { text: 'اکانت پیدا نشد.' };
      const data = await apiPost<any>('/api/railway/project/delete', {
        token: account.token,
        projectId: params.projectId,
      });
      if (data?.errors?.length) return { text: `❌ ${data.errors[0]?.message}` };
      setViewProject(chatId, null);
      await syncAccount(params.accountId).catch(() => {});
      return { text: '🗑 پروژه حذف شد.', next: 'project-list' };
    }

    case 'svc-delete': {
      const auth = tokenFor(params.accountId);
      if (!auth) return { text: 'اکانت پیدا نشد.' };
      const data = await apiPost<any>('/api/railway/service/delete', {
        token: auth.token,
        serviceId: params.serviceId,
        environmentId: params.environmentId || undefined,
      });
      if (data?.errors?.length) return { text: `❌ ${data.errors[0]?.message}` };
      setViewService(chatId, null);
      await syncAccount(params.accountId).catch(() => {});
      return { text: '🗑 سرویس حذف شد.', next: 'service-list' };
    }

    case 'domain-delete': {
      try {
        await deleteDomain(params.accountId, params.id, (params.kind as 'service' | 'custom') || 'service');
        return { text: '🗑 دامنه حذف شد.', next: 'service-domains' };
      } catch (e: any) {
        return { text: `❌ ${e.message}` };
      }
    }

    case 'var-delete': {
      try {
        await deleteVariable(
          {
            accountId: params.accountId,
            projectId: params.projectId,
            serviceId: params.serviceId,
            environmentId: params.environmentId || undefined,
          },
          params.name
        );
        await syncAccount(params.accountId).catch(() => {});
        return { text: `🗑 متغیر «${params.name}» حذف شد.`, next: 'service-vars' };
      } catch (e: any) {
        return { text: `❌ ${e.message}` };
      }
    }

    case 'volume-delete': {
      try {
        await deleteVolume(params.accountId, params.volumeId);
        return { text: '🗑 ولوم حذف شد.', next: 'service-volumes' };
      } catch (e: any) {
        return { text: `❌ ${e.message}` };
      }
    }

    case 'backup-restore-last': {
      const cfg = readBotSettings();
      if (!cfg) return { text: 'تنظیمات تلگرام پیدا نشد.' };
      const last = lastBackupRecord();
      if (!last) return { text: 'بکاپی ثبت نشده است.' };
      try {
        const botToken = cfg.telegramBotToken || cfg.baleBotToken || '';
        const platform = cfg.baleBotToken && !cfg.telegramBotToken ? 'bale' : 'telegram';
        const buffer = await tgDownloadFileBuffer(botToken, last.fileId, platform);
        const result = applyBackupJson(buffer.toString('utf8'));
        if (!result.ok) return { text: `❌ بازیابی ناموفق: ${result.error}` };
        setSelectedAccount(chatId, null);
        setViewProject(chatId, null);
        return {
          text: `✅ بازیابی انجام شد.\n👤 ${result.accounts} اکانت · 🔔 ${result.alerts} هشدار`,
          next: 'screen-backup',
        };
      } catch (e: any) {
        return { text: `❌ بازیابی ناموفق: ${e.message}` };
      }
    }

    default:
      return { text: `عملیات ${action} ناشناخته است.` };
  }
}

/* --------------------------------------------------------------- text */

async function dispatchText(cfg: TelegramConfig, message: any, chatId: number, platform: 'telegram' | 'bale' = 'telegram'): Promise<void> {
  const text: string = (message.text || '').trim();
  const awaiting = getAwaiting(chatId);

  if (awaiting) {
    if (text === '/cancel') {
      setAwaiting(chatId, null);
      await sendMsg(cfg, chatId, 'لغو شد.', platform);
      await render(cfg, chatId, null, 'main', 0, platform);
      return;
    }
    try {
      await handleAwaiting(cfg, chatId, awaiting, text, message, platform);
    } catch (err: any) {
      setAwaiting(chatId, null);
      await sendMsg(cfg, chatId, `❌ خطا: ${err.message}`, platform);
    }
    return;
  }

  if (text === '/start' || text === '/menu') {
    await render(cfg, chatId, null, 'main', 0, platform);
    return;
  }
  if (text === '/status') {
    const { text: body, keyboard } = await screen(chatId, 'status');
    await sendMsgWithKeyboard(cfg, chatId, body, keyboard || [], platform);
    return;
  }
  if (text === '/help') {
    const botToken = platform === 'bale' ? cfg.baleBotToken : cfg.telegramBotToken;
    await tgSendMessage(
      botToken || '',
      String(chatId),
      'دستورها:\n' +
        '/menu — منوی اصلی\n' +
        '/status — وضعیت کلی\n' +
        '/cancel — لغو ورودی فعلی\n\n' +
        'همهٔ عملیات با دکمه‌ها انجام می‌شود. پس از انتخاب اکانت، فهرست‌ها فقط همان اکانت را نشان می‌دهند.',
      platform
    );
    return;
  }

  await sendMsg(cfg, chatId, 'دستور شناخته نشد. منوی اصلی:', platform);
  await render(cfg, chatId, null, 'main', 0, platform);
}

function serviceRefFromPayload(payload: Record<string, string> = {}) {
  return {
    accountId: payload.accountId || '',
    projectId: payload.projectId || '',
    serviceId: payload.serviceId || '',
    environmentId: payload.environmentId || undefined,
  };
}

async function handleAwaiting(
  cfg: TelegramConfig,
  chatId: number,
  awaiting: { kind: string; payload?: Record<string, string> },
  text: string,
  message: any,
  platform: 'telegram' | 'bale' = 'telegram'
): Promise<void> {
  const payload = awaiting.payload || {};
  const send = async (body: string): Promise<void> => {
    await sendMsg(cfg, chatId, truncate(body, 3900), platform);
  };

  // A file was sent where text was expected: many flows accept both.
  const document = message?.document;
  const fileId: string | undefined = document?.file_id;
  const fileName: string = document?.file_name || '';

  setAwaiting(chatId, null);

  const botToken = platform === 'bale' ? cfg.baleBotToken : cfg.telegramBotToken;

  switch (awaiting.kind) {
    case 'backup-json': {
      if (!fileId) return send('فایل JSON را به‌صورت Document بفرستید.');
      const buffer = await tgDownloadFileBuffer(botToken || '', fileId, platform);
      const result = applyBackupJson(buffer.toString('utf8'));
      if (!result.ok) return send(`❌ ${result.error}`);
      setSelectedAccount(chatId, null);
      setViewProject(chatId, null);
      await send(`✅ بازیابی انجام شد.\n👤 ${result.accounts} اکانت · 🔔 ${result.alerts} هشدار`);
      return render(cfg, chatId, null, 'screen-backup', 0, platform);
    }

    case 'account-token': {
      if (payload.action === 'tag-add') {
        const account = findAccount(payload.accountId || '');
        if (!account) return send('اکانت پیدا نشد.');
        const tag = text.slice(0, 32);
        const tags = Array.from(new Set([...(account.tags || []), tag]));
        await updateAccountTags(account.id, tags);
        return send(`🏷 تگ «${tag}» اضافه شد.`);
      }
      await send('در حال بررسی توکن…');
      const account = await addAccountFromToken(text);
      await syncAccount(account.id).catch(() => {});
      setSelectedAccount(chatId, account.id);
      await send(
        `✅ اکانت «${account.name}» اضافه شد.\n📂 ${account.projects?.length || 0} پروژه\n💳 ${Math.max(0, account.creditRemaining).toFixed(2)}$`
      );
      return render(cfg, chatId, null, 'account-detail', 0, platform);
    }

    case 'project-name': {
      const accountId = payload.accountId || getSelectedAccount(chatId);
      if (!accountId) return send('اکانتی انتخاب نشده است.');
      await send('در حال ساخت پروژه…');
      const projectId = await createProject(accountId, text);
      setViewProject(chatId, projectId);
      await send(`✅ پروژه «${text}» ساخته شد.`);
      return render(cfg, chatId, null, 'project-detail', 0, platform);
    }

    case 'github-repo': {
      const accountId = payload.accountId;
      if (!accountId) return send('اکانتی انتخاب نشده است.');
      // Ask for the branch next; repo is carried in the payload.
      setAwaiting(chatId, { kind: 'github-branch', payload: { ...payload, repo: text } });
      return send('نام برنچ را ارسال کنید (پیش‌فرض main):');
    }

    case 'github-branch': {
      const accountId = payload.accountId;
      const projectId = payload.projectId || targetProject(chatId, accountId, {});
      if (!accountId) return send('اکانتی انتخاب نشده است.');
      const branch = text || 'main';
      await send('⏳ در حال دیپلوی از GitHub… (تا چند دقیقه)');
      const result = await deployGithub(accountId, projectId || '', payload.repo, branch);
      if (!result.ok) return send(`❌ دیپلوی ناموفق: ${result.error}`);
      await reportDeploy(chatId, accountId, projectId || '', result.serviceId || null, result.status, result.error, platform);
      return;
    }

    case 'image-name': {
      const accountId = payload.accountId;
      if (!accountId) return send('اکانتی انتخاب نشده است.');
      const [name, image, port] = text.split('|').map((p) => p.trim());
      if (!name || !image) {
        return send('قالب درست:\n<نام سرویس> | <image:tag> | <پورت>\nمثال:\napi | nginx:latest | 80');
      }
      await send('⏳ در حال ساخت سرویس…');
      const projectId = payload.projectId || targetProject(chatId, accountId, {}) || (await placeholderProject(accountId));
      const created = await createService(accountId, projectId, { name, image, port: Number(port) || undefined });
      if (created.serviceId && port) {
        const ref = {
          accountId,
          projectId: created.projectId,
          serviceId: created.serviceId,
          environmentId: findProject(accountId, created.projectId)?.defaultEnvironmentId,
        };
        try {
          const domain = await createSubdomain(ref, Number(port));
          if (domain) await send(`🌐 دامنه: ${domain}`);
        } catch (e: any) {
          await send(`⚠️ ساخت دامنه ناموفق: ${e.message}`);
        }
      }
      await send(`✅ سرویس «${name}» ساخته شد.`);
      if (created.serviceId) {
        setViewService(chatId, {
          accountId,
          projectId: created.projectId,
          serviceId: created.serviceId,
          environmentId: findProject(accountId, created.projectId)?.defaultEnvironmentId,
        });
        return render(cfg, chatId, null, 'service-detail', 0, platform);
      }
      return render(cfg, chatId, null, 'service-list', 0, platform);
    }

    case 'compose-file': {
      const accountId = payload.accountId;
      if (!accountId) return send('اکانتی انتخاب نشده است.');
      let yaml = text;
      if (fileId) yaml = (await tgDownloadFileBuffer(botToken || '', fileId, platform)).toString('utf8');
      if (!yaml.trim()) return send('فایل یا متن YAML خالی است.');
      await send('⏳ در حال ایمپورت Compose…');
      const projectId = payload.projectId || targetProject(chatId, accountId, {}) || (await placeholderProject(accountId));
      const result = await deployDockerCompose(accountId, projectId, yaml);
      if (!result.ok) return send(`❌ ${result.error}`);
      await send('✅ Compose ایمپورت شد.');
      await render(cfg, chatId, null, 'service-list', 0, platform);
      return;
    }

    case 'source-tar': {
      const accountId = payload.accountId;
      if (!accountId) return send('اکانتی انتخاب نشده است.');
      if (!fileId) return send('فایل .tar.gz را به‌صورت Document ارسال کنید.');
      if (!/\.(tar\.gz|tgz)$/i.test(fileName)) {
        return send('فقط .tar.gz پشتیبانی می‌شود (zip نه).');
      }
      await send('⏳ دریافت و آپلود سورس… (تا چند دقیقه)');
      const archive = await tgDownloadFileBuffer(botToken || '', fileId, platform);

      let envFromArchive: Record<string, string> = {};
      try {
        envFromArchive = readEnvFromArchive(archive);
      } catch {
        // Best effort only — a malformed archive must not block the deploy.
      }

      const projectId = payload.projectId || targetProject(chatId, accountId, {}) || (await placeholderProject(accountId));
      const result = await deploySourceUpload(accountId, projectId, archive, undefined);
      if (!result.ok) return send(`❌ دیپلوی ناموفق: ${result.error}`);

      if (result.serviceId && Object.keys(envFromArchive).length > 0) {
        const ref = {
          accountId,
          projectId,
          serviceId: result.serviceId,
          environmentId: findProject(accountId, projectId)?.defaultEnvironmentId,
        };
        for (const [k, v] of Object.entries(envFromArchive)) {
          await upsertVariable(ref, k, v).catch(() => {});
        }
        await send(`🔑 ${Object.keys(envFromArchive).length} متغیر از فایل .env خوانده شد.`);
      }

      await reportDeploy(chatId, accountId, projectId, result.serviceId || null, result.status, result.error, platform);
      return;
    }

    case 'var-name': {
      setAwaiting(chatId, { kind: 'var-value', payload: { ...payload, name: text } });
      return send(`مقدار متغیر «${text}» را ارسال کنید:`);
    }

    case 'var-value': {
      const ref = serviceRefFromPayload(payload);
      const name = payload.name || '';
      if (!ref.accountId || !ref.serviceId || !name) return send('اطلاعات ناقص است.');
      await upsertVariable(ref, name, text);
      await syncAccount(ref.accountId).catch(() => {});
      await send(`✅ متغیر «${name}» ذخیره شد.`);
      return render(cfg, chatId, null, 'service-vars', 0, platform);
    }

    case 'domain-port': {
      const ref = serviceRefFromPayload(payload);
      const port = Number(text) || Number(payload.port) || 3000;
      const domain = await createSubdomain(ref, port);
      await send(domain ? `✅ دامنه ساخته شد:\n${domain}` : '⚠️ دامنه ساخته شد ولی آدرس برنگشت.');
      return render(cfg, chatId, null, 'service-domains', 0, platform);
    }

    case 'domain-custom': {
      const ref = serviceRefFromPayload(payload);
      const account = tokenFor(ref.accountId);
      if (!account) return send('اکانت پیدا نشد.');
      const data = await apiPost<any>('/api/railway/domain/create-custom', {
        token: account.token,
        projectId: ref.projectId,
        environmentId: ref.environmentId,
        serviceId: ref.serviceId,
        domain: text,
        targetPort: Number(payload.port) || 3000,
      });
      if (data?.errors?.length) return send(`❌ ${data.errors[0]?.message}`);
      const records = data?.data?.customDomainCreate?.status?.dnsRecords || [];
      const dns = records.map((r: any) => `• ${r.type} ${r.name} → ${r.value}`).join('\n');
      await send(`✅ دامنهٔ «${text}» اضافه شد.${dns ? `\n\nرکوردهای DNS:\n${dns}` : ''}`);
      return render(cfg, chatId, null, 'service-domains', 0, platform);
    }

    case 'volume-mount': {
      const ref = serviceRefFromPayload(payload);
      const mountPath = text.startsWith('/') ? text : '/app/data';
      await createVolume(ref, mountPath);
      await send(`✅ ولوم روی ${mountPath} ساخته شد.`);
      return render(cfg, chatId, null, 'service-volumes', 0, platform);
    }

    case 'setting-build':
    case 'setting-start':
    case 'setting-root':
    case 'setting-health':
    case 'setting-builder': {
      const ref = serviceRefFromPayload(payload);
      const map = {
        'setting-build': { buildCommand: text },
        'setting-start': { startCommand: text },
        'setting-root': { rootDirectory: text },
        'setting-health': { healthcheckPath: text },
        'setting-builder': { builder: text.toUpperCase() },
      } as const;
      await updateServiceSettings(ref, map[awaiting.kind as keyof typeof map]);
      await send('✅ تنظیم ذخیره شد.');
      return render(cfg, chatId, null, 'service-settings', 0, platform);
    }

    default:
      return send('ورودی غیرمنتظره؛ از منو ادامه دهید.');
  }
}

/** Build a minimal .env map from files inside a source archive. */
function readEnvFromArchive(archive: Buffer): Record<string, string> {
  const entries = extractTarGz(archive);
  const envEntry = entries.find((e) => /(^|\/)\.env(\.example|\.sample)?$/.test(e.name));
  if (!envEntry) return {};
  const out: Record<string, string> = {};
  for (const line of envEntry.data.toString('utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}

async function placeholderProject(accountId: string): Promise<string> {
  const existing = listProjects(accountId)[0];
  if (existing) return existing.id;
  return createProject(accountId, 'Railway Hub');
}

async function reportDeploy(
  chatId: number,
  accountId: string,
  projectId: string,
  serviceId: string | null,
  status?: string,
  error?: string,
  platform: 'telegram' | 'bale' = 'telegram'
): Promise<void> {
  const cfg = readBotSettings();
  if (!cfg) return;

  const botToken = platform === 'bale' ? cfg.baleBotToken : cfg.telegramBotToken;
  if (!botToken) return;

  if (serviceId) {
    const project = findProject(accountId, projectId);
    setViewService(chatId, {
      accountId,
      projectId,
      serviceId,
      environmentId: project?.defaultEnvironmentId,
    });
  }

  const failed = status === 'FAILED' || status === 'CRASHED';
  const lines = [
    failed ? '❌ دیپلوی ناموفق' : '✅ دیپلوی انجام شد',
    status ? `وضعیت نهایی: ${status}` : '',
  ].filter(Boolean);

  await sendMsg(cfg, chatId, truncate(lines.join('\n'), 3900), platform);

  if (failed && serviceId) {
    try {
      const logs = await fetchLogs(
        {
          accountId,
          projectId,
          serviceId,
          environmentId: findProject(accountId, projectId)?.defaultEnvironmentId,
        },
        'build'
      );
      const tail = logs.split('\n').slice(-25).join('\n');
      await sendLong(botToken, chatId, `📋 انتهای لاگ بیلد:\n\n${tail}`, platform);
    } catch {
      // Log tail is diagnostic only.
    }
  }

  await render(cfg, chatId, null, serviceId ? 'service-detail' : 'service-list', 0, platform);
}

/* ------------------------------------------------------------- polling */

export async function runPollingLoop(initial: TelegramConfig, platform: 'telegram' | 'bale'): Promise<void> {
  const { getPollLoopGeneration } = await import('./index');
  const startGeneration = getPollLoopGeneration();
  let offset = platform === 'bale' ? (initial.baleLastUpdateOffset || 0) : (initial.telegramLastUpdateOffset || 0);
  const tokenField = platform === 'bale' ? 'baleBotToken' : 'telegramBotToken';
  const chatField = platform === 'bale' ? 'baleChatId' : 'telegramChatId';
  const offsetField = platform === 'bale' ? 'baleLastUpdateOffset' : 'telegramLastUpdateOffset';

  while (true) {
    if (getPollLoopGeneration() !== startGeneration) {
      console.log(`[bot:${platform}] stopping old polling loop (generation changed)`);
      break;
    }
    const cfg = readBotSettings();
    const botToken = platform === 'bale' ? cfg?.baleBotToken : cfg?.telegramBotToken;
    const chatId = platform === 'bale' ? cfg?.baleChatId : cfg?.telegramChatId;
    const platformEnabled = platform === 'bale' ? cfg?.baleEnabled : cfg?.telegramEnabled;

    if (!cfg || !botToken || !chatId || cfg.botEnabled === false || platformEnabled === false) {
      await new Promise((r) => setTimeout(r, 15_000));
      continue;
    }

    try {
      const updates = await tgGetUpdates(botToken, offset, 25, platform);

      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);

        const updateChatId: number = update.callback_query?.message?.chat?.id || update.message?.chat?.id || 0;
        if (!updateChatId) continue;

        if (!isAllowed(updateChatId, cfg)) {
          if (update.message) {
            await tgSendMessage(botToken, String(updateChatId), '⛔ دسترسی ندارید.', platform).catch(() => {});
          }
          continue;
        }

        try {
          if (update.callback_query) await dispatchCallback(cfg, update.callback_query, updateChatId, platform);
          else if (update.message) await dispatchText(cfg, update.message, updateChatId, platform);
        } catch (err) {
          console.error(`[bot:${platform}] dispatch error`, err);
        }
      }

      // Persist the offset once per batch (not per update).
      if (updates.length > 0) {
        const current = readBotSettings();
        if (current) {
          const { writeBotSettings } = await import('../stateStore');
          const updated = { ...current };
          if (platform === 'bale') {
            updated.baleLastUpdateOffset = offset;
          } else {
            updated.telegramLastUpdateOffset = offset;
          }
          writeBotSettings(updated);
        }
      }
    } catch (err: any) {
      if (err?.code === 429) {
        await new Promise((r) => setTimeout(r, Number(err.retry_after || 3) * 1000));
        continue;
      }
      console.error(`[bot:${platform}] polling error:`, err?.message || err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

/* -------------------------------------------------------- notifications */

/** Map Telegram errors to the Persian messages shown in the UI. */
function severityPrefix(severity: 'info' | 'warning' | 'critical'): string {
  return severity === 'critical' ? '🚨 ' : severity === 'warning' ? '⚠️ ' : 'ℹ️ ';
}

export async function sendNotification(
  cfg: TelegramConfig,
  title: string,
  message: string,
  severity: 'info' | 'warning' | 'critical' = 'info',
  platform?: 'telegram' | 'bale'
): Promise<void> {
  if (cfg.notificationsEnabled === false) return;
  const adminList = adminIds(cfg);

  // اگر platform مشخص نشده، برای هردو ارسال کن
  const platforms: Array<'telegram' | 'bale'> = platform ? [platform] : [];
  if (!platform) {
    if (cfg.telegramBotToken && cfg.telegramEnabled !== false) platforms.push('telegram');
    if (cfg.baleBotToken && cfg.baleEnabled !== false) platforms.push('bale');
  }

  for (const plat of platforms) {
    const botToken = plat === 'bale' ? cfg.baleBotToken : cfg.telegramBotToken;
    const platformEnabled = plat === 'bale' ? cfg.baleEnabled : cfg.telegramEnabled;
    if (!botToken || platformEnabled === false) continue;

    for (const adminId of adminList) {
      await tgSendMessage(
        botToken,
        adminId,
        `${severityPrefix(severity)}${title}\n${message}`,
        plat
      ).catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}