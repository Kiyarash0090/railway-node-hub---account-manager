import React, { useState, useMemo } from 'react';
import {
  Wallet,
  Plus,
  Trash2,
  Key,
  Shield,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Tag,
  X,
  Search,
  Layers,
  Globe,
  Sparkles,
  ArrowUpDown,
} from 'lucide-react';
import { useHub } from '../context/HubContext';
import { regionLabel, RAILWAY_REGIONS } from '../types';
import { setRailwayRegion } from '../services/railwayApi';
import { extractApiError } from '../utils/githubRepo';

interface AccountsManagerProps {
  onOpenDeploy: () => void;
}

type StatusFilter = 'all' | 'low-credit' | 'with-services';
type SortBy = 'highest-credit' | 'lowest-credit' | 'name' | 'services-count' | 'expiring-soon';

export const AccountsManager: React.FC<AccountsManagerProps> = ({
  onOpenDeploy,
}) => {
  const {
    accounts,
    activeAccountId,
    setActiveAccountId,
    addAccount,
    deleteAccount,
    refreshAccountBalances,
    updateAccount,
    addLog,
    sendCustomAlert,
    isSyncingProjects,
  } = useHub();

  const [isAdding, setIsAdding] = useState(false);
  const [apiToken, setApiToken] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationSuccess, setValidationSuccess] = useState<string | null>(null);

  // Filter States
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('highest-credit');

  // Region & Tag state
  const [regionSavingId, setRegionSavingId] = useState<string | null>(null);
  const [regionErrorId, setRegionErrorId] = useState<string | null>(null);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  // Filter & Sort Calculation
  const processedAccounts = useMemo(() => {
    return accounts
      .filter((acc) => {
        // Status filter
        if (statusFilter === 'low-credit' && acc.creditRemaining >= 0.5) return false;
        if (statusFilter === 'with-services') {
          const sCount = acc.projects.filter((p) => !p.isDeletedOnRailway && p.isExternal).reduce((s, p) => s + p.services.length, 0);
          if (sCount === 0) return false;
        }

        // Search query (name, email, plan, tags)
        const q = searchQuery.trim().toLowerCase();
        if (!q) return true;

        const nameMatch = acc.name.toLowerCase().includes(q);
        const emailMatch = acc.email.toLowerCase().includes(q);
        const planMatch = acc.plan.toLowerCase().includes(q);
        const tagMatch = (acc.tags || []).some((t) => t.toLowerCase().includes(q));
        const regionMatch = (acc.preferredRegion || '').toLowerCase().includes(q);

        return nameMatch || emailMatch || planMatch || tagMatch || regionMatch;
      })
      .sort((a, b) => {
        if (sortBy === 'highest-credit') return b.creditRemaining - a.creditRemaining;
        if (sortBy === 'lowest-credit') return a.creditRemaining - b.creditRemaining;
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        if (sortBy === 'services-count') {
          const aCount = a.projects.filter((p) => !p.isDeletedOnRailway && p.isExternal).reduce((s, p) => s + p.services.length, 0);
          const bCount = b.projects.filter((p) => !p.isDeletedOnRailway && p.isExternal).reduce((s, p) => s + p.services.length, 0);
          return bCount - aCount;
        }
        if (sortBy === 'expiring-soon') {
          const aDays = typeof a.creditExpiresInDays === 'number' ? a.creditExpiresInDays : 999;
          const bDays = typeof b.creditExpiresInDays === 'number' ? b.creditExpiresInDays : 999;
          return aDays - bDays;
        }
        return 0;
      });
  }, [accounts, statusFilter, searchQuery, sortBy]);

  // Aggregate Stats
  const totalBalance = useMemo(() => accounts.reduce((acc, a) => acc + a.creditRemaining, 0), [accounts]);
  const totalLimit = useMemo(() => accounts.reduce((acc, a) => acc + a.creditLimit, 0), [accounts]);
  const totalServices = useMemo(
    () => accounts.reduce((acc, a) => acc + a.projects.filter((p) => !p.isDeletedOnRailway && p.isExternal).reduce((s, p) => s + p.services.length, 0), 0),
    [accounts]
  );
  const activeAccountsCount = useMemo(() => accounts.length, [accounts]);

  return (
    <div className="space-y-4 pb-20 lg:pb-8 w-full max-w-full overflow-hidden">
      
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-base sm:text-xl font-black text-white flex items-center gap-2">
            <Wallet className="h-5 w-5 sm:h-6 sm:w-6 text-purple-400 shrink-0" />
            <span>مدیریت اکانت‌های متصل Railway</span>
            <span className="rounded-full bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-xs font-bold text-purple-300 font-mono">
              {accounts.length} اکانت
            </span>
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            پایش یکپارچه اعتبارها، تنظیم خودکار ریجن، مدیریت نودها و تفکیک پروژه‌ها
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => refreshAccountBalances()}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-300 hover:text-white hover:border-neutral-700 transition"
            title="به‌روزرسانی و همگام‌سازی مانده حساب‌ها"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncingProjects ? 'animate-spin text-purple-400' : ''}`} />
            <span>بروزرسانی</span>
          </button>
          <button
            onClick={() => setIsAdding(!isAdding)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 transition shadow-lg shadow-purple-600/25 active:scale-95"
          >
            <Plus className="h-4 w-4" />
            <span>افزودن اکانت</span>
          </button>
        </div>
      </div>

      {/* Aggregate Stats Summary Cards */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {/* 1. Total Balance */}
          <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-3.5 backdrop-blur-md">
            <div className="flex items-center justify-between text-neutral-400 text-xs mb-1">
              <span>مجموع اعتبار کل</span>
              <Sparkles className="h-4 w-4 text-purple-400" />
            </div>
            <div className="text-lg sm:text-2xl font-black font-mono text-emerald-400">
              ${totalBalance.toFixed(2)}
              <span className="text-xs font-normal text-neutral-500 mr-1">/ ${totalLimit.toFixed(0)}</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-950">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-emerald-400 transition-all duration-500"
                style={{ width: `${Math.min(100, (totalBalance / (totalLimit || 1)) * 100)}%` }}
              />
            </div>
          </div>

          {/* 2. Active Accounts */}
          <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-3.5 backdrop-blur-md">
            <div className="flex items-center justify-between text-neutral-400 text-xs mb-1">
              <span>وضعیت اکانت‌ها</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-lg sm:text-2xl font-black text-white font-mono">{activeAccountsCount}</span>
              <span className="text-xs text-emerald-400 font-medium">فعال و متصل</span>
            </div>
            <div className="text-[11px] text-neutral-400 mt-1.5 truncate">
              تمامی اکانت‌ها در وضعیت متصل و همگام با ریلوی هستند
            </div>
          </div>

          {/* 3. Total Services */}
          <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-3.5 backdrop-blur-md">
            <div className="flex items-center justify-between text-neutral-400 text-xs mb-1">
              <span>کل سرویس‌ها و نودها</span>
              <Layers className="h-4 w-4 text-sky-400" />
            </div>
            <div className="text-lg sm:text-2xl font-black text-white font-mono mt-0.5">
              {totalServices}
              <span className="text-xs font-normal text-neutral-400 mr-1">سرویس فعال</span>
            </div>
            <div className="text-[11px] text-neutral-400 mt-1.5 truncate">
              میانگین {(totalServices / (accounts.length || 1)).toFixed(1)} سرویس در هر اکانت
            </div>
          </div>

          {/* 4. Active Scope Selector */}
          <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-3.5 backdrop-blur-md flex flex-col justify-between">
            <div className="flex items-center justify-between text-neutral-400 text-xs">
              <span>اکانت متمرکز فعال</span>
              <Globe className="h-4 w-4 text-amber-400" />
            </div>
            <div className="truncate font-bold text-xs sm:text-sm text-purple-300 mt-1">
              {activeAccountId === 'all' ? 'همه اکانت‌ها (نمای جامع)' : accounts.find((a) => a.id === activeAccountId)?.name || 'اکانت انتخابی'}
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              <button
                onClick={() => setActiveAccountId('all')}
                className={`flex-1 rounded-lg py-1 text-[10px] font-semibold transition ${
                  activeAccountId === 'all'
                    ? 'bg-purple-600 text-white'
                    : 'bg-neutral-950 text-neutral-400 hover:text-white'
                }`}
              >
                نمایش همه
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Account Modal / Form Card */}
      {isAdding && (
        <div className="rounded-2xl border border-purple-500/30 bg-neutral-900/95 p-4 sm:p-5 backdrop-blur-xl shadow-2xl animate-in fade-in zoom-in-95 max-w-full overflow-hidden">
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
              <span>دریافت توکن ریلوی</span>
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

      {/* Filter, Search & View Controls Bar */}
      {accounts.length > 0 && (
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 rounded-2xl bg-neutral-900/80 border border-neutral-800 p-2.5">
          
          {/* Search Bar & Status Filter Pills */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جستجو در اکانت‌ها، ایمیل، تگ..."
                className="w-full rounded-xl border border-neutral-800 bg-neutral-950 py-1.5 pr-8 pl-3 text-xs text-white placeholder-neutral-500 focus:border-purple-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Quick Status Filter Pills */}
            <div className="hidden sm:flex items-center gap-1 overflow-x-auto">
              {[
                { id: 'all', label: 'همه' },
                { id: 'low-credit', label: 'کم‌اعتبار (<$0.5)' },
                { id: 'with-services', label: 'دارای سرویس' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setStatusFilter(f.id as StatusFilter)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                    statusFilter === f.id
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sort Selector */}
          <div className="flex items-center justify-between md:justify-end gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="h-3.5 w-3.5 text-neutral-500 shrink-0" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[11px] text-neutral-300 focus:border-purple-500 focus:outline-none cursor-pointer"
              >
                <option value="highest-credit">بیشترین اعتبار</option>
                <option value="lowest-credit">کمترین اعتبار</option>
                <option value="name">نام (الفبا)</option>
                <option value="services-count">بیشترین سرویس</option>
                <option value="expiring-soon">نزدیک به انقضا</option>
              </select>
            </div>
          </div>

        </div>
      )}

      {/* Empty State */}
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

      {/* No Search Results State */}
      {searchQuery && processedAccounts.length === 0 && (
        <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center text-xs text-neutral-400">
          هیچ اکانتی منطبق با عبارت «{searchQuery}» پیدا نشد.
        </div>
      )}

      {/* DETAILED VIEW (تنها نمای اکانت‌ها با تمام جزئیات) */}
      {processedAccounts.length > 0 && (
        <div className="space-y-3.5">
          {processedAccounts.map((acc) => {
            const isSelected = activeAccountId === acc.id;
            const isLowCredit = acc.creditRemaining < 0.5;
            const percentageRemaining = Math.max(0, Math.min(100, (acc.creditRemaining / (acc.creditLimit || 1)) * 100));
            const isEditingTags = editingTagsId === acc.id;

            return (
              <div
                key={acc.id}
                className={`rounded-2xl border p-4 sm:p-5 transition-all duration-200 backdrop-blur-md max-w-full overflow-hidden ${
                  isSelected
                    ? 'bg-neutral-900/95 border-purple-500/50 ring-1 ring-purple-500/30'
                    : 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-700'
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
                        <span className="rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[9px] font-medium flex items-center gap-1 shrink-0">
                          <CheckCircle2 className="h-3 w-3" />
                          فعال
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-neutral-400 mt-1 flex-wrap">
                        <span className="font-mono text-neutral-300 truncate max-w-[150px] sm:max-w-none">{acc.email}</span>
                        <span>•</span>
                        <span>{acc.projects.filter((p) => !p.isDeletedOnRailway && p.isExternal).reduce((s, p) => s + p.services.length, 0)} سرویس</span>
                        <span>•</span>
                        <span className="font-mono text-[10px]">توکن: {acc.token.substring(0, 8)}••••</span>
                      </div>

                      {/* Tags */}
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap min-w-0">
                        <Tag className="h-3 w-3 text-neutral-500 shrink-0" />
                        {(acc.tags || []).map((t) => (
                          <span
                            key={t}
                            className="group inline-flex items-center gap-1 rounded-full bg-purple-500/10 border border-purple-500/30 px-2 py-0.5 text-[10px] text-purple-300"
                          >
                            <button
                              onClick={() => setSearchQuery(t)}
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

                  {/* Balance */}
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
                      <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
                        مصرف شده: ${acc.creditUsed.toFixed(2)}
                      </div>
                    </div>

                    <button
                      onClick={() => setActiveAccountId(acc.id)}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition shrink-0 ${
                        isSelected
                          ? 'bg-purple-600 text-white shadow-md'
                          : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white'
                      }`}
                    >
                      {isSelected ? 'اکانت فعال' : 'انتخاب'}
                    </button>
                  </div>
                </div>

                {/* Meter Progress Bar */}
                <div className="mt-3.5 space-y-1">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-950 border border-neutral-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        percentageRemaining > 40
                          ? 'bg-emerald-500'
                          : percentageRemaining > 15
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                      }`}
                      style={{ width: `${percentageRemaining}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-neutral-500">
                    <span>{percentageRemaining.toFixed(0)}% باقی‌مانده</span>
                    <span>سقف اعتبار ماهانه: ${acc.creditLimit}</span>
                  </div>
                </div>

                {/* Expiry and Region Bar */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-800/80 pt-2.5 text-[11px] text-neutral-400">
                  <div className="flex items-center gap-3">
                    {typeof acc.creditExpiresInDays === 'number' && (
                      <span className={acc.creditExpiresInDays <= 3 ? 'text-rose-400 font-bold' : 'text-amber-400'}>
                        {acc.creditExpiresInDays} روز تا انقضا
                      </span>
                    )}
                    <div className="flex items-center gap-2 rounded-xl border border-neutral-800/90 bg-neutral-950/80 px-2.5 py-1 text-[11px] shadow-sm transition-all hover:border-purple-500/40 focus-within:border-purple-500/60 focus-within:ring-1 focus-within:ring-purple-500/20">
                      <Globe className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                      <span className="text-neutral-400 font-medium">ریجن:</span>
                      {regionSavingId === acc.id ? (
                        <div className="flex items-center gap-1 text-purple-300 text-[10px] font-mono">
                          <RefreshCw className="h-3 w-3 animate-spin text-purple-400" />
                          <span>در حال ذخیره...</span>
                        </div>
                      ) : (
                        <select
                          value={acc.preferredRegion || ''}
                          disabled={regionSavingId === acc.id}
                          onChange={(e) => handleRegionChange(acc, e.target.value)}
                          className="rounded-lg bg-transparent text-purple-200 hover:text-purple-100 font-sans font-semibold text-[11px] focus:outline-none cursor-pointer py-0 px-1 border-none disabled:opacity-50"
                        >
                          {!acc.preferredRegion && (
                            <option value="" className="bg-neutral-900 text-neutral-400">
                              — در حال دریافت —
                            </option>
                          )}
                          {acc.preferredRegion &&
                            !RAILWAY_REGIONS.some((r) => r.code === acc.preferredRegion) && (
                              <option value={acc.preferredRegion} className="bg-neutral-900 text-neutral-200">
                                {acc.preferredRegion}
                              </option>
                            )}
                          {RAILWAY_REGIONS.map((r) => (
                            <option key={r.code} value={r.code} className="bg-neutral-900 text-neutral-200 py-1">
                              {r.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (confirmDeleteId === acc.id) {
                          deleteAccount(acc.id);
                          setConfirmDeleteId(null);
                        } else {
                          setConfirmDeleteId(acc.id);
                          setTimeout(() => setConfirmDeleteId((prev) => (prev === acc.id ? null : prev)), 3000);
                        }
                      }}
                      className={`text-[11px] transition ${
                        confirmDeleteId === acc.id ? 'text-rose-400 font-bold' : 'text-neutral-500 hover:text-rose-400'
                      }`}
                    >
                      {confirmDeleteId === acc.id ? 'تأیید حذف' : 'حذف'}
                    </button>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};
