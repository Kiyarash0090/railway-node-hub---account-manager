import React, { useState } from 'react';
import { User, KeyRound, LogOut, ShieldCheck, X, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { changePassword, logoutAuth } from '../services/authApi';

interface AccountMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  username?: string;
}

export const AccountMenuModal: React.FC<AccountMenuModalProps> = ({
  isOpen,
  onClose,
  username = 'admin',
}) => {
  const [activeView, setActiveView] = useState<'menu' | 'change-password' | 'confirm-logout'>('menu');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!isOpen) return null;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!currentPassword) {
      setError('رمز عبور فعلی را وارد کنید');
      return;
    }
    if (newPassword.length < 6) {
      setError('رمز عبور جدید باید حداقل ۶ کاراکتر باشد');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('رمز عبور جدید و تکرار آن یکسان نیستند');
      return;
    }

    setSubmitting(true);
    const result = await changePassword(currentPassword, newPassword);
    setSubmitting(false);

    if (result.success) {
      setSuccess(result.message || 'رمز عبور با موفقیت تغییر یافت');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setActiveView('menu');
        setSuccess('');
      }, 1500);
    } else {
      setError(result.error || 'خطا در تغییر رمز عبور');
    }
  };

  const handleLogout = async () => {
    await logoutAuth();
    window.location.reload();
  };

  const resetForm = () => {
    setActiveView('menu');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md animate-in fade-in duration-200" dir="rtl">
      {/* Backdrop click to close */}
      <div className="fixed inset-0" onClick={resetForm} />

      <div className="relative w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-900/98 p-6 shadow-2xl backdrop-blur-2xl ring-1 ring-white/10 z-10" onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-500/20 ring-1 ring-purple-400/30">
              <User className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <span>حساب کاربری مدیر</span>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-500/30">
                  فعال
                </span>
              </h2>
              <p className="text-[11px] text-neutral-400 font-mono mt-0.5">@{username}</p>
            </div>
          </div>
          <button
            onClick={resetForm}
            className="rounded-xl p-2 text-neutral-400 hover:bg-neutral-800 hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Main View */}
        {activeView === 'menu' && (
          <div className="mt-4 space-y-3">
            {/* Account Details Info */}
            <div className="rounded-2xl border border-neutral-800/80 bg-neutral-950/60 p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-400">سطح دسترسی:</span>
                <span className="font-semibold text-purple-300">مدیر کل سیستم (Full Access)</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-400">نوع نشست:</span>
                <span className="flex items-center gap-1.5 font-medium text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>احراز هویت توکن رمزنگاری‌شده (HMAC)</span>
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-1">
              <button
                onClick={() => setActiveView('change-password')}
                className="flex w-full items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-semibold text-neutral-200 hover:border-purple-500/50 hover:bg-purple-500/10 hover:text-purple-300 transition group shadow-sm"
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/15 text-purple-400 group-hover:bg-purple-500/25 transition">
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <span>تغییر رمز عبور</span>
                </div>
                <span className="text-[11px] text-neutral-500 group-hover:text-purple-400 transition">ویرایش ←</span>
              </button>

              <button
                onClick={() => setActiveView('confirm-logout')}
                className="flex w-full items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-semibold text-neutral-200 hover:border-rose-500/50 hover:bg-rose-500/10 hover:text-rose-300 transition group shadow-sm"
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400 group-hover:bg-rose-500/25 transition">
                    <LogOut className="h-4 w-4" />
                  </div>
                  <span>خروج از حساب</span>
                </div>
                <span className="text-[11px] text-neutral-500 group-hover:text-rose-400 transition">پایان نشست ←</span>
              </button>
            </div>
          </div>
        )}

        {/* Change Password View */}
        {activeView === 'change-password' && (
          <form onSubmit={handleChangePassword} className="mt-4 space-y-3.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <KeyRound className="h-4 w-4 text-purple-400" />
                تغییر رمز عبور مدیریت
              </span>
              <button
                type="button"
                onClick={() => {
                  setActiveView('menu');
                  setError('');
                  setSuccess('');
                }}
                className="text-[11px] text-neutral-400 hover:text-neutral-200 transition"
              >
                بازگشت
              </button>
            </div>

            {/* Current Password */}
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-400">رمز عبور فعلی</span>
              <div className="relative">
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/40 pr-3 pl-9"
                  placeholder="رمز عبور فعلی خود را وارد کنید"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                >
                  {showCurrentPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </label>

            {/* New Password */}
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-400">رمز عبور جدید (حداقل ۶ کاراکتر)</span>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/40 pr-3 pl-9"
                  placeholder="رمز عبور جدید"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                >
                  {showNewPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </label>

            {/* Confirm New Password */}
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-400">تکرار رمز عبور جدید</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
                placeholder="تکرار رمز عبور جدید"
              />
            </label>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{success}</span>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-purple-600/30 hover:bg-purple-500 transition disabled:opacity-50"
              >
                {submitting ? 'در حال ثبت…' : 'بروزرسانی رمز عبور'}
              </button>
              <button
                type="button"
                onClick={() => setActiveView('menu')}
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-xs text-neutral-400 hover:text-white transition"
              >
                انصراف
              </button>
            </div>
          </form>
        )}

        {/* Confirm Logout View */}
        {activeView === 'confirm-logout' && (
          <div className="mt-4 space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30">
              <LogOut className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">آیا مایل به خروج از حساب هستید؟</h3>
              <p className="mt-1 text-xs text-neutral-400">
                نشست امن جاری شما خاتمه یافته و برای ورود مجدد نیاز به وارد کردن رمز عبور خواهید داشت.
              </p>
            </div>
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleLogout}
                className="flex-1 rounded-xl bg-rose-600 py-2.5 text-xs font-bold text-white shadow-lg shadow-rose-600/25 hover:bg-rose-500 transition"
              >
                تأیید و خروج
              </button>
              <button
                type="button"
                onClick={() => setActiveView('menu')}
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-xs text-neutral-300 hover:text-white transition"
              >
                انصراف
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
