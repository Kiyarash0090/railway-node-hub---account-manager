import React, { useState } from 'react';
import { HubProvider, useHub } from './context/HubContext';
import { AuthGate } from './components/AuthGate';
import { Header } from './components/Header';
import { MobileTabBar } from './components/MobileTabBar';
import { OverviewDashboard } from './components/OverviewDashboard';
import { AccountsManager } from './components/AccountsManager';
import { NodesView } from './components/NodesView';
import { LiveLogsViewer } from './components/LiveLogsViewer';
import { MetricsDashboard } from './components/MetricsDashboard';
import { DeployModal } from './components/DeployModal';
import { BudgetGuardModal } from './components/BudgetGuardModal';

const AppContent: React.FC = () => {
  const { activeTab, setActiveTab } = useHub();

  const [isDeployOpen, setIsDeployOpen] = useState(false);
  const [isBudgetGuardOpen, setIsBudgetGuardOpen] = useState(false);

  const handleOpenAddAccount = () => {
    setActiveTab('accounts');
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-neutral-950 text-neutral-100 antialiased selection:bg-purple-500/30 selection:text-purple-200">

      {/* Top Navbar */}
      <Header
        onOpenAddAccount={handleOpenAddAccount}
        onOpenBudgetGuard={() => setIsBudgetGuardOpen(true)}
      />

      {/* Main Content Area */}
      <main className="mx-auto w-full max-w-7xl px-2.5 py-4 sm:px-6 pb-28 lg:pb-8">
        {activeTab === 'dashboard' && (
          <OverviewDashboard
            onOpenDeploy={() => setIsDeployOpen(true)}
            onOpenAddAccount={handleOpenAddAccount}
            onOpenBudgetGuard={() => setIsBudgetGuardOpen(true)}
          />
        )}

        {activeTab === 'accounts' && (
          <AccountsManager
            onOpenDeploy={() => setIsDeployOpen(true)}
            onOpenBudgetGuard={() => setIsBudgetGuardOpen(true)}
          />
        )}

        {activeTab === 'nodes' && (
          <NodesView onOpenDeploy={() => setIsDeployOpen(true)} />
        )}

        {activeTab === 'logs' && <LiveLogsViewer />}

        {activeTab === 'metrics' && <MetricsDashboard />}
      </main>

      {/* Mobile Tab Bar */}
      <MobileTabBar />

      {/* Modals */}
      <DeployModal isOpen={isDeployOpen} onClose={() => setIsDeployOpen(false)} />
      <BudgetGuardModal isOpen={isBudgetGuardOpen} onClose={() => setIsBudgetGuardOpen(false)} />

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
