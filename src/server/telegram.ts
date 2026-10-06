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

async function tgCall<T = any>(token: string, method: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithRetry(`https://api.telegram.org/bot${token}/${method}`, init);

  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new TelegramError('invalid response', res.status);
  }

  if (!body?.ok) {
    throw new TelegramError(body?.description || 'Telegram API error', body?.error_code || res.status);
  }
  return body.result as T;
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

export async function tgSendMessage(token: string, chatId: string, text: string): Promise<number> {
  const result = await tgCall<any>(token, 'sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
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
  fileName: string
): Promise<SentDocument> {
  const fd = new FormData();
  fd.append('chat_id', chatId);
  fd.append('document', new Blob([content], { type: 'application/json' }), fileName);
  fd.append('caption', `پشتیبان دیتابیس — ${fileName}`);

  const result = await tgCall<any>(token, 'sendDocument', { method: 'POST', body: fd });
  return {
    messageId: typeof result?.message_id === 'number' ? result.message_id : 0,
    fileId: typeof result?.document?.file_id === 'string' ? result.document.file_id : '',
    fileName:
      typeof result?.document?.file_name === 'string' ? result.document.file_name : fileName,
  };
}

/** Resolve a file_id to its downloadable path and return the file text. */
export async function tgDownloadFile(token: string, fileId: string): Promise<string> {
  const result = await tgCall<any>(token, 'getFile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  });

  const filePath = result?.file_path;
  if (typeof filePath !== 'string' || !filePath) {
    throw new TelegramError('file not found', 400);
  }

  const res = await fetchWithRetry(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!res.ok) throw new TelegramError('download failed', res.status);
  return res.text();
}
