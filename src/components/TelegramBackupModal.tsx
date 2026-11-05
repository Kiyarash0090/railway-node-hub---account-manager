import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Send,
  Save,
  Zap,
  Upload,
  Download,
  RotateCcw,
  DatabaseBackup,
  ArchiveRestore,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import type { TelegramConfig } from '../types';
import {
  getTelegramConfig,
  saveTelegramConfig,
  saveBotSettings,
  getBotStatus,
  testTelegramConnection,
  backupToTelegram,
  restoreFromTelegram,
  downloadLocalBackup,
  restoreLocalBackup,
} from '../services/telegramApi';

interface TelegramBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Feedback = { kind: 'success' | 'error'; text: string } | null;
type Busy = 'save' | 'test' | 'backup' | 'restore-tg' | 'restore-file' | null;
type ConfirmStep = 'tg' | 'file' | null;

const inputClass =
  'w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white placeholder:text-neutral-600 focus:border-sky-500/50 focus:outline-none transition';

const secondaryBtn =
  'flex items-center justify-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs font-bold text-neutral-200 hover:border-neutral-700 hover:bg-neutral-800 transition disabled:opacity-40 disabled:cursor-not-allowed btn-press';

const primaryBtn =
  'flex items-center justify-center gap-1.5 rounded-xl bg-sky-500 px-3 py-2 text-xs font-bold text-white hover:bg-sky-600 transition disabled:opacity-40 disabled:cursor-not-allowed btn-press';

