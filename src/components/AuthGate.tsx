import React, { useEffect, useState } from 'react';
import { Lock, ShieldCheck, User } from 'lucide-react';
import { getAuthStatus, loginAuth, setupAuth } from '../services/authApi';

type AuthPhase = 'loading' | 'setup' | 'login' | 'ready';

const inputClass =
  'w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/50';

const buttonClass =
  'w-full rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50 transition';

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [phase, setPhase] = useState<AuthPhase>('loading');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await getAuthStatus();
        if (cancelled) return;
        if (status.setupRequired) setPhase('setup');
        else if (status.authenticated) setPhase('ready');
        else setPhase('login');
      } catch {
        if (!cancelled) setPhase('login');
      }
    })();

    const handleSessionExpired = () => {
      setPhase('login');
      setError('نشست کاربری شما منقضی شد. لطفاً دوباره وارد شوید.');
    };
    window.addEventListener('hub:session_expired', handleSessionExpired);

    return () => {
      cancelled = true;
      window.removeEventListener('hub:session_expired', handleSessionExpired);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (phase === 'setup') {
      if (username.trim().length < 3) {
        setError('نام کاربری باید حداقل ۳ کاراکتر باشد');
        return;
      }
      if (password.length < 6) {
        setError('رمز عبور باید حداقل ۶ کاراکتر باشد');
        return;
      }
      if (password !== confirmPassword) {
        setError('رمز عبور و تکرار آن یکسان نیستند');
        return;
      }
      setSubmitting(true);
      const result = await setupAuth(username.trim(), password);
      setSubmitting(false);
      if (result.success) {
        setPhase('ready');
      } else {
        setError(result.error || 'ساخت حساب ناموفق بود');
        if (result.error?.includes('already')) setPhase('login');
      }
      return;
    }

    if (!username.trim() || !password) {
      setError('نام کاربری و رمز عبور را وارد کنید');
      return;
    }
    setSubmitting(true);
    const result = await loginAuth(username.trim(), password);
    setSubmitting(false);
    if (result.success) {
      setPhase('ready');
    } else {
      setError(result.error || 'نام کاربری یا رمز عبور اشتباه است');
    }
  };

  if (phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
          <span className="text-sm text-neutral-400">در حال بررسی احراز هویت…</span>
        </div>
      </div>
    );
  }

  if (phase === 'ready') {
    return <>{children}</>;
  }

  const isSetup = phase === 'setup';

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-4 text-neutral-100 antialiased selection:bg-purple-500/30 selection:text-purple-200">
      <div className="w-[94vw] max-w-md rounded-3xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-violet-500 shadow-lg shadow-purple-500/25 ring-1 ring-purple-400/30">
            {isSetup ? <ShieldCheck className="h-7 w-7 text-white" /> : <Lock className="h-7 w-7 text-white" />}
          </div>
          <div>
            <h1 className="text-lg font-bold text-neutral-50">
              {isSetup ? 'ساخت حساب مدیریت' : 'ورود به Railway Hub'}
            </h1>
            <p className="mt-1 text-xs text-neutral-400">
              {isSetup
                ? 'تعیین نام کاربری و رمز عبور دائمی برای محافظت از اطلاعات'
                : 'برای دسترسی به پنل مدیریت نودها و پروژه‌ها وارد شوید'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" dir="rtl">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-neutral-300">نام کاربری</span>
            <div className="relative">
              <User className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={`${inputClass} pr-9`}
                placeholder="نام کاربری"
                autoComplete="username"
                autoFocus={!username}
              />
            </div>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-neutral-300">رمز عبور</span>
            <div className="relative">
              <Lock className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} pr-9`}
                placeholder="رمز عبور"
                autoComplete={isSetup ? 'new-password' : 'current-password'}
                autoFocus={!!username}
              />
            </div>
          </label>

          {isSetup && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-neutral-300">تکرار رمز عبور</span>
              <div className="relative">
                <Lock className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`${inputClass} pr-9`}
                  placeholder="تکرار رمز عبور"
                  autoComplete="new-password"
                />
              </div>
            </label>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
              {error}
            </div>
          )}

          <button type="submit" disabled={submitting} className={buttonClass}>
            {submitting ? 'در حال پردازش…' : isSetup ? 'ایجاد حساب و ورود' : 'ورود'}
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-5 text-neutral-500">
          دسترسی به این پنل توسط احراز هویت توکن رمزنگاری‌شده و کوکی امن محافظت می‌شود.
        </p>
      </div>
    </div>
  );
};
