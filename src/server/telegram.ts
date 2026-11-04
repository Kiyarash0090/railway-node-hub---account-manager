/** Thin Telegram Bot API client — all calls go server-side so the bot token
 *  never reaches the browser for outbound requests and CORS is a non-issue. */

export class TelegramError extends Error {
  code: number;
  constructor(message: string, code = 0) {
    super(message);
    this.code = code;
  }
}

/** Connections to api.telegram.org get reset intermittently on some networks;
 *  a couple of quick retries turns those into success instead of a user-facing
 *  «خطا در ارتباط با تلگرام». */
async function fetchWithRetry(url: string, init?: RequestInit, attempts = 3): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch {
      if (attempt >= attempts) throw new TelegramError('network', 0);
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
}

export async function botApi<T = any>(
  token: string,
  method: string,
  init?: RequestInit,
  platform: 'telegram' | 'bale' = 'telegram'
): Promise<T> {
  const base = platform === 'bale' ? 'https://tapi.bale.ai' : 'https://api.telegram.org';
  const res = await fetchWithRetry(`${base}/bot${token}/${method}`, init);

  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new TelegramError('invalid response', res.status);
  }

  if (!body?.ok) {
    throw new TelegramError(body?.description || 'Bot API error', body?.error_code || res.status);
  }
  return body.result as T;
}

/** Backwards-compatible Telegram-only wrapper around botApi. */
export async function tgCall<T = any>(token: string, method: string, init?: RequestInit): Promise<T> {
  return botApi(token, method, init, 'telegram');
}

/** Map Telegram errors to the Persian messages shown in the UI. */
export function tgErrorToPersian(err: unknown): string {
  if (err instanceof TelegramError) {
    if (err.message === 'network') {
      return 'خطا در ارتباط با تلگرام؛ اتصال اینترنت را بررسی کنید';
    }
    const m = err.message.toLowerCase();
    if (err.code === 401 || m.includes('unauthorized')) return 'توکن ربات نامعتبر است';
    if (m.includes('chat not found')) return 'شناسه چت یافت نشد';
    if (m.includes('bot was blocked') || m.includes("bot can't initiate")) {
      return 'ربات در این چت بلاک شده است یا به آن دسترسی ندارد';
    }
    if (err.code === 429) return 'به سقف درخواست تلگرام رسیدید؛ کمی بعد دوباره تلاش کنید';
    return err.message;
  }
  return 'خطای ناشناخته در تلگرام';
}

export async function tgGetMe(token: string): Promise<{ username: string; firstName: string }> {
  const result = await tgCall<any>(token, 'getMe');
  return {
    username: typeof result?.username === 'string' ? result.username : '',
    firstName: typeof result?.first_name === 'string' ? result.first_name : '',
  };
}

export async function tgSendMessage(
  token: string,
  chatId: string | number,
  text: string,
  platform: 'telegram' | 'bale' = 'telegram'
): Promise<number> {
  const result = await botApi<any>(token, 'sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: String(chatId), text }),
  }, platform);
  return typeof result?.message_id === 'number' ? result.message_id : 0;
}

export interface SentDocument {
  messageId: number;
  fileId: string;
  fileName: string;
}

export async function tgSendDocument(
  token: string,
  chatId: string,
  content: string,
  fileName: string,
  platform: 'telegram' | 'bale' = 'telegram'
): Promise<SentDocument> {
  const fd = new FormData();
  fd.append('chat_id', chatId);
  fd.append('document', new Blob([content], { type: 'application/json' }), fileName);
  fd.append('caption', `پشتیبان دیتابیس — ${fileName}`);

  const result = await botApi<any>(token, 'sendDocument', { method: 'POST', body: fd }, platform);
  return {
    messageId: typeof result?.message_id === 'number' ? result.message_id : 0,
    fileId: typeof result?.document?.file_id === 'string' ? result.document.file_id : '',
    fileName:
      typeof result?.document?.file_name === 'string' ? result.document.file_name : fileName,
  };
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export async function tgSendMessageWithKeyboard(
  token: string,
  chatId: string | number,
  text: string,
  keyboard: InlineKeyboardButton[][],
  platform: 'telegram' | 'bale' = 'telegram'
): Promise<number> {
  const result = await botApi<any>(token, 'sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: keyboard },
    }),
  }, platform);
  return typeof result?.message_id === 'number' ? result.message_id : 0;
}

