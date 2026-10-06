import React, { useState } from 'react';
import {
  Server,
  Plus,
  ShieldCheck,
  ShieldAlert,
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
} from 'lucide-react';
import { useHub } from '../context/HubContext';
import { logoutAuth } from '../services/authApi';
import { TelegramBackupModal } from './TelegramBackupModal';

interface HeaderProps {
  onOpenAddAccount: () => void;
  onOpenBudgetGuard: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenAddAccount,
  onOpenBudgetGuard,
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
  const [isTelegramOpen, setIsTelegramOpen] = useState(false);

  const currentDisplayBalance = activeAccount
    ? activeAccount.creditRemaining
    : totalCreditsRemaining;

  const currentLimit = activeAccount ? activeAccount.creditLimit : totalCreditsLimit;
  const balancePercentage = Math.max(0, Math.min(100, (currentDisplayBalance / (currentLimit || 1)) * 100));

  const hasShutdownTriggered = activeAccount
    ? activeAccount.isShutdownTriggered
    : accounts.some((a) => a.isShutdownTriggered);

  return (
    <>
    <header className="sticky top-0 z-[1000] w-full max-w-full border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-xl transition-colors">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:px-6">
        
        {/* Left Side: Brand & Navigation */}
        <div className="flex items-center gap-2 sm:gap-4 shrink-0 min-w-0">
          <div className="flex items-center gap-2 cursor-pointer shrink-0" onClick={() => setActiveTab('dashboard')}>
            <div className="relative flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-violet-500 shadow-md shadow-purple-500/20 ring-1 ring-purple-400/30">
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

          {/* Desktop Navigation Tabs */}
          <nav className="hidden lg:flex items-center gap-1 rounded-xl bg-neutral-900/90 p-1 ring-1 ring-neutral-800">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 xl:px-3 py-1.5 text-xs font-medium transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-neutral-800 text-white shadow-sm ring-1 ring-white/10'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              داشبورد
            </button>
            <button
              onClick={() => setActiveTab('nodes')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 xl:px-3 py-1.5 text-xs font-medium transition-all ${
                activeTab === 'nodes'
                  ? 'bg-neutral-800 text-white shadow-sm ring-1 ring-white/10'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              نودها و سرویس‌ها
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 xl:px-3 py-1.5 text-xs font-medium transition-all ${
                activeTab === 'logs'
                  ? 'bg-neutral-800 text-white shadow-sm ring-1 ring-white/10'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Terminal className="h-3.5 w-3.5" />
              لاگ زنده
            </button>
            <button
              onClick={() => setActiveTab('metrics')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 xl:px-3 py-1.5 text-xs font-medium transition-all ${
                activeTab === 'metrics'
                  ? 'bg-neutral-800 text-white shadow-sm ring-1 ring-white/10'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              مصرف منابع
            </button>
            <button
              onClick={() => setActiveTab('accounts')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 xl:px-3 py-1.5 text-xs font-medium transition-all ${
                activeTab === 'accounts'
                  ? 'bg-neutral-800 text-white shadow-sm ring-1 ring-white/10'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Wallet className="h-3.5 w-3.5" />
              اکانت‌ها ({accounts.length})
            </button>
          </nav>
        </div>

        {/* Right Side: Quick Switcher, Budget Guard, Deploy */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          
          {/* Active Account Switcher Dropdown */}
          <div className="relative">
            <button
              onClick={() => setAccountDropdownOpen(!accountDropdownOpen)}
              className="flex items-center gap-1 sm:gap-1.5 rounded-xl bg-neutral-900 border border-neutral-800 px-2 py-1 sm:px-2.5 sm:py-1.5 text-xs font-medium text-neutral-200 hover:border-neutral-700 transition"
            >
              <div
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: activeAccount ? activeAccount.color : '#8B5CF6' }}
              />
              <span className="max-w-[65px] xs:max-w-[100px] sm:max-w-[150px] truncate text-[11px] sm:text-xs">
                {activeAccount ? activeAccount.name : 'اکانت‌ها'}
              </span>
              <ChevronDown className="h-3 w-3 text-neutral-400 shrink-0" />
            </button>

            {accountDropdownOpen && (
              <>
                {/* Backdrop to close dropdown on click outside */}
                <div
                  className="fixed inset-0 z-[1050] bg-black/20"
                  onClick={() => setAccountDropdownOpen(false)}
                />

                <div
                  className="absolute left-0 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-neutral-800 bg-neutral-900/98 p-2 shadow-2xl backdrop-blur-2xl z-[1060] animate-in fade-in zoom-in-95 ring-1 ring-white/10"
                  onClick={() => setAccountDropdownOpen(false)}
                >
                  <div className="px-2 py-1.5 text-[11px] font-semibold text-neutral-400 flex items-center justify-between">
                    <span>انتخاب اکانت فعال</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        syncAccountProjects('all');
                      }}
                      className="text-purple-400 hover:text-purple-300 text-[10px] flex items-center gap-1"
                    >
                      <RefreshCw className={`h-3 w-3 ${isSyncingProjects ? 'animate-spin' : ''}`} />
                      <span>همگام‌سازی پروژه‌ها</span>
                    </button>
                  </div>
                  {accounts.map((acc) => (
                    <button
                      key={acc.id}
                      onClick={() => setActiveAccountId(acc.id)}
                      className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs transition ${
                        activeAccountId === acc.id
                          ? 'bg-neutral-800 text-white font-medium ring-1 ring-neutral-700'
                          : 'text-neutral-300 hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: acc.color }} />
                        <span className="truncate">{acc.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-left font-mono text-[11px] shrink-0">
                        <span className={acc.creditRemaining < acc.autoShutdownThreshold ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                          ${acc.creditRemaining.toFixed(2)}
                        </span>
                        {typeof acc.creditExpiresInDays === 'number' && (
                          <span
                            className={`text-[9px] px-1 py-0.5 rounded ${
                              acc.creditExpiresInDays <= 3
                                ? 'bg-rose-500/15 text-rose-300'
                                : 'bg-amber-500/10 text-amber-300'
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
                  ))}

                  <div className="my-1 border-t border-neutral-800" />

                  <button
                    onClick={() => onOpenAddAccount()}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-xs text-purple-400 hover:bg-purple-500/10 transition font-medium"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>افزودن اکانت جدید</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Quick Balance & Budget Guard Badge */}
          <button
            onClick={onOpenBudgetGuard}
            className="hidden md:flex items-center gap-2 rounded-xl bg-neutral-900/90 border border-neutral-800 px-3 py-1.5 text-xs hover:border-neutral-700 transition"
            title="مدیریت محافظ بودجه و توقف خودکار"
          >
            {hasShutdownTriggered ? (
              <ShieldAlert className="h-3.5 w-3.5 text-rose-400 animate-pulse" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            )}
            <div className="flex items-center gap-1">
              <span className="text-neutral-400 text-[11px]">اعتبار:</span>
              <span
                className={`font-mono font-semibold ${
                  currentDisplayBalance < 1 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                ${currentDisplayBalance.toFixed(2)}
              </span>
            </div>
            <div className="h-1.5 w-8 overflow-hidden rounded-full bg-neutral-800">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  balancePercentage > 40 ? 'bg-emerald-500' : balancePercentage > 15 ? 'bg-amber-500' : 'bg-rose-500'
                }`}
                style={{ width: `${balancePercentage}%` }}
              />
            </div>
          </button>

          {/* Refresh Balances & Sync Projects Button */}
          <button
            onClick={() => {
              refreshAccountBalances();
              syncAccountProjects('all');
            }}
            className="flex h-7 w-7 sm:h-9 sm:w-9 items-center justify-center rounded-lg sm:rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-700 transition shrink-0"
            title="به‌روزرسانی و همگام‌سازی پروژه‌ها از ریلیوی"
          >
            <RefreshCw className={`h-3 w-3 sm:h-4 sm:w-4 ${isSyncingProjects ? 'animate-spin text-purple-400' : 'hover:rotate-180'} transition-transform duration-500`} />
          </button>

          {/* Telegram backup / restore */}
          <button
            onClick={() => setIsTelegramOpen(true)}
            className="flex h-7 w-7 sm:h-9 sm:w-9 items-center justify-center rounded-lg sm:rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-sky-400 hover:border-sky-500/40 transition shrink-0"
            title="پشتیبان‌گیری و بازیابی دیتابیس"
          >
            <Send className="h-3 w-3 sm:h-4 sm:w-4" />
          </button>

          {/* Logout */}
          <button
            onClick={async () => {
              await logoutAuth();
              window.location.reload();
            }}
            className="flex h-7 w-7 sm:h-9 sm:w-9 items-center justify-center rounded-lg sm:rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-rose-400 hover:border-rose-500/40 transition shrink-0"
            title="خروج از حساب"
          >
            <LogOut className="h-3 w-3 sm:h-4 sm:w-4" />
          </button>
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
    </>
  );
};
