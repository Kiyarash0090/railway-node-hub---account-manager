import React, { useState } from 'react';
import { Download, Smartphone, X, Share } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className={`flex items-center gap-1.5 rounded-xl bg-purple-600/20 border border-purple-500/30 px-2.5 py-1.5 text-xs font-semibold text-purple-300 hover:bg-purple-600/30 hover:text-purple-200 transition shadow-sm ${className}`}
        title="نصب اپلیکیشن روی دستگاه"
      >
        <Download className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">نصب برنامه</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className={`flex items-center gap-1.5 rounded-xl bg-neutral-900 border border-neutral-800 px-2.5 py-1.5 text-xs font-medium text-neutral-300 hover:text-white hover:border-neutral-700 transition ${className}`}
          title="راهنمای نصب روی آیفون / آیپد"
        >
          <Smartphone className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">نصب روی iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" dir="rtl">
            <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl text-right">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-purple-400" />
                  نصب روی آیفون / آیپد
                </h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="rounded-lg p-1 text-neutral-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-2.5 text-xs text-neutral-300 leading-relaxed">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-500/20 text-[11px] font-bold text-purple-400">۱</span>
                  <span>دکمه اشتراک‌گذاری (<Share className="inline h-3.5 w-3.5 mx-1" /> Share) را در نوار سافاری بزنید.</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-500/20 text-[11px] font-bold text-purple-400">۲</span>
                  <span>گزینه <strong>Add to Home Screen</strong> را انتخاب کنید.</span>
                </div>
              </div>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-neutral-800 py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-700 transition"
              >
                متوجه شدم
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