export async function tgEditMessageText(
  token: string,
  chatId: string | number,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboardButton[][],
  platform: 'telegram' | 'bale' = 'telegram'
): Promise<void> {
  await botApi(token, 'editMessageText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    }),
  }, platform);
}

export async function tgAnswerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false,
  platform: 'telegram' | 'bale' = 'telegram'
): Promise<void> {
  await botApi(token, 'answerCallbackQuery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
      show_alert: showAlert,
    }),
  }, platform);
}

export interface TelegramUpdate {
  update_id: number;
  message?: any;
  callback_query?: any;
}

export async function tgGetUpdates(
  token: string,
  offset: number,
  timeout = 25,
  platform: 'telegram' | 'bale' = 'telegram'
): Promise<TelegramUpdate[]> {
  return botApi<TelegramUpdate[]>(token, 'getUpdates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset, timeout, allowed_updates: ['message', 'callback_query'] }),
  }, platform);
}

export async function tgSendDocumentByBuffer(
  token: string,
  chatId: string | number,
  buffer: Buffer,
  fileName: string,
  caption?: string,
  platform: 'telegram' | 'bale' = 'telegram'
): Promise<SentDocument> {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('document', new Blob([Buffer.from(buffer)], { type: 'application/octet-stream' }), fileName);
  if (caption) fd.append('caption', caption);

  const result = await botApi<any>(token, 'sendDocument', { method: 'POST', body: fd }, platform);
  return {
    messageId: typeof result?.message_id === 'number' ? result.message_id : 0,
    fileId: typeof result?.document?.file_id === 'string' ? result.document.file_id : '',
    fileName: typeof result?.document?.file_name === 'string' ? result.document.file_name : fileName,
  };
}

export async function tgDeleteMessage(
  token: string,
  chatId: string,
  messageId: number,
  platform: 'telegram' | 'bale' = 'telegram'
): Promise<void> {
  await botApi(token, 'deleteMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
  }, platform);
}

/** Helper: resolve base URL for a platform. */
export function botBaseUrl(platform: 'telegram' | 'bale'): string {
  return platform === 'bale' ? 'https://tapi.bale.ai' : 'https://api.telegram.org';
}

/** Download a file from Telegram/Bale file servers. */
export async function botDownloadFile(
  token: string,
  fileId: string,
  platform: 'telegram' | 'bale' = 'telegram'
): Promise<string> {
  const result = await botApi<any>(token, 'getFile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  }, platform);

  const filePath = result?.file_path;
  if (typeof filePath !== 'string' || !filePath) {
    throw new TelegramError('file not found', 400);
  }

  const res = await fetchWithRetry(`${botBaseUrl(platform)}/file/bot${token}/${filePath}`);
  if (!res.ok) throw new TelegramError('download failed', res.status);
  return res.text();
}

/** Same as botDownloadFile but keeps the bytes (compose files, tar.gz uploads). */
export async function botDownloadFileBuffer(
  token: string,
  fileId: string,
  platform: 'telegram' | 'bale' = 'telegram'
): Promise<Buffer> {
  const result = await botApi<any>(token, 'getFile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  }, platform);

  const filePath = result?.file_path;
  if (typeof filePath !== 'string' || !filePath) {
    throw new TelegramError('file not found', 400);
  }

  const res = await fetchWithRetry(`${botBaseUrl(platform)}/file/bot${token}/${filePath}`);
  if (!res.ok) throw new TelegramError('download failed', res.status);
  return Buffer.from(await res.arrayBuffer());
}

/** Legacy wrappers kept for backwards compatibility with server.ts. */
export const tgDownloadFile = botDownloadFile;
export const tgDownloadFileBuffer = botDownloadFileBuffer;
