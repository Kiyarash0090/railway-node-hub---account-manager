import React, { useState } from 'react';
import {
  Wallet,
  Plus,
  Trash2,
  Key,
  Shield,
  ShieldAlert,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Play,
  Pause,
  RefreshCw,
  Sliders,
  Tag,
  X,
  Search,
} from 'lucide-react';
import { useHub } from '../context/HubContext';
import { creditExpiryLabel, creditResetLabel, RAILWAY_REGIONS, regionLabel } from '../types';
import { setRailwayRegion } from '../services/railwayApi';
import { extractApiError } from '../utils/githubRepo';

interface AccountsManagerProps {
  onOpenDeploy: () => void;
  onOpenBudgetGuard: () => void;
}

export const AccountsManager: React.FC<AccountsManagerProps> = ({
  onOpenDeploy,
  onOpenBudgetGuard,
}) => {
  const {
    accounts,
    activeAccountId,
    setActiveAccountId,
    addAccount,
    deleteAccount,
    refreshAccountBalances,
    triggerBudgetShutdown,
    resumeAccountServices,
    updateBudgetGuardRule,
    updateAccount,
    addLog,
    sendCustomAlert,
  } = useHub();

  const [isAdding, setIsAdding] = useState(false);
  const [apiToken, setApiToken] = useState('');
  const [autoShutdownThreshold, setAutoShutdownThreshold] = useState(0.5);
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationSuccess, setValidationSuccess] = useState<string | null>(null);

  // Edit threshold state
  const [editingThresholdAccId, setEditingThresholdAccId] = useState<string | null>(null);
  const [tempThreshold, setTempThreshold] = useState<number>(0.5);

  React.useEffect(() => {
    if (accounts.length === 0) {
      setIsAdding(true);
    }
  }, [accounts.length]);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiToken.trim()) {
      setValidationError('لطفاً توکن API اکانت Railway را وارد نمایید.');
      return;
    }

    setIsValidating(true);
    setValidationError(null);
    setValidationSuccess(null);

    const result = await addAccount({
      token: apiToken.trim(),
      autoShutdownThreshold: Number(autoShutdownThreshold),
    });

    setIsValidating(false);

    if (result.success) {
      setValidationSuccess('اکانت با موفقیت متصل و تمام اطلاعات از API استخراج گردید!');
      setTimeout(() => {
        setIsAdding(false);
        setApiToken('');
        setValidationSuccess(null);
      }, 1200);
    } else {
      setValidationError(result.error || 'خطا در اعتبارسنجی توکن Railway');
    }
  };

  const handleSaveThreshold = (accountId: string) => {
    updateBudgetGuardRule(accountId, true, tempThreshold);
    setEditingThresholdAccId(null);
  };

  // Account-level default region (workspace.preferredRegion) — affects NEW
  // services/volumes under this account, not existing ones.
  const [regionSavingId, setRegionSavingId] = useState<string | null>(null);
  const [regionErrorId, setRegionErrorId] = useState<string | null>(null);

  // Account tags — free-form labels, filterable via tag search.
  const [tagSearch, setTagSearch] = useState('');
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');

  const filteredAccounts = accounts.filter((acc) => {
    const q = tagSearch.trim().toLowerCase();
    if (!q) return true;
    return (acc.tags || []).some((t) => t.toLowerCase().includes(q));
  });

  const handleAddTag = (accId: string) => {
    const t = tagDraft.trim();
    if (!t) return;
    const acc = accounts.find((a) => a.id === accId);
    if (!acc) return;
    const tags = acc.tags || [];
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setTagDraft('');
      return;
    }
    updateAccount(accId, { tags: [...tags, t] });
    setTagDraft('');
  };

  const handleRemoveTag = (accId: string, tag: string) => {
    const acc = accounts.find((a) => a.id === accId);
    if (!acc) return;
    updateAccount(accId, { tags: (acc.tags || []).filter((t) => t !== tag) });
  };

  const handleRegionChange = async (acc: (typeof accounts)[number], code: string) => {
    if (!code || code === acc.preferredRegion) return;
    setRegionSavingId(acc.id);
    setRegionErrorId(null);
    try {
      const res = await setRailwayRegion({
        token: acc.token,
        region: code,
        workspaceId: acc.workspaceId || undefined,
      });
      const err = extractApiError(res, '');
      if (err) throw new Error(err);
      if (res?.ok === false) throw new Error('ریلوی تغییر ریجن اکانت را نپذیرفت');

      updateAccount(acc.id, { preferredRegion: code });
      addLog({
        level: 'warn',
        serviceName: acc.name,
        message: `[ACCOUNT_REGION] Default region changed to ${code} (${regionLabel(code)}) — applies to new deployments.`,
      });
      sendCustomAlert(
        'ریجن اکانت تغییر کرد',
        `ریجن پیش‌فرض اکانت ${acc.name} به ${regionLabel(code)} تغییر کرد. سرویس‌های جدید در این ریجن ساخته می‌شوند؛ سرویس‌های موجود جابه‌جا نمی‌شوند.`,
        'info'
      );
    } catch (e: any) {
      setRegionErrorId(acc.id);
      sendCustomAlert('خطا در تغییر ریجن', e.message || 'تغییر ریجن اکانت ناموفق بود', 'warning');
    } finally {
      setRegionSavingId(null);
    }
  };

  return (
    <div className="space-y-5 pb-20 lg:pb-8 w-full max-w-full overflow-hidden">
      
      {/* Top Banner & Action */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-base sm:text-xl font-black text-white flex items-center gap-2">
            <Wallet className="h-5 w-5 sm:h-6 sm:w-6 text-purple-400 shrink-0" />
            <span>مدیریت اکانت‌های متصل Railway</span>
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            توکن‌های API اکانت‌های ریلوی خود را اضافه کنید تا اعتبارها و مانیتورینگ یکپارچه پایش شوند.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => refreshAccountBalances()}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-300 hover:text-white hover:border-neutral-700 transition"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            بروزرسانی
          </button>
          <button
            onClick={() => setIsAdding(!isAdding)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1 rounded-xl bg-purple-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-purple-500 transition shadow-md shadow-purple-600/20"
          >
            <Plus className="h-4 w-4" />
            افزودن اکانت
          </button>
        </div>
      </div>

      {/* Add Account Modal / Card */}
      {isAdding && (
        <div className="rounded-2xl border border-purple-500/30 bg-neutral-900/90 p-4 sm:p-5 backdrop-blur-xl shadow-2xl animate-in fade-in zoom-in-95 max-w-full overflow-hidden">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-purple-400 shrink-0" />
              <h3 className="text-xs sm:text-sm font-bold text-white">اتصال اکانت جدید Railway</h3>
            </div>
            <a
              href="https://railway.app/account/tokens"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[10px] sm:text-[11px] text-purple-400 hover:text-purple-300"
            >
              <span>توکن ریلوی</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <form onSubmit={handleCreateAccount} className="space-y-3.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-neutral-300">
                  توکن دسترسی API (Personal API Token) <span className="text-rose-400">*</span>
                </label>
                <span className="text-[10px] text-purple-400 font-semibold">
                  ✨ استخراج خودکار سقف و میزان اعتبار
                </span>
              </div>
              <input
                type="password"
                placeholder="rw_live_..."
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 font-mono text-xs text-white placeholder-neutral-500 focus:border-purple-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1">
                آستانه خاموشی خودکار / Budget Guard ($)
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                value={autoShutdownThreshold}
                onChange={(e) => setAutoShutdownThreshold(Number(e.target.value))}
                className="w-full sm:w-1/2 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white focus:border-purple-500 focus:outline-none font-mono"
              />
            </div>

            <div className="rounded-xl border border-purple-500/20 bg-purple-500/10 p-3 text-xs text-purple-200 flex items-start gap-2.5">
              <Shield className="h-4 w-4 text-purple-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-white block mb-0.5">استخراج خودکار تمام اطلاعات از API ریلوی</span>
                اطلاعات ایمیل، نام اکانت، پلن حساب، سقف اعتبار ماهانه ($)، میزان مصرف شده و اعتبار باقی‌مانده بدون نیاز به ورود دستی، به صورت مستقیم از API توکن ریلوی دریافت و تنظیم می‌شوند.
              </div>
            </div>

            {validationError && (
              <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 border border-rose-500/30 p-2.5 text-xs text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}

            {validationSuccess && (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-2.5 text-xs text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{validationSuccess}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="rounded-xl border border-neutral-800 px-3.5 py-2 text-xs font-medium text-neutral-400 hover:text-white"
              >
                انصراف
              </button>
              <button
                type="submit"
                disabled={isValidating}
                className="flex items-center gap-1.5 rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 transition disabled:opacity-50"
              >
                {isValidating ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    اعتبارسنجی...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    ذخیره اکانت
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Connected Accounts Cards List */}
      <div className="space-y-3.5">
        {/* Tag search — filter accounts by any of their tags */}
        {accounts.some((a) => (a.tags || []).length > 0) && (
          <div className="flex items-center gap-2 rounded-2xl bg-neutral-900/60 border border-neutral-800 p-2.5">
            <Search className="h-4 w-4 text-neutral-500 shrink-0" />
            <input
              type="text"
              value={tagSearch}
              onChange={(e) => setTagSearch(e.target.value)}
              placeholder="جستجوی تگ..."
              className="flex-1 bg-transparent text-xs text-white placeholder-neutral-500 focus:outline-none"
            />
            {tagSearch && (
              <button
                onClick={() => setTagSearch('')}
                className="rounded-lg p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
                title="پاک کردن جستجو"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {accounts.length === 0 && !isAdding && (
          <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center flex flex-col items-center justify-center">
            <div className="h-12 w-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center mb-3">
              <Wallet className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-bold text-white mb-1">هیچ اکانتی متصل نشده است</h3>
            <p className="text-xs text-neutral-400 max-w-md mb-4 leading-relaxed">
              برای آغاز مانیتورینگ نودها و استخراج خودکار سقف اعتبار و میزان مصرف، توکن API اکانت ریلوی خود را اضافه کنید.
            </p>
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 transition shadow-lg shadow-purple-600/20"
            >
              <Plus className="h-4 w-4" />
              افزودن اولین اکانت Railway
            </button>
          </div>
        )}

        {tagSearch.trim() && filteredAccounts.length === 0 && (
          <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/30 p-6 text-center text-xs text-neutral-400">
            هیچ اکانتی با تگ «{tagSearch.trim()}» یافت نشد.
          </div>
        )}

        {filteredAccounts.map((acc) => {
          const isSelected = activeAccountId === acc.id;
          const isLowCredit = acc.creditRemaining < acc.autoShutdownThreshold;
          const percentageRemaining = Math.max(0, Math.min(100, (acc.creditRemaining / acc.creditLimit) * 100));
          const isEditingTags = editingTagsId === acc.id;

          return (
            <div
              key={acc.id}
              className={`rounded-2xl border p-3.5 sm:p-5 transition-all duration-200 backdrop-blur-md max-w-full overflow-hidden ${
                isSelected
                  ? 'bg-neutral-900/90 border-purple-500/50 ring-1 ring-purple-500/30'
                  : 'bg-neutral-900/50 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                
                {/* Account details */}
                <div className="flex items-start gap-3 min-w-0 max-w-full">
                  <div
                    className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-2xl text-white font-bold text-base sm:text-lg shadow-md"
                    style={{ backgroundColor: acc.color }}
                  >
                    {acc.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 max-w-full">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="font-extrabold text-white text-sm sm:text-base truncate">{acc.name}</h3>
                      <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-medium text-neutral-300 shrink-0">
                        {acc.plan}
                      </span>
                      {acc.isShutdownTriggered ? (
                        <span className="rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 text-[9px] font-bold flex items-center gap-1 shrink-0">
                          <ShieldAlert className="h-3 w-3" />
                          متوقف شده
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[9px] font-medium flex items-center gap-1 shrink-0">
                          <CheckCircle2 className="h-3 w-3" />
                          فعال
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-neutral-400 mt-1 flex-wrap">
                      <span className="font-mono text-neutral-300 truncate max-w-[150px] sm:max-w-none">{acc.email}</span>
                      <span>•</span>
                      <span>{acc.projects.filter((p) => !p.isDeletedOnRailway && p.isExternal).reduce((s, p) => s + p.services.length, 0)} سرویس</span>
                      <span>•</span>
                      <span className="font-mono text-[10px]">توکن: {acc.token.substring(0, 8)}••••</span>
                    </div>

                    {/* Tags: chips + inline editor */}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap min-w-0">
                      <Tag className="h-3 w-3 text-neutral-500 shrink-0" />
                      {(acc.tags || []).map((t) => (
                        <span
                          key={t}
                          className="group inline-flex items-center gap-1 rounded-full bg-purple-500/10 border border-purple-500/30 px-2 py-0.5 text-[10px] text-purple-300"
                        >
                          <button
                            onClick={() => setTagSearch(t)}
                            className="hover:text-purple-100 transition"
                            title={`جستجوی تگ ${t}`}
                          >
                            {t}
                          </button>
                          <button
                            onClick={() => handleRemoveTag(acc.id, t)}
                            className="opacity-50 group-hover:opacity-100 hover:text-rose-300 transition"
                            title="حذف تگ"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}

                      {isEditingTags ? (
                        <span className="inline-flex items-center gap-1">
                          <input
                            autoFocus
                            value={tagDraft}
                            onChange={(e) => setTagDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddTag(acc.id);
                              }
                              if (e.key === 'Escape') {
                                setEditingTagsId(null);
                                setTagDraft('');
                              }
                            }}
                            placeholder="تگ جدید + Enter"
                            className="w-28 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[10px] text-white placeholder-neutral-500 focus:border-purple-500 focus:outline-none"
                          />
                          <button
                            onClick={() => handleAddTag(acc.id)}
                            className="rounded-lg bg-purple-600 p-1 text-white hover:bg-purple-500 transition"
                            title="افزودن تگ"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingTagsId(null);
                              setTagDraft('');
                            }}
                            className="rounded-lg border border-neutral-800 p-1 text-neutral-400 hover:text-white transition"
                            title="پایان ویرایش"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingTagsId(acc.id);
                            setTagDraft('');
                          }}
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-400 hover:text-purple-300 hover:border-purple-500/50 transition"
                          title="ویرایش تگ‌ها"
                        >
                          <Plus className="h-2.5 w-2.5" />
                          تگ
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Account balance pill & controls */}
                <div className="flex items-center gap-2.5 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 border-neutral-800 pt-2.5 md:pt-0 shrink-0">
                  <div className="text-right">
                    <div className="text-[10px] text-neutral-400">اعتبار باقی‌مانده:</div>
                    <div
                      className={`text-base sm:text-xl font-black font-mono ${
                        isLowCredit ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      ${acc.creditRemaining.toFixed(2)}
                      <span className="text-[10px] text-neutral-500 font-normal mr-0.5">/ ${acc.creditLimit}</span>
                    </div>
                    {creditExpiryLabel(acc.creditExpiresInDays) && (
                      <div
                        className={`text-[10px] font-medium mt-0.5 ${
                          (acc.creditExpiresInDays ?? 99) <= 3 ? 'text-rose-400' : 'text-amber-400'
                        }`}
                        title={acc.billingPeriodEnd ? `پایان دوره اعتبار: ${acc.billingPeriodEnd}` : undefined}
                      >
                        {creditExpiryLabel(acc.creditExpiresInDays)}
                      </div>
                    )}
                    {creditResetLabel(acc.billingPeriodEnd) && (
                      <div
                        className="text-[10px] text-sky-400/90 mt-0.5"
                        title={
                          acc.billingPeriodEnd
                            ? `دوره صورتحساب ریلوی: ${acc.billingPeriodEnd} — در این تاریخ چرخه جدید اعتبار شروع می‌شود`
                            : undefined
                        }
                      >
                        ریست اعتبار: {creditResetLabel(acc.billingPeriodEnd)}
                      </div>
                    )}

                    {/* Account-level default region for NEW deployments */}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="text-[10px] text-neutral-500 shrink-0">ریجن اکانت:</span>
                      <select
                        value={acc.preferredRegion || ''}
                        onChange={(e) => handleRegionChange(acc, e.target.value)}
                        disabled={regionSavingId === acc.id || !acc.preferredRegion}
                        title="ریجن پیش‌فرض سطح اکانت — سرویس‌های جدید اینجا ساخته می‌شوند"
                        className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[10px] text-sky-300 focus:border-sky-500 focus:outline-none cursor-pointer disabled:opacity-50"
                      >
                        {!acc.preferredRegion && <option value="">— در حال دریافت —</option>}
                        {RAILWAY_REGIONS.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      {regionSavingId === acc.id && (
                        <RefreshCw className="h-3 w-3 animate-spin text-sky-400 shrink-0" />
                      )}
                    </div>
                    {regionErrorId === acc.id && (
                      <div className="text-[10px] text-rose-400 mt-0.5">تغییر ریجن ناموفق بود — دوباره تلاش کنید.</div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setActiveAccountId(acc.id)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                        isSelected
                          ? 'bg-purple-600 text-white'
                          : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      {isSelected ? 'فعال' : 'انتخاب'}
                    </button>

                    <button
                      onClick={() => deleteAccount(acc.id)}
                      className="rounded-xl border border-neutral-800 p-1.5 text-neutral-400 hover:text-rose-400 hover:border-rose-500/30 hover:bg-rose-500/10 transition"
                      title="حذف اکانت"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

              </div>

              {/* Progress and Budget Guard Controls */}
              <div className="mt-3 pt-3 border-t border-neutral-800/80 grid grid-cols-1 md:grid-cols-2 gap-3">
                
                {/* Progress bar */}
                <div>
                  <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1">
                    <span>میزان مصرف این ماه</span>
                    <span className="font-mono text-white">${acc.creditUsed.toFixed(2)} ({((acc.creditUsed / acc.creditLimit) * 100).toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-neutral-950 overflow-hidden border border-neutral-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        acc.isShutdownTriggered
                          ? 'bg-rose-500'
                          : isLowCredit
                          ? 'bg-amber-500'
                          : 'bg-gradient-to-r from-emerald-500 to-teal-400'
                      }`}
                      style={{ width: `${percentageRemaining}%` }}
                    />
                  </div>
                </div>

                {/* Budget Guard trigger settings */}
                <div className="flex items-center justify-between bg-neutral-950/60 rounded-xl p-2 border border-neutral-800/60 text-xs gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Shield className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                    <div className="truncate">
                      <span className="text-neutral-300 font-medium text-[11px]">آستانه:</span>
                      <span className="font-mono text-white mr-1 font-bold">${acc.autoShutdownThreshold}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {editingThresholdAccId === acc.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          max="5"
                          value={tempThreshold}
                          onChange={(e) => setTempThreshold(Number(e.target.value))}
                          className="w-14 rounded-lg bg-neutral-900 border border-neutral-700 px-1.5 py-0.5 text-xs text-white font-mono"
                        />
                        <button
                          onClick={() => handleSaveThreshold(acc.id)}
                          className="rounded-lg bg-emerald-600 px-2 py-0.5 text-[10px] text-white"
                        >
                          ذخیره
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingThresholdAccId(acc.id);
                          setTempThreshold(acc.autoShutdownThreshold);
                        }}
                        className="text-purple-400 hover:text-purple-300 flex items-center gap-0.5 text-[10px]"
                      >
                        <Sliders className="h-3 w-3" />
                        ویرایش
                      </button>
                    )}

                    {acc.isShutdownTriggered ? (
                      <button
                        onClick={() => resumeAccountServices(acc.id)}
                        className="flex items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-rose-500"
                      >
                        <Play className="h-3 w-3" />
                        روشن
                      </button>
                    ) : (
                      <button
                        onClick={() => triggerBudgetShutdown(acc.id, 'آزمایش دستی محافظ بودجه')}
                        className="flex items-center gap-1 rounded-lg bg-neutral-800 px-2 py-1 text-[10px] text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10"
                        title="تست خاموشی خودکار"
                      >
                        <Pause className="h-3 w-3" />
                        تست
                      </button>
                    )}
                  </div>
                </div>

              </div>

            </div>
          );
        })}
      </div>

    </div>
  );
};
