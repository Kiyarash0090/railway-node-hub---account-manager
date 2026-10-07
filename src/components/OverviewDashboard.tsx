import React, { useState, useRef, useMemo } from 'react';
import {
  Wallet,
  Activity,
  Flame,
  ShieldAlert,
  Server,
  Plus,
  ArrowUpRight,
  Terminal,
  Play,
  RotateCw,
  AlertOctagon,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Layers,
  Sparkles,
  Search,
  X,
  Globe,
  SlidersHorizontal,
  CheckCircle2,
} from 'lucide-react';
import { useHub } from '../context/HubContext';
import { ServiceIcon } from './ServiceIcon';
import { regionLabel } from '../types';

interface OverviewDashboardProps {
  onOpenAddAccount: () => void;
}

type AccountFilter = 'all' | 'with-services' | 'low-credit' | 'depleted';

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({
  onOpenAddAccount,
}) => {
  const {
    accounts,
    activeAccountId,
    setActiveAccountId,
    activeAccount,
    totalCreditsRemaining,
    totalCreditsLimit,
    totalCreditsUsed,
    allServices,
    healthyServicesCount,
    crashedServicesCount,
    stoppedServicesCount,
    logs,
    setActiveTab,
    restartService,
  } = useHub();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AccountFilter>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll carousel left/right
  const handleScroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -280 : 280;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  // Filtered accounts list
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const nodeCount = acc.projects.filter((p) => !p.isDeletedOnRailway && p.isExternal).reduce((s, p) => s + p.services.length, 0);
      if (statusFilter === 'with-services' && nodeCount === 0) return false;
      if (statusFilter === 'depleted' && acc.creditRemaining > 0) return false;
      if (statusFilter === 'low-credit' && (acc.creditRemaining >= 0.5 || acc.creditRemaining <= 0)) return false;

      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      const nameMatch = acc.name.toLowerCase().includes(q);
      const emailMatch = acc.email.toLowerCase().includes(q);
      const tagMatch = (acc.tags || []).some((t) => t.toLowerCase().includes(q));
      const regionMatch = (acc.preferredRegion || '').toLowerCase().includes(q);
      return nameMatch || emailMatch || tagMatch || regionMatch;
    });
  }, [accounts, statusFilter, searchQuery]);

  if (accounts.length === 0) {
    return (
      <div className="space-y-6 pb-20 lg:pb-8 w-full max-w-full">
        <div className="rounded-3xl border border-purple-500/30 bg-neutral-900/80 p-6 sm:p-10 text-center backdrop-blur-xl shadow-2xl relative overflow-hidden">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/30 ring-1 ring-purple-400/30 mb-4">
            <Server className="h-8 w-8" />
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white">
            خوش آمدید به <span dir="ltr" className="inline-block text-purple-400">Railway Hub</span>
          </h2>
          <p className="text-xs sm:text-sm text-neutral-300 max-w-md mx-auto mt-2 leading-relaxed">
            هیچ اکانت پیش‌فرضی فعال نیست. برای شروع مدیریت نودها، پایش اعتبار، استریم لاگ‌های زنده و هشدارهای درون‌برنامه‌ای، توکن API اکانت Railway خود را وارد کنید.
          </p>

          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={onOpenAddAccount}
              className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-6 py-3 text-xs font-bold text-white shadow-lg shadow-purple-600/30 hover:bg-purple-500 transition active:scale-95"
            >
              <Plus className="h-4 w-4" />
              افزودن اولین اکانت Railway
            </button>
            <a
              href="https://railway.app/account/tokens"
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-950 px-5 py-3 text-xs font-semibold text-neutral-300 hover:text-white hover:border-neutral-700 transition"
            >
              <span>ساخت توکن در Railway</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  const currentRemaining = activeAccount ? activeAccount.creditRemaining : totalCreditsRemaining;
  const currentLimit = activeAccount ? activeAccount.creditLimit : totalCreditsLimit;
  const currentUsed = activeAccount ? activeAccount.creditUsed : totalCreditsUsed;

  const currentBurnRate = activeAccount
    ? activeAccount.hourlyBurnRate
    : accounts.reduce((acc, a) => acc + a.hourlyBurnRate, 0);

  const projectedDaysLeft = currentBurnRate > 0 ? (currentRemaining / (currentBurnRate * 24)).toFixed(0) : '∞';

  const displayedServices = activeAccount
    ? activeAccount.projects.filter((p) => !p.isDeletedOnRailway && p.isExternal).flatMap((p) => p.services)
    : allServices;

  const totalNodesCount = accounts.reduce(
    (s, a) => s + a.projects.filter((p) => !p.isDeletedOnRailway && p.isExternal).reduce((sp, p) => sp + p.services.length, 0),
    0
  );

  return (
    <div className="space-y-5 pb-20 lg:pb-8 w-full max-w-full overflow-hidden">
      
      {/* 2. Scalable Multi-Account Hub Ribbon (Slider Only) */}
      <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/50 p-3 sm:p-4 backdrop-blur-xl shadow-lg relative max-w-full overflow-hidden">
        
        {/* Header Bar with Title, Total Badge, Search, and Add Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-neutral-800/80">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <Wallet className="h-3.5 w-3.5" />
              </div>
              <h2 className="text-xs sm:text-sm font-black text-white">اکانت‌های متصل به هاب</h2>
            </div>
            
            <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono">
              <span className="rounded-full bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 font-bold text-purple-300">
                {accounts.length} اکانت
              </span>
              <span className="text-neutral-500">·</span>
              <span className="text-emerald-400 font-bold">${totalCreditsRemaining.toFixed(2)} کل</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 self-end sm:self-auto">
            {/* Search Input (visible if > 3 accounts) */}
            {accounts.length > 3 && (
              <div className="relative">
                <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-neutral-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="جستجوی اکانت..."
                  className="w-28 sm:w-36 rounded-xl border border-neutral-800 bg-neutral-950 py-1 pr-7 pl-2 text-[11px] text-white placeholder-neutral-500 focus:border-purple-500 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            )}

            {/* Add Account Button */}
            <button
              onClick={onOpenAddAccount}
              className="flex items-center gap-1 rounded-xl bg-purple-600/90 hover:bg-purple-500 px-2.5 py-1 text-[11px] font-semibold text-white transition shadow-sm"
              title="افزودن اکانت جدید"
            >
              <Plus className="h-3 w-3" />
              <span className="hidden xs:inline">افزودن</span>
            </button>
          </div>
        </div>

        {/* Status Filter Chips (when accounts > 3 or when there are depleted accounts) */}
        {(accounts.length > 3 || accounts.some((a) => a.creditRemaining <= 0)) && (
          <div className="flex items-center gap-1.5 pt-2.5 overflow-x-auto no-scrollbar">
            {[
              { id: 'all', label: 'همه اکانت‌ها', count: accounts.length },
              { id: 'with-services', label: 'دارای سرویس', count: accounts.filter((a) => a.projects.some(p => !p.isDeletedOnRailway && p.isExternal && p.services.length > 0)).length },
              ...(accounts.some((a) => a.creditRemaining <= 0)
                ? [{ id: 'depleted', label: 'اتمام موجودی', count: accounts.filter((a) => a.creditRemaining <= 0).length }]
                : []),
              { id: 'low-credit', label: 'کم‌اعتبار (<$0.5)', count: accounts.filter((a) => a.creditRemaining > 0 && a.creditRemaining < 0.5).length },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id as AccountFilter)}
                className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-medium transition shrink-0 ${
                  statusFilter === f.id
                    ? f.id === 'depleted'
                      ? 'bg-rose-600/30 border border-rose-500/50 text-rose-200'
                      : 'bg-purple-600/30 border border-purple-500/50 text-purple-200'
                    : 'bg-neutral-950/60 border border-neutral-800/80 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
                }`}
              >
                <span>{f.label}</span>
                <span className="font-mono text-[9px] opacity-75">({f.count})</span>
              </button>
            ))}
          </div>
        )}

        {/* HORIZONTAL SCROLL / CAROUSEL SLIDER (The only sleek mode for the dashboard) */}
        <div className="relative pt-3 group">
          {/* Carousel navigation chevrons for easy scrolling */}
          {filteredAccounts.length > 3 && (
            <>
              <button
                onClick={() => handleScroll('right')}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-10 hidden sm:flex h-8 w-8 items-center justify-center rounded-full bg-neutral-950/90 border border-neutral-700 text-neutral-300 hover:text-white shadow-xl backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity"
                title="اسکرول به راست"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => handleScroll('left')}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 hidden sm:flex h-8 w-8 items-center justify-center rounded-full bg-neutral-950/90 border border-neutral-700 text-neutral-300 hover:text-white shadow-xl backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity"
                title="اسکرول به چپ"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </>
          )}

          <div
            ref={scrollRef}
            className="flex items-stretch gap-2.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar scroll-smooth"
          >
            {/* Special First Card: "All Accounts / نمای کل هاب" */}
            <div
              onClick={() => setActiveAccountId('all')}
              className={`cursor-pointer rounded-2xl p-3 transition-all duration-200 border min-w-[190px] sm:min-w-[215px] max-w-[230px] shrink-0 flex flex-col justify-between select-none card-hover btn-press ${
                activeAccountId === 'all'
                  ? 'bg-purple-950/40 border-purple-500/70 ring-2 ring-purple-500/30 shadow-lg shadow-purple-500/10'
                  : 'bg-neutral-950/60 border-neutral-800/90 hover:border-neutral-700 hover:bg-neutral-900/60'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-1 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-sm">
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-black text-white truncate block">کل اکانت‌ها</span>
                      <span className="text-[10px] text-purple-300 font-medium">نمای جامع هاب</span>
                    </div>
                  </div>
                  {activeAccountId === 'all' && (
                    <span className="rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.2 text-[9px] font-bold shrink-0">
                      فعال
                    </span>
                  )}
                </div>

                <div className="mt-1 flex items-baseline justify-between font-mono">
                  <span className="text-base sm:text-lg font-black text-emerald-400">
                    ${totalCreditsRemaining.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-neutral-400">
                    {totalNodesCount} نود
                  </span>
                </div>

                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-900 border border-neutral-800">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-emerald-400 transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (totalCreditsRemaining / (totalCreditsLimit || 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              <div className="mt-2.5 pt-2 border-t border-neutral-800/80 flex items-center justify-between text-[10px] text-neutral-400">
                <span>{accounts.length} اکانت متصل</span>
                <span className="text-purple-400 font-semibold">مجموع</span>
              </div>
            </div>

            {/* Individual Account Cards in Carousel */}
            {filteredAccounts.map((acc) => {
              const isDepleted = acc.creditRemaining <= 0;
              const isLow = !isDepleted && acc.creditRemaining < 0.5;
              const isSelected = activeAccountId === acc.id;
              const percent = Math.max(0, Math.min(100, (acc.creditRemaining / (acc.creditLimit || 1)) * 100));
              const nodeCount = acc.projects.filter((p) => !p.isDeletedOnRailway && p.isExternal).reduce((s, p) => s + p.services.length, 0);

              return (
                <div
                  key={acc.id}
                  onClick={() => setActiveAccountId(acc.id)}
                  className={`cursor-pointer rounded-2xl p-3 transition-all duration-200 border min-w-[200px] sm:min-w-[230px] max-w-[250px] shrink-0 flex flex-col justify-between select-none card-hover btn-press ${
                    isSelected
                      ? isDepleted
                        ? 'bg-rose-950/30 border-rose-500/70 ring-2 ring-rose-500/40 shadow-lg shadow-rose-500/10'
                        : 'bg-neutral-900/95 border-purple-500/70 ring-2 ring-purple-500/30 shadow-lg shadow-purple-500/10'
                      : isDepleted
                        ? 'bg-rose-950/15 border-rose-500/30 hover:border-rose-500/50 hover:bg-rose-950/25'
                        : 'bg-neutral-950/60 border-neutral-800/90 hover:border-neutral-700 hover:bg-neutral-900/60'
                  }`}
                >
                  <div>
                    {/* Top row: Avatar, Name & Status */}
                    <div className="flex items-center justify-between gap-1 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="relative shrink-0">
                          <div
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-white font-black text-xs shadow-sm"
                            style={{ backgroundColor: acc.color }}
                          >
                            {acc.name.charAt(0).toUpperCase()}
                          </div>
                          {isDepleted && (
                            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75"></span>
                              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500"></span>
                            </span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <span className={`text-xs font-bold truncate block transition ${isDepleted ? 'text-rose-200' : 'text-white group-hover:text-purple-300'}`}>
                            {acc.name}
                          </span>
                          <span className="text-[10px] text-neutral-400 font-mono truncate block">
                            {acc.email}
                          </span>
                        </div>
                      </div>

                      {isSelected ? (
                        <span className="rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.2 text-[9px] font-bold shrink-0">
                          انتخاب
                        </span>
                      ) : isDepleted ? (
                        <span className="rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 px-1.5 py-0.2 text-[9px] font-bold shrink-0 flex items-center gap-1">
                          <AlertCircle className="h-2.5 w-2.5 text-rose-400" />
                          <span>اتمام موجودی</span>
                        </span>
                      ) : (
                        <span className="rounded-full bg-neutral-900 px-1.5 py-0.2 text-[9px] text-neutral-400 border border-neutral-800 shrink-0">
                          {acc.plan}
                        </span>
                      )}
                    </div>

                    {/* Middle row: Balance & Progress */}
                    <div className="mt-1 flex items-baseline justify-between font-mono">
                      <div>
                        <span className={`text-base sm:text-lg font-black ${isDepleted ? 'text-rose-400' : isLow ? 'text-amber-400' : 'text-emerald-400'}`}>
                          ${acc.creditRemaining.toFixed(2)}
                        </span>
                        <span className="text-[9px] text-neutral-500 mr-1">/ ${acc.creditLimit}</span>
                      </div>
                      <span className="text-[10px] text-neutral-400">
                        {nodeCount} نود
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-900 border border-neutral-800">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isDepleted
                            ? 'bg-rose-500'
                            : isLow
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  {/* Bottom Metadata Tags */}
                  <div className="mt-2.5 pt-2 border-t border-neutral-800/80 flex items-center justify-between text-[10px] text-neutral-400">
                    <span className="flex items-center gap-1">
                      <Globe className="h-3 w-3 text-purple-400/80" />
                      <span>{regionLabel(acc.preferredRegion)}</span>
                    </span>
                    {typeof acc.creditExpiresInDays === 'number' && (
                      <span className={acc.creditExpiresInDays <= 3 ? 'text-rose-400 font-bold' : 'text-amber-400/90 font-mono'}>
                        {acc.creditExpiresInDays} روز
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* 3. Top Metrics Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4 max-w-full overflow-hidden">
        
        {/* Metric 1: Credit Balance */}
        <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-3.5 sm:p-5 backdrop-blur-md card-hover">
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs font-medium text-neutral-400">
              {activeAccountId === 'all' ? 'مجموع اعتبار کل هاب' : 'اعتبار باقی‌مانده'}
            </span>
            <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 shrink-0">
              <Wallet className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          </div>
          <div className="mt-2.5">
            <div className="text-xl sm:text-2xl font-black text-white font-mono truncate">
              ${currentRemaining.toFixed(2)}
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] sm:text-xs text-neutral-400">
              <span className="truncate">مصرف: ${currentUsed.toFixed(2)}</span>
              <span className="text-emerald-400 font-mono shrink-0">
                {((currentRemaining / (currentLimit || 1)) * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </div>

        {/* Metric 2: Active Nodes */}
        <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-3.5 sm:p-5 backdrop-blur-md card-hover">
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs font-medium text-neutral-400">
              {activeAccountId === 'all' ? 'کل نودها در تمام اکانت‌ها' : 'نودها و سرویس‌ها'}
            </span>
            <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 shrink-0">
              <Server className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          </div>
          <div className="mt-2.5">
            <div className="text-xl sm:text-2xl font-black text-white font-mono">
              {displayedServices.filter((s) => s.status === 'healthy').length}
              <span className="text-xs font-normal text-neutral-500 mr-1">
                / {displayedServices.length}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] sm:text-xs flex-wrap">
              <span className="text-emerald-400">
                {displayedServices.filter((s) => s.status === 'healthy').length} آنلاین
              </span>
              {displayedServices.filter((s) => s.status === 'crashed').length > 0 && (
                <span className="text-rose-400">
                  {displayedServices.filter((s) => s.status === 'crashed').length} خطا
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Metric 3: Hourly Burn Rate */}
        <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-3.5 sm:p-5 backdrop-blur-md card-hover">
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs font-medium text-neutral-400">
              {activeAccountId === 'all' ? 'نرخ کل مصرف ساعتی' : 'نرخ مصرف ساعتی'}
            </span>
            <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 shrink-0">
              <Flame className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          </div>
          <div className="mt-2.5">
            <div className="text-xl sm:text-2xl font-black text-white font-mono truncate">
              ${currentBurnRate.toFixed(3)}
            </div>
            <div className="mt-1 text-[10px] sm:text-xs text-neutral-400 truncate">
              دوام: <span className="font-semibold text-neutral-200 font-mono">~{projectedDaysLeft} روز</span>
            </div>
          </div>
        </div>

        {/* Metric 4: Scope / Accounts Breakdown */}
        <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-3.5 sm:p-5 backdrop-blur-md card-hover">
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs font-medium text-neutral-400">
              {activeAccountId === 'all' ? 'وضعیت اکانت‌های هاب' : 'اطلاعات اکانت فعال'}
            </span>
            <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 shrink-0">
              <Globe className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          </div>
          <div className="mt-2.5">
            {activeAccountId === 'all' ? (
              <>
                <div className="text-xl sm:text-2xl font-black text-white font-mono flex items-baseline gap-1">
                  <span>{accounts.length}</span>
                  <span className="text-xs font-normal text-emerald-400 font-sans">اکانت متصل و همگام</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] sm:text-xs text-purple-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
                  <span>نمای یکپارچه و جامع کل هاب</span>
                </div>
              </>
            ) : (
              <>
                <div className="text-base sm:text-lg font-black text-white truncate">
                  {activeAccount?.name}
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] sm:text-xs text-neutral-400">
                  <span>پلن: {activeAccount?.plan}</span>
                  <span className="text-purple-300 font-mono">{regionLabel(activeAccount?.preferredRegion)}</span>
                </div>
              </>
            )}
          </div>
        </div>

      </div>

      {/* 4. Active Nodes Grid */}
      <div className="max-w-full overflow-hidden">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-purple-400 shrink-0" />
            <h2 className="text-xs sm:text-sm font-bold text-neutral-200">
              {activeAccountId === 'all'
                ? `وضعیت تمام نودها (${displayedServices.length} سرویس در ${accounts.length} اکانت)`
                : `نودها و سرویس‌های اکانت ${activeAccount?.name || ''}`}
            </h2>
          </div>
          <button
            onClick={() => setActiveTab('nodes')}
            className="flex items-center gap-0.5 text-[11px] text-neutral-400 hover:text-white transition"
          >
            مدیریت نودها
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>

        {displayedServices.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/30 p-6 text-center text-xs text-neutral-400">
            هیچ سرویس فعالی در این بخش یافت نشد.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {displayedServices.map((srv) => {
              const isHealthy = srv.status === 'healthy';
              const isStopped = srv.status === 'stopped';
              const isCrashed = srv.status === 'crashed';
              const isDeploying = srv.status === 'deploying';
              const serviceOwnerAccount = accounts.find((a) => a.id === srv.accountId);

              return (
                <div
                  key={srv.id}
                  className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-3.5 transition hover:border-neutral-700 backdrop-blur-md max-w-full overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-800 text-base border border-neutral-700/50">
                        <ServiceIcon icon={srv.icon} alt={srv.name} imgClassName="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-white text-xs sm:text-sm truncate">{srv.name}</span>
                          {srv.domains.length > 0 && (
                            <span className="text-[9px] text-neutral-500 font-mono shrink-0">
                              :{srv.port}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-neutral-400 truncate font-mono">
                          {srv.imageOrRepo}
                        </p>
                        {/* Account Owner Badge when viewing All Accounts */}
                        {activeAccountId === 'all' && serviceOwnerAccount && (
                          <div className="flex items-center gap-1 text-[9px] text-neutral-400 mt-0.5">
                            <div
                              className="h-1.5 w-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: serviceOwnerAccount.color }}
                            />
                            <span className="truncate">{serviceOwnerAccount.name}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Status badge */}
                    <div className="shrink-0">
                      {isHealthy && (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-400 ring-1 ring-emerald-500/20">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          آنلاین
                        </span>
                      )}
                      {isDeploying && (
                        <span className="flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-[9px] font-semibold text-purple-400 ring-1 ring-purple-500/20">
                          <RotateCw className="h-3 w-3 animate-spin" />
                          دپلوی
                        </span>
                      )}
                      {isStopped && (
                        <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[9px] font-medium text-neutral-400">
                          متوقف
                        </span>
                      )}
                      {isCrashed && (
                        <span className="flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[9px] font-semibold text-rose-400 ring-1 ring-rose-500/20">
                          <AlertOctagon className="h-3 w-3" />
                          خطا
                        </span>
                      )}
                    </div>
                  </div>

                {/* Metrics Gauges */}
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-neutral-950/60 p-2 border border-neutral-800/50">
                  <div>
                    <div className="flex items-center justify-between text-[10px] text-neutral-400">
                      <span>پردازنده</span>
                      <span className="font-mono text-white">{srv.cpuUsage}%</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          srv.cpuUsage > 80 ? 'bg-rose-500' : 'bg-purple-500'
                        }`}
                        style={{ width: `${Math.min(100, srv.cpuUsage)}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-[10px] text-neutral-400">
                      <span>حافظه</span>
                      <span className="font-mono text-white">{srv.memoryUsage}MB</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all"
                        style={{ width: `${Math.min(100, (srv.memoryUsage / srv.memoryLimit) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Actions row */}
                <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-neutral-800/60 text-xs">
                  <span className="text-[10px] text-neutral-500 truncate">آپتایم: {srv.uptime}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => restartService(srv.id)}
                      className="rounded-lg p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
                      title="ری‌استارت"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setActiveTab('nodes')}
                      className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-[10px] text-purple-400 hover:bg-purple-500/10 transition font-medium"
                    >
                      <Terminal className="h-3 w-3" />
                      لاگ نود
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* 5. Live Logs Preview */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-3.5 backdrop-blur-md max-w-full overflow-hidden">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5">
            <Terminal className="h-4 w-4 text-emerald-400 shrink-0" />
            <h3 className="text-xs sm:text-sm font-bold text-white">لاگ‌های زنده نودها</h3>
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          </div>
          <button
            onClick={() => setActiveTab('nodes')}
            className="text-[11px] text-purple-400 hover:text-purple-300 font-medium"
          >
            مدیریت در نودها
          </button>
        </div>

        <div className="rounded-xl bg-neutral-950 p-2.5 font-mono text-[10px] sm:text-[11px] space-y-1 border border-neutral-800/80 max-h-48 overflow-y-auto max-w-full">
          {logs.slice(-5).map((log) => (
            <div key={log.id} className="flex items-start gap-1.5 leading-relaxed break-all">
              <span className="text-neutral-500 shrink-0 select-none">[{log.timestamp}]</span>
              <span
                className={`font-semibold shrink-0 ${
                  log.level === 'error'
                    ? 'text-rose-400'
                    : log.level === 'warn'
                    ? 'text-amber-400'
                    : 'text-purple-400'
                }`}
              >
                [{log.serviceName}]
              </span>
              <span className="text-neutral-300 break-all">{log.message}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
