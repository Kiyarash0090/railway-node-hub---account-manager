import React from 'react';
import { Layers, Activity, BarChart3, Wallet, LucideIcon } from 'lucide-react';
import { useHub } from '../context/HubContext';

interface TabItem {
  id: 'dashboard' | 'nodes' | 'metrics' | 'accounts';
  label: string;
  icon: LucideIcon;
  badge?: boolean;
}

export const MobileTabBar: React.FC = () => {
  const { activeTab, setActiveTab, accounts } = useHub();

  const tabs: TabItem[] = [
    { id: 'dashboard', label: 'داشبورد', icon: Layers },
    { id: 'nodes', label: 'نودها', icon: Activity },
    { id: 'metrics', label: 'منابع', icon: BarChart3 },
    { id: 'accounts', label: 'اکانت‌ها', icon: Wallet, badge: accounts.some((a) => a.creditRemaining < 0.2 && a.creditRemaining > 0) },
  ];

  return (
    <div data-no-swipe className="fixed bottom-3.5 left-3 right-3 sm:left-6 sm:right-6 sm:max-w-md sm:mx-auto z-50 lg:hidden">
      <div className="rounded-2xl sm:rounded-3xl border border-white/10 bg-neutral-900/60 p-1.5 shadow-[0_8px_32px_0_rgba(0,0,0,0.55)] backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-white/5">
        <div className="grid grid-cols-4 items-center gap-1 text-center">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex flex-col items-center justify-center py-1.5 px-1 rounded-xl sm:rounded-2xl transition-all duration-200 btn-press ${
                  isActive
                    ? 'bg-purple-500/20 text-purple-200 font-semibold shadow-sm ring-1 ring-purple-400/30'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
                }`}
              >
                <Icon className={`h-4 w-4 sm:h-5 sm:w-5 transition-transform duration-200 ${isActive ? 'scale-110 text-purple-300 drop-shadow-[0_0_8px_rgba(192,132,252,0.4)]' : 'group-hover:scale-105'}`} />
                <span className={`text-[10px] sm:text-[11px] mt-0.5 leading-tight tracking-tight transition-all duration-200 ${isActive ? 'font-bold text-white' : ''}`}>
                  {tab.label}
                </span>
                {tab.badge && (
                  <span className="absolute top-1 right-2 flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500 ring-2 ring-neutral-900" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
