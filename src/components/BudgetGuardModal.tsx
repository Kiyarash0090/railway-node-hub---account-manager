import React from 'react';
import {
  ShieldCheck,
  X,
  Play,
  Pause,
  Info,
} from 'lucide-react';
import { useHub } from '../context/HubContext';

interface BudgetGuardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BudgetGuardModal: React.FC<BudgetGuardModalProps> = ({ isOpen, onClose }) => {
  const {
    accounts,
    triggerBudgetShutdown,
    resumeAccountServices,
    updateBudgetGuardRule,
  } = useHub();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-md animate-in fade-in">
      <div className="w-[94vw] max-w-2xl rounded-3xl border border-neutral-800 bg-neutral-900 p-4 sm:p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30 shrink-0">
              <ShieldCheck className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black text-white">محافظ بودجه و خاموشی اضطراری</h2>
              <p className="text-[11px] text-neutral-400">
                جلوگیری از کسر هزینه اضافه و بستن خودکار نودها
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl border border-neutral-800 p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 transition shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          
          {/* Information Card */}
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs text-emerald-200/90 flex items-start gap-2.5">
            <Info className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-white block text-xs">مکانیسم کارکرد محافظ بودجه:</span>
              <p className="text-[11px] leading-relaxed text-neutral-300">
                سیستم به صورت پیوسته اعتبار باقی‌مانده هر اکانت را پایش می‌کند. با رسیدن شارژ به زیر حد آستانه، سرویس‌ها به طور خودکار متوقف می‌شوند تا هزینه‌ای ایجاد نشود.
              </p>
            </div>
          </div>

          {/* Accounts List & Threshold Controls */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold text-neutral-300">تنظیمات آستانه خاموشی</h3>

            {accounts.map((acc) => {
              const isTriggered = acc.isShutdownTriggered;
              return (
                <div
                  key={acc.id}
                  className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-3.5 space-y-2.5 max-w-full overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 truncate">
                      <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: acc.color }} />
                      <span className="font-bold text-white text-xs truncate">{acc.name}</span>
                    </div>

                    <div className="flex items-center gap-1 text-[11px] shrink-0">
                      <span className="text-neutral-400">اعتبار:</span>
                      <span className="font-mono font-bold text-white">${acc.creditRemaining.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-center pt-2 border-t border-neutral-800/60">
                    <div>
                      <div className="flex items-center justify-between text-[10px] text-neutral-400 mb-1">
                        <span>آستانه توقف:</span>
                        <span className="font-mono text-purple-400 font-bold">${acc.autoShutdownThreshold}</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="3.0"
                        step="0.1"
                        value={acc.autoShutdownThreshold}
                        onChange={(e) => updateBudgetGuardRule(acc.id, acc.autoShutdownEnabled, Number(e.target.value))}
                        className="w-full accent-purple-600 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2">
                      <label className="flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={acc.autoShutdownEnabled}
                          onChange={(e) => updateBudgetGuardRule(acc.id, e.target.checked, acc.autoShutdownThreshold)}
                          className="rounded accent-emerald-500 h-3.5 w-3.5 shrink-0"
                        />
                        <span>فعال</span>
                      </label>

                      {isTriggered ? (
                        <button
                          onClick={() => resumeAccountServices(acc.id)}
                          className="flex items-center gap-1 rounded-xl bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-500 transition"
                        >
                          <Play className="h-3 w-3" />
                          رفع توقف
                        </button>
                      ) : (
                        <button
                          onClick={() => triggerBudgetShutdown(acc.id, 'شبیه‌سازی دستی محافظت بودجه')}
                          className="flex items-center gap-1 rounded-xl border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300 hover:text-rose-400 hover:bg-rose-500/10 transition"
                        >
                          <Pause className="h-3 w-3" />
                          تست توقف
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end pt-3 border-t border-neutral-800">
            <button
              onClick={onClose}
              className="rounded-xl bg-purple-600 px-5 py-2 text-xs font-semibold text-white hover:bg-purple-500 transition"
            >
              تأیید و بازگشت
            </button>
          </div>

        </div>

      </div>
    </div>
  );
};