export const TelegramBackupModal: React.FC<TelegramBackupModalProps> = ({ isOpen, onClose }) => {
  const [config, setConfig] = useState<TelegramConfig | null>(null);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [baleBotToken, setBaleBotToken] = useState('');
  const [baleChatId, setBaleChatId] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirm, setConfirm] = useState<ConfirmStep>(null);
  const [pendingFile, setPendingFile] = useState<{ name: string; data: unknown } | null>(null);
  const [restored, setRestored] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [botStatus, setBotStatus] = useState<{ configured: boolean; enabled: boolean; monitorEnabled: boolean; notificationsEnabled: boolean } | null>(null);
  const [botEnabled, setBotEnabled] = useState(false);
  const [telegramEnabled, setTelegramEnabled] = useState(true);
  const [baleEnabled, setBaleEnabled] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [monitorEnabled, setMonitorEnabled] = useState(false);
  const [monitorInterval, setMonitorInterval] = useState(5);
  const [creditThreshold, setCreditThreshold] = useState(0.1);
  const [adminChatIdsInput, setAdminChatIdsInput] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setFeedback(null);
    setConfirm(null);
    setPendingFile(null);
    setRestored(false);
    setBusy(null);

    let cancelled = false;
    getTelegramConfig()
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        setTelegramBotToken(cfg?.telegramBotToken || '');
        setTelegramChatId(cfg?.telegramChatId || '');
        setBaleBotToken(cfg?.baleBotToken || '');
        setBaleChatId(cfg?.baleChatId || '');
        setBotEnabled(cfg?.botEnabled === true);
        setTelegramEnabled(cfg?.telegramEnabled !== false);
        setBaleEnabled(cfg?.baleEnabled !== false);
        setNotificationsEnabled(cfg?.notificationsEnabled !== false);
        setMonitorEnabled(cfg?.monitorEnabled === true);
        setMonitorInterval(cfg?.monitorIntervalMinutes ?? 5);
        setCreditThreshold(cfg?.creditAlertThreshold ?? 0.1);
        setAdminChatIdsInput((cfg?.adminChatIds || []).join(', '));
        getBotStatus()
          .then(setBotStatus)
          .catch(() => {});
      })
      .catch((err: Error) => {
        if (!cancelled) setFeedback({ kind: 'error', text: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const hasSavedConfig = (!!config?.telegramBotToken && !!config?.telegramChatId) || (!!config?.baleBotToken && !!config?.baleChatId);

  const finishRestore = () => {
    setRestored(true);
    setTimeout(() => window.location.reload(), 1400);
  };

  const doSave = async () => {
    setBusy('save');
    setFeedback(null);
    try {
      const adminChatIds = adminChatIdsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const cfg = await saveBotSettings({
        telegramBotToken: telegramBotToken.trim() || undefined,
        telegramChatId: telegramChatId.trim() || undefined,
        telegramEnabled,
        baleBotToken: baleBotToken.trim() || undefined,
        baleChatId: baleChatId.trim() || undefined,
        baleEnabled,
        botEnabled,
        adminChatIds,
        notificationsEnabled,
        monitorEnabled,
        monitorIntervalMinutes: monitorInterval,
        creditAlertThreshold: creditThreshold,
      });
      setConfig(cfg);
      getBotStatus().then(setBotStatus).catch(() => {});
      setFeedback({ kind: 'success', text: 'تنظیمات بات ذخیره شد' });
    } catch (err) {
      setFeedback({ kind: 'error', text: (err as Error).message });
    }
    setBusy(null);
  };

  const doTest = async (platform: 'telegram' | 'bale') => {
    setBusy('test');
    setFeedback(null);
    try {
      const r = await testTelegramConnection(
        platform === 'telegram' ? telegramBotToken.trim() || undefined : undefined,
        platform === 'telegram' ? telegramChatId.trim() || undefined : undefined,
        platform === 'bale' ? baleBotToken.trim() || undefined : undefined,
        platform === 'bale' ? baleChatId.trim() || undefined : undefined
      );

      const messages: string[] = [];

      if (r.telegram) {
        const bot = r.telegram.botUsername ? `@${r.telegram.botUsername}` : 'بات تلگرام';
        messages.push(
          r.telegram.messageSent
            ? `تلگرام: اتصال موفق — پیام تست ارسال شد (${bot})`
            : `تلگرام: اتصال بات تأیید شد: ${bot} — برای ارسال پیام، شناسه چت را وارد و ذخیره کنید`
        );
      }

      if (r.bale) {
        const bot = r.bale.botUsername ? `@${r.bale.botUsername}` : 'بات بله';
        messages.push(
          r.bale.messageSent
            ? `بله: اتصال موفق — پیام تست ارسال شد (${bot})`
            : `بله: اتصال بات تأیید شد: ${bot} — برای ارسال پیام، شناسه چت را وارد و ذخیره کنید`
        );
      }

      setFeedback({
        kind: 'success',
        text: messages.length > 0 ? messages.join(' | ') : 'هیچ پیام‌رسانی برای تست انتخاب نشده',
      });
    } catch (err) {
      setFeedback({ kind: 'error', text: (err as Error).message });
    }
    setBusy(null);
  };

  const doBackup = async () => {
    setBusy('backup');
    setFeedback(null);
    try {
      const r = await backupToTelegram();
      const cfg = await getTelegramConfig().catch(() => null);
      if (cfg) setConfig(cfg);
      setFeedback({
        kind: 'success',
        text: `بک‌اپ با موفقیت به تلگرام ارسال شد (${r.fileName})`,
      });
    } catch (err) {
      setFeedback({ kind: 'error', text: (err as Error).message });
    }
    setBusy(null);
  };

  const doRestoreFromTelegram = async () => {
    setConfirm(null);
    setBusy('restore-tg');
    setFeedback(null);
    try {
      await restoreFromTelegram();
      finishRestore();
    } catch (err) {
      setFeedback({ kind: 'error', text: (err as Error).message });
      setBusy(null);
    }
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFeedback(null);
    setConfirm(null);
    setPendingFile(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setFeedback({ kind: 'error', text: 'فایل انتخاب‌شده JSON معتبر نیست' });
      return;
    }
    const obj = parsed as Record<string, unknown> | null;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !Array.isArray(obj.accounts) || !Array.isArray(obj.alerts)) {
      setFeedback({ kind: 'error', text: 'این فایل یک بک‌اپ معتبر نیست (accounts/alerts پیدا نشد)' });
      return;
    }
    setPendingFile({ name: file.name, data: parsed });
    setConfirm('file');
  };

  const doRestoreFromFile = async () => {
    if (!pendingFile) return;
    setConfirm(null);
    setBusy('restore-file');
    setFeedback(null);
    try {
      await restoreLocalBackup(pendingFile.data);
      finishRestore();
    } catch (err) {
      setFeedback({ kind: 'error', text: (err as Error).message });
      setBusy(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md modal-backdrop-anim"
      onClick={onClose}
    >
      <div
        className="w-[94vw] max-w-2xl rounded-3xl border border-neutral-800 bg-neutral-900 shadow-2xl overflow-hidden max-h-[88vh] max-h-[88dvh] modal-content-anim flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pinned Modal Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 bg-neutral-900 border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-sky-500/20 text-sky-400 ring-1 ring-sky-500/30 shrink-0">
              <Send className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black text-white">پشتیبان‌گیری و بازیابی دیتابیس</h2>
              <p className="text-[11px] text-neutral-400">ارسال بک‌اپ به تلگرام/بله یا دانلود/بازیابی فایل JSON</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-neutral-800 p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 transition shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1 custom-scrollbar">
          {/* Restored success card */}
          {restored && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center gap-2.5 text-xs text-emerald-300">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span className="font-bold">بازیابی انجام شد — در حال بارگذاری مجدد…</span>
            </div>
          )}

          {/* Feedback */}
          {feedback && !restored && (
            <div
              className={`rounded-2xl border p-3 text-xs flex items-start gap-2 ${
                feedback.kind === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              }`}
            >
              {feedback.kind === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}

          {/* 1) Telegram Connection */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-3.5 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-300">
              <Send className="h-3.5 w-3.5 text-sky-400" />
              تلگرام (Telegram)
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-neutral-600">
                API: api.telegram.org — توکن از @BotFather بگیرید
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-[10px] text-neutral-500">توکن ربات (Bot Token)</label>
                <input
                  type="password"
                  autoComplete="off"
                  dir="ltr"
                  className={inputClass}
                  placeholder="123456:ABC-DEF..."
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  disabled={busy !== null}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-neutral-500">شناسه چت (Chat ID)</label>
                <input
                  type="text"
                  autoComplete="off"
                  dir="ltr"
                  className={inputClass}
                  placeholder="-1001234567890"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  disabled={busy !== null}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => doTest('telegram')}
                disabled={busy !== null || !telegramBotToken.trim()}
                className={secondaryBtn}
              >
                <Zap className="h-3.5 w-3.5" />
                {busy === 'test' ? 'در حال تست…' : 'تست اتصال تلگرام'}
              </button>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-neutral-300 cursor-pointer">
              <input
                type="checkbox"
                checked={telegramEnabled}
                onChange={(e) => setTelegramEnabled(e.target.checked)}
                disabled={busy !== null}
                className="rounded border-neutral-700"
              />
              فعال‌سازی ربات تلگرام
            </label>
            <p className="text-[10px] text-neutral-600">
              توکن از @BotFather و شناسه چت را از ربات‌هایی مثل @userinfobot بگیرید.
            </p>
          </div>

          {/* 2) Bale Connection */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-3.5 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-300">
              <Send className="h-3.5 w-3.5 text-sky-400" />
              بله (Bale)
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-neutral-600">
                API: tapi.bale.ai — توکن از @BotFather_bale بگیرید
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-[10px] text-neutral-500">توکن ربات (Bot Token)</label>
                <input
                  type="password"
                  autoComplete="off"
                  dir="ltr"
                  className={inputClass}
                  placeholder="123456:ABC-DEF..."
                  value={baleBotToken}
                  onChange={(e) => setBaleBotToken(e.target.value)}
                  disabled={busy !== null}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-neutral-500">شناسه چت (Chat ID)</label>
                <input
                  type="text"
                  autoComplete="off"
                  dir="ltr"
                  className={inputClass}
                  placeholder="-1001234567890"
                  value={baleChatId}
                  onChange={(e) => setBaleChatId(e.target.value)}
                  disabled={busy !== null}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => doTest('bale')}
                disabled={busy !== null || !baleBotToken.trim()}
                className={secondaryBtn}
              >
                <Zap className="h-3.5 w-3.5" />
                {busy === 'test' ? 'در حال تست…' : 'تست اتصال بله'}
              </button>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-neutral-300 cursor-pointer">
              <input
                type="checkbox"
                checked={baleEnabled}
                onChange={(e) => setBaleEnabled(e.target.checked)}
                disabled={busy !== null}
                className="rounded border-neutral-700"
              />
              فعال‌سازی ربات بله
            </label>
            <p className="text-[10px] text-neutral-600">
              توکن از @BotFather_bale و شناسه چت را با دستور /getid یا ابزار مشابه بگیرید.
            </p>
          </div>

          {/* Save Settings */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={doSave}
              disabled={
                busy !== null ||
                (!telegramBotToken.trim() && !baleBotToken.trim()) ||
                (telegramBotToken.trim() !== '' && !telegramChatId.trim()) ||
                (baleBotToken.trim() !== '' && !baleChatId.trim())
              }
              className={primaryBtn}
            >
              <Save className="h-3.5 w-3.5" />
              {busy === 'save' ? 'در حال ذخیره…' : 'ذخیره تنظیمات'}
            </button>
          </div>

          {/* Bot settings */}
          <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-sky-300">
                <Send className="h-3.5 w-3.5" />
                تنظیمات ربات
              </div>
              {botStatus && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    botStatus.enabled
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  {botStatus.enabled ? 'فعال' : 'غیرفعال'}
                </span>
              )}
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[11px] text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={botEnabled}
                  onChange={(e) => setBotEnabled(e.target.checked)}
                  disabled={busy !== null}
                  className="rounded border-neutral-700"
                />
                فعال‌سازی ربات (polling)
              </label>

              <label className="flex items-center gap-2 text-[11px] text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(e) => setNotificationsEnabled(e.target.checked)}
                  disabled={busy !== null}
                  className="rounded border-neutral-700"
                />
                اعلان‌های خودکار
              </label>

              <label className="flex items-center gap-2 text-[11px] text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={monitorEnabled}
                  onChange={(e) => setMonitorEnabled(e.target.checked)}
                  disabled={busy !== null}
                  className="rounded border-neutral-700"
                />
                مانیتور خودکار سرویس‌ها و اعتبار
              </label>

              {monitorEnabled && (
                <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                  <span>بازه مانیتور (دقیقه):</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={monitorInterval}
                    onChange={(e) => setMonitorInterval(Number(e.target.value))}
                    disabled={busy !== null}
                    className="w-16 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-white focus:border-sky-500/50 focus:outline-none"
                  />
                </div>
              )}

              <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                <span>آستانهٔ هشدار اعتبار (٪):</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={Math.round(creditThreshold * 100)}
                  onChange={(e) => setCreditThreshold(Number(e.target.value) / 100)}
                  disabled={busy !== null}
                  className="w-16 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-white focus:border-sky-500/50 focus:outline-none"
                />
              </div>

            </div>
          </div>

          {/* 2) Backup */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-3.5 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-300">
              <DatabaseBackup className="h-3.5 w-3.5 text-sky-400" />
              پشتیبان‌گیری
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={doBackup}
                disabled={busy !== null || !hasSavedConfig}
                className={primaryBtn}
                title={hasSavedConfig ? 'ارسال فایل دیتابیس به چت تلگرام' : 'ابتدا تنظیمات را ذخیره کنید'}
              >
                <Send className="h-3.5 w-3.5" />
                {busy === 'backup' ? 'در حال ارسال…' : 'ارسال پشتیبان به تلگرام'}
              </button>
              <button
                onClick={() => downloadLocalBackup()}
                disabled={busy !== null}
                className={secondaryBtn}
                title="دانلود فایل JSON دیتابیس"
              >
                <Download className="h-3.5 w-3.5" />
                دانلود فایل JSON
              </button>
            </div>
            {config?.lastBackupAt ? (
              <p className="text-[11px] text-neutral-500">
                آخرین بک‌اپ تلگرام:{' '}
                <span className="text-neutral-300">{new Date(config.lastBackupAt).toLocaleString('fa-IR')}</span>
                {config.lastBackupFileName ? ` — ${config.lastBackupFileName}` : ''}
              </p>
            ) : (
              <p className="text-[11px] text-neutral-600">هنوز بک‌اپی در تلگرام ثبت نشده است.</p>
            )}
          </div>

          {/* 3) Restore */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-3.5 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-300">
              <ArchiveRestore className="h-3.5 w-3.5 text-rose-400" />
              بازیابی
            </div>
            <p className="text-[10px] text-neutral-600">
              بازیابی، دیتابیس فعلی را با محتوای بک‌اپ جایگزین می‌کند. قبل از آن یک نسخه خودکار
              (pre-restore) از وضعیت فعلی کنار فایل دیتابیس ذخیره می‌شود.
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setConfirm('tg')}
                disabled={busy !== null || !hasSavedConfig}
                className={secondaryBtn}
                title={hasSavedConfig ? 'بازیابی از آخرین فایل بک‌اپ ارسال‌شده به تلگرام' : 'ابتدا تنظیمات را ذخیره کنید'}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {busy === 'restore-tg' ? 'در حال بازیابی…' : 'بازیابی از آخرین پشتیبان تلگرام'}
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={busy !== null}
                className={secondaryBtn}
              >
                <Upload className="h-3.5 w-3.5" />
                انتخاب فایل JSON
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={onFilePicked}
              />
            </div>

            {confirm === 'tg' && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs">
                <span className="text-rose-200">
                  آیا مطمئن هستید؟ دیتابیس فعلی با آخرین پشتیبان تلگرام جایگزین می‌شود.
                </span>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={doRestoreFromTelegram}
                    className="rounded-lg bg-rose-500 px-3 py-1.5 font-bold text-white hover:bg-rose-600 transition"
                  >
                    بله، بازیابی کن
                  </button>
                  <button
                    onClick={() => setConfirm(null)}
                    className="rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800 transition"
                  >
                    انصراف
                  </button>
                </div>
              </div>
            )}

            {confirm === 'file' && pendingFile && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs">
                <span className="text-rose-200 break-all">
                  آیا مطمئن هستید؟ «{pendingFile.name}» جایگزین دیتابیس فعلی می‌شود.
                </span>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={doRestoreFromFile}
                    className="rounded-lg bg-rose-500 px-3 py-1.5 font-bold text-white hover:bg-rose-600 transition"
                  >
                    بله، بازیابی کن
                  </button>
                  <button
                    onClick={() => {
                      setConfirm(null);
                      setPendingFile(null);
                    }}
                    className="rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800 transition"
                  >
                    انصراف
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
