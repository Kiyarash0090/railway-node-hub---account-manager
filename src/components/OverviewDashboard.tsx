import React from 'react';
import {
  Wallet,
  Activity,
  Flame,
  ShieldAlert,
  Server,
  Plus,
  ArrowUpRight,
  Terminal,
  Zap,
  Play,
  RotateCw,
  AlertOctagon,
  ChevronLeft,
} from 'lucide-react';
import { useHub } from '../context/HubContext';
import { TEMPLATES } from '../data/initialData';
import { ServiceIcon } from './ServiceIcon';

interface OverviewDashboardProps {
  onOpenDeploy: () => void;
  onOpenAddAccount: () => void;
  onOpenBudgetGuard: () => void;
}

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({
  onOpenDeploy,
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
    totalCreditsUsed,
    allServices,
    healthyServicesCount,
    crashedServicesCount,
    stoppedServicesCount,
    logs,
    setActiveTab,
    resumeAccountServices,
    restartService,
  } = useHub();

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
    : accounts.reduce((acc, a) => acc + (a.isShutdownTriggered ? 0 : a.hourlyBurnRate), 0);

  const projectedDaysLeft = currentBurnRate > 0 ? (currentRemaining / (currentBurnRate * 24)).toFixed(0) : '∞';

  const displayedServices = activeAccount
    ? activeAccount.projects.filter((p) => !p.isDeletedOnRailway && p.isExternal).flatMap((p) => p.services)
    : allServices;

  const shutdownAccounts = accounts.filter((a) => a.isShutdownTriggered);

  return (
    <div className="space-y-5 pb-20 lg:pb-8 w-full max-w-full overflow-hidden">
      
      {/* 1. Auto-Shutdown Warning Banner (if any account triggered budget guard) */}
      {shutdownAccounts.length > 0 && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-3.5 sm:p-5 backdrop-blur-md shadow-lg max-w-full overflow-hidden">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/30">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-rose-200 text-xs sm:text-sm truncate">
                  محافظ بودجه فعال شد ({shutdownAccounts.length} اکانت متوقف شد)
                </h3>
                <p className="text-[11px] sm:text-xs text-rose-300/80 mt-0.5 leading-relaxed">
                  اعتبار حساب‌های{' '}
                  <span className="font-semibold text-white">
                    {shutdownAccounts.map((a) => a.name).join('، ')}
                  </span>{' '}
                  به کمتر از حد آستانه رسید و نودها متوقف شدند.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
              <button
                onClick={() => shutdownAccounts.forEach((a) => resumeAccountServices(a.id))}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3 py-1.5 sm:py-2 text-xs font-semibold text-white hover:bg-rose-500 transition shadow-sm"
              >
                <Play className="h-3.5 w-3.5" />
                راه‌اندازی نودها
              </button>
              <button
                onClick={onOpenBudgetGuard}
                className="flex-1 sm:flex-none rounded-xl border border-rose-400/30 px-3 py-1.5 sm:py-2 text-xs font-medium text-rose-200 hover:bg-rose-900/30 transition"
              >
                آستانه
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Account Switcher Ribbon */}
      <div className="max-w-full overflow-hidden">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-xs sm:text-sm font-bold text-neutral-300 flex items-center gap-1.5">
            <span>اکانت‌های متصل به هاب</span>
            <span className="text-[11px] text-neutral-500 font-normal">({accounts.length})</span>
          </h2>
          <button
            onClick={onOpenAddAccount}
            className="flex items-center gap-1 text-[11px] sm:text-xs text-purple-400 hover:text-purple-300 font-medium transition"
          >
            <Plus className="h-3.5 w-3.5" />
            افزودن اکانت
          </button>
        </div>

        <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {/* Individual Account Cards */}
          {accounts.map((acc) => {
            const isLow = acc.creditRemaining < acc.autoShutdownThreshold;
            const isSelected = activeAccountId === acc.id;
            return (
              <div
                key={acc.id}
                onClick={() => setActiveAccountId(acc.id)}
                className={`cursor-pointer rounded-2xl p-3.5 transition-all duration-200 border max-w-full overflow-hidden ${
                  isSelected
                    ? 'bg-neutral-900/95 border-neutral-600 ring-1 ring-white/20 shadow-lg'
                    : 'bg-neutral-900/40 border-neutral-800 hover:bg-neutral-900/70'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: acc.color }}
                    />
                    <span className="text-xs font-bold text-white truncate">{acc.name}</span>
                  </div>
                  {acc.isShutdownTriggered ? (
                    <span className="text-[9px] font-semibold text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded-full border border-rose-500/20 shrink-0">
                      متوقف
                    </span>
                  ) : (
                    <span className="text-[9px] text-neutral-400 bg-neutral-800 px-1.5 py-0.5 rounded-full shrink-0">
                      {acc.plan}
                    </span>
                  )}
                </div>

                <div className="mt-2.5 flex items-baseline justify-between">
                  <div>
                    <span
                      className={`text-lg sm:text-xl font-black font-mono ${
                        isLow ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      ${acc.creditRemaining.toFixed(2)}
                    </span>
                    <span className="text-[9px] text-neutral-400 mr-0.5">/ ${acc.creditLimit}</span>
                  </div>
                  <span className="text-[11px] text-neutral-400 font-mono">
                    {acc.projects.filter((p) => !p.isDeletedOnRailway && p.isExternal).reduce((s, p) => s + p.services.length, 0)} نود
                  </span>
                </div>

                {/* Balance Progress Bar */}
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      acc.isShutdownTriggered
                        ? 'bg-rose-500'
                        : isLow
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(5, (acc.creditRemaining / acc.creditLimit) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Top Metrics Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4 max-w-full overflow-hidden">
        
        {/* Metric 1: Credit Balance */}
        <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-3.5 sm:p-5 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs font-medium text-neutral-400">اعتبار باقی‌مانده</span>
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
        <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-3.5 sm:p-5 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs font-medium text-neutral-400">نودها و سرویس‌ها</span>
            <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 shrink-0">
              <Server className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          </div>
          <div className="mt-2.5">
            <div className="text-xl sm:text-2xl font-black text-white font-mono">
              {healthyServicesCount}
              <span className="text-xs font-normal text-neutral-500 mr-1">
                / {displayedServices.length}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] sm:text-xs flex-wrap">
              <span className="text-emerald-400">
                {healthyServicesCount} آنلاین
              </span>
              {crashedServicesCount > 0 && (
                <span className="text-rose-400">
                  {crashedServicesCount} خطا
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Metric 3: Hourly Burn Rate */}
        <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-3.5 sm:p-5 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs font-medium text-neutral-400">نرخ مصرف ساعتی</span>
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

      </div>

      {/* 4. Active Nodes Grid */}
      <div className="max-w-full overflow-hidden">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-purple-400 shrink-0" />
            <h2 className="text-xs sm:text-sm font-bold text-neutral-200">وضعیت نودها و سرویس‌های فعال</h2>
          </div>
          <button
            onClick={() => setActiveTab('nodes')}
            className="flex items-center gap-0.5 text-[11px] text-neutral-400 hover:text-white transition"
          >
            همه
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {displayedServices.map((srv) => {
            const isHealthy = srv.status === 'healthy';
            const isStopped = srv.status === 'stopped';
            const isCrashed = srv.status === 'crashed';
            const isDeploying = srv.status === 'deploying';

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
                      onClick={() => setActiveTab('logs')}
                      className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-[10px] text-purple-400 hover:bg-purple-500/10 transition font-medium"
                    >
                      <Terminal className="h-3 w-3" />
                      لاگ
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. Live Logs Preview & Quick Template Launch */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 max-w-full overflow-hidden">
        
        {/* Left 2 Cols: Live Logs Stream Snippet */}
        <div className="lg:col-span-2 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-3.5 backdrop-blur-md max-w-full overflow-hidden">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <Terminal className="h-4 w-4 text-emerald-400 shrink-0" />
              <h3 className="text-xs sm:text-sm font-bold text-white">لاگ‌های زنده نودها</h3>
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <button
              onClick={() => setActiveTab('logs')}
              className="text-[11px] text-purple-400 hover:text-purple-300 font-medium"
            >
              کنسول کامل
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

        {/* Right 1 Col: Quick Deploy Templates */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-3.5 backdrop-blur-md max-w-full overflow-hidden">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-amber-400 shrink-0" />
              <h3 className="text-xs sm:text-sm font-bold text-white">دپلوی سریع تمپلیت</h3>
            </div>
          </div>

          <div className="space-y-2">
            {TEMPLATES.slice(0, 3).map((tmpl) => (
              <div
                key={tmpl.id}
                onClick={onOpenDeploy}
                className="flex items-center justify-between p-2 rounded-xl border border-neutral-800/60 bg-neutral-950/40 hover:bg-neutral-800/50 hover:border-neutral-700 cursor-pointer transition"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base shrink-0">{tmpl.icon}</span>
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-white truncate">{tmpl.name}</h4>
                    <p className="text-[10px] text-neutral-400 truncate">{tmpl.description}</p>
                  </div>
                </div>
                <button className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-neutral-300 hover:text-white hover:bg-purple-600 transition">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
};
