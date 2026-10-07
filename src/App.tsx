import React, { useState } from 'react';
import { HubProvider, useHub, useBackHandler } from './context/HubContext';
import { AuthGate } from './components/AuthGate';
import { Header } from './components/Header';
import { MobileTabBar } from './components/MobileTabBar';
import { OverviewDashboard } from './components/OverviewDashboard';
import { AccountsManager } from './components/AccountsManager';
import { NodesView } from './components/NodesView';
import { MetricsDashboard } from './components/MetricsDashboard';
import { DeployModal } from './components/DeployModal';
import { useMobileSwipe, MOBILE_NAV_TABS } from './hooks/useMobileSwipe';
import { CornerDownLeft } from 'lucide-react';

const AppContent: React.FC = () => {
  const { activeTab, setActiveTab, showExitToast } = useHub();

  const [isDeployOpen, setIsDeployOpen] = useState(false);

  // Mobile back button: closes DeployModal if open
  useBackHandler(isDeployOpen, () => setIsDeployOpen(false));

  // Touch gesture support: swipe left/right between tabs on mobile
  const { onTouchStart, onTouchEnd } = useMobileSwipe({
    tabs: MOBILE_NAV_TABS,
    activeTab,
    onTabChange: setActiveTab,
    disabled: isDeployOpen,
  });

  const handleOpenAddAccount = () => {
    setActiveTab('accounts');
  };

  return (
    <div
      className="min-h-screen w-full max-w-full overflow-x-hidden bg-neutral-950 text-neutral-100 antialiased selection:bg-purple-500/30 selection:text-purple-200 touch-pan-y"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >

      {/* Top Navbar */}
      <Header
        onOpenAddAccount={handleOpenAddAccount}
      />

      {/* Main Content Area with fluid swipe & fade transitions */}
      <main className="mx-auto w-full max-w-7xl px-2.5 py-4 sm:px-6 pb-28 lg:pb-8">
        <div key={activeTab} className="page-transition">
          {activeTab === 'dashboard' && (
            <OverviewDashboard
              onOpenAddAccount={handleOpenAddAccount}
            />
          )}

          {activeTab === 'accounts' && (
            <AccountsManager
              onOpenDeploy={() => setIsDeployOpen(true)}
            />
          )}

          {activeTab === 'nodes' && (
            <NodesView onOpenDeploy={() => setIsDeployOpen(true)} />
          )}

          {activeTab === 'metrics' && <MetricsDashboard />}
        </div>
      </main>

      {/* Exit confirmation toast for Android/Mobile PWA at root history */}
      {showExitToast && (
        <div className="fixed bottom-24 inset-x-0 mx-auto w-fit z-[9999] pointer-events-none toast-anim px-4">
          <div className="flex items-center gap-2 rounded-2xl bg-neutral-900/95 border border-white/10 px-4 py-2.5 shadow-2xl backdrop-blur-xl text-xs font-medium text-neutral-200 ring-1 ring-purple-500/30">
            <CornerDownLeft className="h-3.5 w-3.5 text-purple-400 rotate-180" />
            <span>برای خروج از برنامه، دوباره دکمه بازگشت را بزنید</span>
          </div>
        </div>
      )}

      {/* Mobile Tab Bar */}
      <MobileTabBar />

      {/* Modals */}
      <DeployModal isOpen={isDeployOpen} onClose={() => setIsDeployOpen(false)} />

    </div>
  );
};

export default function App() {
  return (
    <AuthGate>
      <HubProvider>
        <AppContent />
      </HubProvider>
    </AuthGate>
  );
}

