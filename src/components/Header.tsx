import React, { useState, useMemo } from 'react';
import {
  Server,
  Plus,
  Wallet,
  ChevronDown,
  Layers,
  Activity,
  Terminal,
  BarChart3,
  RefreshCw,
  LogOut,
  Rocket,
  CheckCircle2,
  AlertCircle,
  X,
  Send,
  User,
  Search,
  Tag,
} from 'lucide-react';
import { useHub, useBackHandler } from '../context/HubContext';
import { logoutAuth } from '../services/authApi';
import { TelegramBackupModal } from './TelegramBackupModal';
import { PWAInstallButton } from './PWAInstallButton';
import { AccountMenuModal } from './AccountMenuModal';

interface HeaderProps {
  onOpenAddAccount: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenAddAccount,
}) => {
  const {
    accounts,
    activeAccountId,
    setActiveAccountId,
    activeAccount,
    totalCreditsRemaining,
    totalCreditsLimit,
    activeTab,
    setActiveTab,
    refreshAccountBalances,
    syncAccountProjects,
    isSyncingProjects,
    deployJob,
    setDeployJob,
  } = useHub();

  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [searchAccountQuery, setSearchAccountQuery] = useState('');
  const [isTelegramOpen, setIsTelegramOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);

  // Mobile back button closes active dropdowns/modals before exiting
  useBackHandler(accountDropdownOpen, () => setAccountDropdownOpen(false));
  useBackHandler(isTelegramOpen, () => setIsTelegramOpen(false));
  useBackHandler(isAccountMenuOpen, () => setIsAccountMenuOpen(false));

  const depletedAccountsCount = useMemo(() => {
    return accounts.filter((a) => a.creditRemaining <= 0).length;
  }, [accounts]);

  const isActiveAccountDepleted = activeAccount ? activeAccount.creditRemaining <= 0 : false;

  const filteredDropdownAccounts = useMemo(() => {
    const q = searchAccountQuery.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        (a.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }, [accounts, searchAccountQuery]);

  const currentDisplayBalance = activeAccount
    ? activeAccount.creditRemaining
    : totalCreditsRemaining;

  const currentLimit = activeAccount ? activeAccount.creditLimit : totalCreditsLimit;
  const balancePercentage = Math.max(0, Math.min(100, (currentDisplayBalance / (currentLimit || 1)) * 100));

  return (
    <>
    <header className="sticky top-0 z-[1000] w-full max-w-full border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-xl transition-colors">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:px-6">
        
        {/* Left Side: Brand */}
        <div className="flex items-center gap-2 sm:gap-4 shrink-0 min-w-0">
          <div className="flex items-center gap-2 cursor-pointer shrink-0 btn-press group" onClick={() => setActiveTab('dashboard')}>
            <div className="relative flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-violet-500 shadow-md shadow-purple-500/20 ring-1 ring-purple-400/30 transition-transform group-hover:scale-105 duration-200">
              <Server className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
              <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-neutral-950"></span>
              </span>
            </div>
            <div className="min-w-0 flex flex-col justify-center text-right">
              <div className="flex items-center gap-1.5" dir="ltr">
                <span className="font-extrabold tracking-tight text-white text-xs sm:text-base whitespace-nowrap">
                  Railway Hub
                </span>
                <span className="hidden sm:inline-flex items-center rounded-full bg-purple-500/15 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-semibold text-purple-300 ring-1 ring-purple-500/30">
                  Manager
                </span>
              </div>
              <p className="hidden text-[11px] text-neutral-400 md:block leading-tight mt-0.5">مدیریت متمرکز نودها و اکانت‌ها</p>
            </div>
          </div>
        </div>

        {/* Right Side: Quick Switcher, Balance, Deploy */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          
          {/* Active Account Switcher Dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setAccountDropdownOpen(!accountDropdownOpen);
                setSearchAccountQuery('');
              }}
              className={`flex items-center gap-1 sm:gap-1.5 rounded-xl border px-2 py-1 sm:px-2.5 sm:py-1.5 text-xs font-medium transition btn-press ${
                isActiveAccountDepleted
                  ? 'bg-rose-950/40 border-rose-500/50 text-rose-200 hover:border-rose-400 ring-1 ring-rose-500/30'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-200 hover:border-neutral-700'
              }`}
            >
              {isActiveAccountDepleted ? (
                <div className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500"></span>
                </div>
              ) : (
                <div
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: activeAccount ? activeAccount.color : '#8B5CF6' }}
                />
              )}
              <span className="max-w-[65px] xs:max-w-[95px] sm:max-w-[140px] truncate text-[11px] sm:text-xs">
                {activeAccount ? activeAccount.name : 'همه اکانت‌ها'}
              </span>

              {/* Show explicit Depleted Badge if the active account is out of credit */}
              {isActiveAccountDepleted && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-rose-500/25 border border-rose-500/40 px-1 sm:px-1.5 py-0.2 text-[8px] sm:text-[9px] font-sans font-bold text-rose-200 shrink-0">
                  <AlertCircle className="h-2.5 w-2.5 text-rose-400" />
                  <span className="hidden xs:inline">اتمام موجودی</span>
                  <span className="xs:hidden">صفر</span>
                </span>
              )}

              {/* If "All Accounts" is active and there are depleted accounts, indicate it */}
              {!activeAccount && depletedAccountsCount > 0 && (
                <span
                  className="hidden sm:inline-flex items-center gap-0.5 rounded-md bg-rose-500/15 border border-rose-500/30 px-1 py-0 text-[8px] sm:text-[9px] font-sans font-medium text-rose-300 shrink-0"
                  title={`${depletedAccountsCount} اکانت اتمام موجودی دارد`}
                >
                  <AlertCircle className="h-2.5 w-2.5 text-rose-400" />
                  <span>{depletedAccountsCount} اتمام موجودی</span>
                </span>
              )}

              {activeAccount?.tags && activeAccount.tags.length > 0 && !isActiveAccountDepleted && (
                <div className="hidden md:flex items-center gap-1 shrink-0">
                  {activeAccount.tags.slice(0, 2).map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-0.5 rounded bg-purple-500/15 border border-purple-500/30 px-1 py-0 text-[9px] font-sans text-purple-300"
                    >
                      <Tag className="h-2 w-2 text-purple-400" />
                      <span className="truncate max-w-[60px]">{t}</span>
                    </span>
                  ))}
                  {activeAccount.tags.length > 2 && (
                    <span className="text-[9px] text-neutral-500 font-mono">
                      +{activeAccount.tags.length - 2}
                    </span>
                  )}
                </div>
              )}
              <ChevronDown className={`h-3 w-3 text-neutral-400 shrink-0 transition-transform duration-200 ${accountDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {accountDropdownOpen && (
              <>
                {/* Backdrop to close dropdown on click outside */}
                <div
                  className="fixed inset-0 z-[1050] bg-black/60 backdrop-blur-sm modal-backdrop-anim"
                  onClick={() => setAccountDropdownOpen(false)}
                />

                <div
                  className="fixed inset-x-2.5 top-14 sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 w-auto sm:w-96 max-w-full sm:max-w-[calc(100vw-2rem)] rounded-2xl border border-neutral-800 bg-neutral-900/98 p-3 shadow-2xl backdrop-blur-2xl z-[1060] dropdown-anim ring-1 ring-white/10 max-h-[85vh] flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-1 py-1 text-xs font-semibold text-neutral-400 flex items-center justify-between border-b border-neutral-800/80 pb-2 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-white font-bold">انتخاب اکانت فعال ({accounts.length})</span>
                      {depletedAccountsCount > 0 && (
                        <span className="text-[10px] rounded-md bg-rose-500/20 border border-rose-500/35 text-rose-300 px-1.5 py-0.5 font-sans font-bold flex items-center gap-1">
                          <AlertCircle className="h-2.5 w-2.5 text-rose-400" />
                          <span>{depletedAccountsCount} اتمام موجودی</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          syncAccountProjects('all');
                        }}
                        className="text-purple-400 hover:text-purple-300 text-[11px] flex items-center gap-1 bg-purple-500/10 hover:bg-purple-500/20 px-2 py-1 rounded-lg border border-purple-500/20 transition font-medium"
                        title="همگام‌سازی از ریلوی"
                      >
                        <RefreshCw className={`h-3 w-3 ${isSyncingProjects ? 'animate-spin' : ''}`} />
                        <span>همگام‌سازی</span>
                      </button>
                      <button
                        onClick={() => setAccountDropdownOpen(false)}
                        className="rounded-lg p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
                        title="بستن منو"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Search inside dropdown when accounts > 3 */}
                  {accounts.length > 3 && (
                    <div className="relative my-1.5">
                      <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
                      <input
                        type="text"
                        value={searchAccountQuery}
                        onChange={(e) => setSearchAccountQuery(e.target.value)}
                        placeholder="جستجوی سریع اکانت یا تگ..."
                        className="w-full rounded-xl border border-neutral-800 bg-neutral-950 py-1.5 pr-8 pl-8 text-xs text-white placeholder-neutral-500 focus:border-purple-500 focus:outline-none"
                      />
                      {searchAccountQuery && (
                        <button
                          onClick={() => setSearchAccountQuery('')}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* All Accounts Option */}
                  <button
                    onClick={() => {
                      setActiveAccountId('all');
                      setAccountDropdownOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs transition my-1 ${
                      activeAccountId === 'all'
                        ? 'bg-purple-950/50 text-purple-200 font-semibold ring-1 ring-purple-500/40'
                        : 'text-neutral-300 hover:bg-neutral-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <div className="h-2.5 w-2.5 rounded-full bg-gradient-to-tr from-purple-500 to-indigo-400 shrink-0" />
                      <span className="truncate font-bold">همه اکانت‌ها (نمای جامع)</span>
                      {depletedAccountsCount > 0 && (
                        <span className="text-[9px] rounded-md bg-rose-500/20 border border-rose-500/30 text-rose-300 px-1 py-0 font-sans font-semibold shrink-0">
                          {depletedAccountsCount} اتمام اعتبار
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-emerald-400 font-bold text-xs">
                      ${totalCreditsRemaining.toFixed(2)}
                    </span>
                  </button>

                  <div className="my-1 border-t border-neutral-800/80" />

                  {/* Scrollable Accounts List */}
                  <div className="max-h-[50vh] sm:max-h-64 overflow-y-auto space-y-1 pr-0.5 custom-scrollbar flex-1">
                    {filteredDropdownAccounts.length === 0 ? (
                      <div className="py-4 text-center text-xs text-neutral-500">
                        اکانتی با این مشخصات یافت نشد
                      </div>
                    ) : (
                      filteredDropdownAccounts.map((acc) => {
                        const isDepleted = acc.creditRemaining <= 0;
                        const isLow = !isDepleted && acc.creditRemaining < 0.5;
                        const isSelected = activeAccountId === acc.id;

                        return (
                          <button
                            key={acc.id}
                            onClick={() => {
                              setActiveAccountId(acc.id);
                              setAccountDropdownOpen(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs transition border ${
                              isSelected
                                ? isDepleted
                                  ? 'bg-rose-950/40 border-rose-500/60 text-white font-medium ring-1 ring-rose-500/50'
                                  : 'bg-neutral-800 border-neutral-700 text-white font-medium ring-1 ring-neutral-700'
                                : isDepleted
                                  ? 'bg-rose-950/15 border-rose-500/30 text-neutral-200 hover:bg-rose-950/30 hover:border-rose-500/50'
                                  : 'border-transparent text-neutral-300 hover:bg-neutral-800/60'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1 text-right">
                              <div className="relative shrink-0 flex items-center justify-center">
                                <div
                                  className="h-2.5 w-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: acc.color }}
                                />
                                {isDepleted && (
                                  <span className="absolute -top-1 -right-1 flex h-2 w-2">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75"></span>
                                    <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500"></span>
                                  </span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1 truncate">
                                <div className="flex items-center gap-1.5 truncate">
                                  <span className={`truncate font-semibold ${isDepleted ? 'text-rose-200' : 'text-neutral-100'} block`}>
                                    {acc.name}
                                  </span>
                                  {isDepleted && (
                                    <span className="inline-flex items-center gap-0.5 rounded-md bg-rose-500/25 border border-rose-500/40 px-1.5 py-0.2 text-[8px] sm:text-[9px] font-sans font-bold text-rose-200 shrink-0">
                                      <AlertCircle className="h-2 w-2 text-rose-400 shrink-0" />
                                      <span>اتمام موجودی</span>
                                    </span>
                                  )}
                                  {isLow && (
                                    <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 px-1 py-0 text-[8px] font-sans font-medium text-amber-300 shrink-0">
                                      <span>کم‌اعتبار</span>
                                    </span>
                                  )}
                                </div>
                                {acc.tags && acc.tags.length > 0 && (
                                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                    {acc.tags.map((tag) => (
                                      <span
                                        key={tag}
                                        className="inline-flex items-center gap-0.5 rounded-md bg-purple-500/15 border border-purple-500/30 px-1 py-0.2 text-[8px] font-sans font-medium text-purple-300 truncate max-w-[80px]"
                                      >
                                        <Tag className="h-2 w-2 text-purple-400 shrink-0" />
                                        <span className="truncate">{tag}</span>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 font-mono text-[11px] shrink-0 mr-2">
                              <span className={`font-bold ${isDepleted ? 'text-rose-400' : isLow ? 'text-amber-400' : 'text-emerald-400'}`}>
                                ${acc.creditRemaining.toFixed(2)}
                              </span>
                              {typeof acc.creditExpiresInDays === 'number' && (
                                <span
                                  className={`text-[9px] px-1.5 py-0.5 rounded font-sans font-medium ${
                                    acc.creditExpiresInDays <= 3 || isDepleted
                                      ? 'bg-rose-500/15 text-rose-300 border border-rose-500/25'
                                      : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                                  }`}
                                  title={
                                    acc.billingPeriodEnd
                                      ? `روزهای باقی‌مانده اعتبار · ریست دوره: ${acc.billingPeriodEnd}`
                                      : undefined
                                  }
                                >
                                  {acc.creditExpiresInDays}روز
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>

                  <div className="my-1.5 border-t border-neutral-800/80 pt-1">
                    <button
                      onClick={() => {
                        setAccountDropdownOpen(false);
                        onOpenAddAccount();
                      }}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-purple-600/15 border border-purple-500/30 py-2 text-xs text-purple-300 hover:bg-purple-600/25 transition font-semibold"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>افزودن اکانت جدید</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Quick Balance Status Badge */}
          <button
            onClick={() => setActiveTab('accounts')}
            className={`hidden md:flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs transition border btn-press card-hover ${
              currentDisplayBalance <= 0
                ? 'bg-rose-950/20 border-rose-500/40 hover:border-rose-400 text-rose-200'
                : 'bg-neutral-900/90 border-neutral-800 hover:border-neutral-700 text-neutral-300'
            }`}
            title="مشاهده جزئیات اعتبار اکانت‌ها"
          >
            <Wallet className={`h-3.5 w-3.5 ${currentDisplayBalance <= 0 ? 'text-rose-400' : 'text-purple-400'}`} />
            <div className="flex items-center gap-1">
              <span className="text-neutral-400 text-[11px]">اعتبار:</span>
              <span className={`font-mono font-semibold ${currentDisplayBalance <= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                ${currentDisplayBalance.toFixed(2)}
              </span>
              {currentDisplayBalance <= 0 && (
                <span className="rounded bg-rose-500/25 border border-rose-500/40 px-1.5 py-0.2 text-[9px] text-rose-200 font-bold font-sans">
                  اتمام موجودی
                </span>
              )}
            </div>
            <div className="h-1.5 w-8 overflow-hidden rounded-full bg-neutral-800">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  currentDisplayBalance <= 0 ? 'bg-rose-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${balancePercentage}%` }}
              />
            </div>
          </button>

          {/* PWA Install Button */}
          <PWAInstallButton />

          {/* Refresh Balances & Sync Projects Button */}
          <button
            onClick={() => {
              refreshAccountBalances();
              syncAccountProjects('all');
            }}
            className="flex h-7 w-7 sm:h-9 sm:w-9 items-center justify-center rounded-lg sm:rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-700 transition shrink-0 btn-press"
            title="به‌روزرسانی و همگام‌سازی پروژه‌ها از ریلیوی"
          >
            <RefreshCw className={`h-3 w-3 sm:h-4 sm:w-4 ${isSyncingProjects ? 'animate-spin text-purple-400' : 'hover:rotate-180'} transition-transform duration-500`} />
          </button>

          {/* Telegram backup / restore */}
          <button
            onClick={() => setIsTelegramOpen(true)}
            className="flex h-7 w-7 sm:h-9 sm:w-9 items-center justify-center rounded-lg sm:rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-sky-400 hover:border-sky-500/40 transition shrink-0 btn-press"
            title="پشتیبان‌گیری و بازیابی دیتابیس"
          >
            <Send className="h-3 w-3 sm:h-4 sm:w-4" />
          </button>

          {/* User Account & Security Button */}
          <button
            onClick={() => setIsAccountMenuOpen(true)}
            className="flex h-7 sm:h-9 items-center gap-1.5 rounded-lg sm:rounded-xl bg-neutral-900 border border-neutral-800 px-2 sm:px-2.5 text-neutral-300 hover:text-white hover:border-purple-500/40 hover:bg-purple-500/10 transition shrink-0 btn-press"
            title="حساب کاربری، تغییر رمز و خروج"
          >
            <div className="flex h-4 w-4 sm:h-5 sm:w-5 items-center justify-center rounded-md bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shrink-0 shadow-sm">
              <User className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
            </div>
            <span className="text-[11px] sm:text-xs font-medium font-mono hidden xs:inline">admin</span>
          </button>
        </div>
      </div>

      {/* Secondary Desktop Navigation Row */}
      <div className="hidden lg:block border-t border-neutral-800/60 bg-neutral-950/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-1.5 sm:px-6">
          <nav className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all btn-press ${
                activeTab === 'dashboard'
                  ? 'bg-neutral-800 text-white shadow-sm ring-1 ring-white/10'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/80'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>داشبورد</span>
            </button>
            <button
              onClick={() => setActiveTab('nodes')}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all btn-press ${
                activeTab === 'nodes'
                  ? 'bg-neutral-800 text-white shadow-sm ring-1 ring-white/10'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/80'
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              <span>نودها و سرویس‌ها</span>
            </button>
            <button
              onClick={() => setActiveTab('metrics')}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all btn-press ${
                activeTab === 'metrics'
                  ? 'bg-neutral-800 text-white shadow-sm ring-1 ring-white/10'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/80'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span>مصرف منابع</span>
            </button>
            <button
              onClick={() => setActiveTab('accounts')}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all btn-press ${
                activeTab === 'accounts'
                  ? 'bg-neutral-800 text-white shadow-sm ring-1 ring-white/10'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/80'
              }`}
            >
              <Wallet className="h-3.5 w-3.5" />
              <span>اکانت‌ها</span>
              <span className="rounded-full bg-purple-500/20 px-1.5 py-0.2 text-[10px] font-bold text-purple-300">
                {accounts.length}
              </span>
            </button>
          </nav>

          <div className="flex items-center gap-2 text-[11px] text-neutral-400 font-medium">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>مدیریت متمرکز پروژه‌ها</span>
          </div>
        </div>
      </div>

      {/* Persistent deploy-status banner — keeps updating after DeployModal closes. */}
      {deployJob && (
        <div
          className={`mx-2.5 mb-2 sm:mx-6 flex items-center gap-2 rounded-xl border p-2.5 text-xs sm:text-[13px] ${
            deployJob.status === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : deployJob.status === 'error'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-sky-500/10 border-sky-500/30 text-sky-300'
          }`}
        >
          {deployJob.status === 'running' ? (
            <Rocket className="h-4 w-4 shrink-0 animate-pulse" />
          ) : deployJob.status === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span className="truncate flex-1" title={deployJob.phase}>
            {deployJob.status === 'running' ? 'دیپلوی در جریان: ' : ''}
            {deployJob.phase}
          </span>
          {deployJob.domain && deployJob.status === 'success' && (
            <a
              href={`https://${deployJob.domain}`}
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline font-mono text-[11px] underline underline-offset-2 shrink-0 hover:text-emerald-200"
            >
              {deployJob.domain}
            </a>
          )}
          <button
            onClick={() => setDeployJob(null)}
            className="shrink-0 rounded-lg p-1 hover:bg-white/10 transition"
            title="بستن"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </header>

    <TelegramBackupModal isOpen={isTelegramOpen} onClose={() => setIsTelegramOpen(false)} />
    <AccountMenuModal isOpen={isAccountMenuOpen} onClose={() => setIsAccountMenuOpen(false)} />
    </>
  );
};
