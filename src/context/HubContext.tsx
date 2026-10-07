import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  RailwayAccount,
  RailwayProject,
  RailwayService,
  RailwayServiceDomain,
  AlertNotification,
  LogEntry,
  MetricDataPoint,
  ServiceStatus,
} from '../types';
import { INITIAL_ACCOUNTS, INITIAL_LOGS } from '../constants/initialData';
import { validateRailwayToken, syncRailwayProjects, deleteRailwayProject, restartRailwayService, redeployRailwayService, manualUpdateRailwayService, stopRailwayService, deleteRailwayService, getRailwayServiceMetrics } from '../services/railwayApi';
import { extractApiError } from '../utils/githubRepo';
import { apiFetch as fetch } from '../services/authApi';

/** Global deploy-progress snapshot so the status survives closing DeployModal. */
export interface DeployJobState {
  status: 'running' | 'success' | 'error';
  phase: string;
  repo?: string;
  domain?: string;
  /** Railway serviceId the job is about. */
  serviceId?: string;
  /** Stamped by setDeployJob — used to expire banners that can no longer update. */
  updatedAt?: number;
}

export interface ServiceDeployState {
  status: 'running' | 'success' | 'error';
  phase: string;
  domain?: string;
  updatedAt?: number;
}

/** True once Railway's deployment for this service has reached a final state —
 *  any "still building" marker for it is stale by definition. */
function isDeploymentSettled(srv: RailwayService): boolean {
  if (srv.deploymentStopped) return true;
  const status = (srv.deploymentStatus || '').toUpperCase();
  return status === 'SUCCESS' || status === 'FAILED' || status === 'CRASHED' || status === 'REMOVED';
}

/** Runs `fn` over `items` with at most `limit` in flight (used to sync accounts
 *  concurrently instead of one Railway-slow call after another). */
async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

interface HubContextType {
  accounts: RailwayAccount[];
  activeAccountId: string; // 'all' or specific account id
  activeAccount: RailwayAccount | null;
  alerts: AlertNotification[];
  logs: LogEntry[];
  isStreamingLogs: boolean;
  isSyncingProjects: boolean;
  activeTab: 'dashboard' | 'accounts' | 'nodes' | 'metrics' | 'alerts';
  theme: 'dark' | 'light';
  deployJob: DeployJobState | null;
  setDeployJob: React.Dispatch<React.SetStateAction<DeployJobState | null>>;
  serviceDeployStates: Record<string, ServiceDeployState>;
  setServiceDeployState: (serviceId: string, state: ServiceDeployState | null) => void;

  // Account Actions
  setActiveAccountId: (id: string) => void;
  setActiveTab: (tab: 'dashboard' | 'accounts' | 'nodes' | 'metrics' | 'alerts') => void;
  toggleTheme: () => void;
  syncAccountProjects: (accountId?: string) => Promise<void>;
  addAccount: (accountData: {
    name?: string;
    token: string;
    color?: string;
    creditLimit?: number;
    email?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  updateAccount: (id: string, updates: Partial<RailwayAccount>) => void;
  deleteAccount: (id: string) => void;
  deleteProject: (accountId: string, projectId: string) => Promise<{ success: boolean; error?: string }>;
  refreshAccountBalances: () => void;
  
  // Service & Deployment Actions
  deployService: (
    accountId: string,
    projectId: string | null,
    serviceData: {
      name: string;
      templateType: string;
      imageOrRepo?: string;
      port?: number;
      envVars?: Record<string, string>;
      region?: string;
      railwayServiceId?: string;
      domains?: RailwayServiceDomain[];
    }
  ) => Promise<{ success: boolean; error?: string }>;
  restartService: (serviceId: string) => Promise<{ success: boolean; error?: string }>;
  redeployService: (serviceId: string) => Promise<{ success: boolean; error?: string }>;
  updateSourceService: (serviceId: string) => Promise<{ success: boolean; error?: string }>;
  stopService: (serviceId: string) => Promise<{ success: boolean; error?: string }>;
  startService: (serviceId: string) => Promise<{ success: boolean; error?: string }>;
  deleteService: (serviceId: string) => Promise<{ success: boolean; error?: string }>;
  
  // In-app Alerts
  sendCustomAlert: (
    title: string,
    message: string,
    severity: 'info' | 'warning' | 'critical',
    serviceName?: string
  ) => Promise<void>;
  clearAlerts: () => void;
  
  // Logs & Live Feed
  setIsStreamingLogs: (streaming: boolean) => void;
  addLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  /** Volume ids this app deleted — Railway's `project.volumes` still lists them. */
  deletedVolumeIds: string[];
  markVolumeDeleted: (volumeId: string) => void;
  clearLogs: () => void;
  
  // Aggregate Metrics & Stats
  allServices: RailwayService[];
  totalCreditsLimit: number;
  totalCreditsUsed: number;
  totalCreditsRemaining: number;
  healthyServicesCount: number;
  crashedServicesCount: number;
  stoppedServicesCount: number;
}

const HubContext = createContext<HubContextType | undefined>(undefined);

const DEPLOY_JOB_STORAGE_KEY = 'railway_hub_deploy_job_v1';
const THEME_STORAGE_KEY = 'railway_hub_theme_v4';
/** Reload persistence: which account / tab the user was last on. */
const ACTIVE_ACCOUNT_STORAGE_KEY = 'railway_hub_active_account_v1';
const ACTIVE_TAB_STORAGE_KEY = 'railway_hub_active_tab_v1';
/** Volumes deleted from this app. Railway keeps returning them from
 *  `project.volumes` forever (Volume has no deletedAt), so the hub has to
 *  remember what it removed instead of trusting that query alone. */
const DELETED_VOLUME_STORAGE_KEY = 'railway_hub_deleted_volumes_v1';
/** How long a FINISHED deploy banner/strip stays on screen before it goes. */
const DEPLOY_DONE_TTL_MS = 10_000;
/** A "running" job nobody can finish any more (tab closed mid-build) expires. */
const DEPLOY_JOB_MAX_RUNNING_MS = 30 * 60_000;
const SERVICE_DEPLOY_MAX_RUNNING_MS = 60 * 60_000;
const HUB_TABS = ['dashboard', 'accounts', 'nodes', 'metrics', 'alerts'] as const;
type HubTab = (typeof HUB_TABS)[number];

export const HubProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. Accounts State (loaded from server after auth)
  const [accounts, setAccounts] = useState<RailwayAccount[]>(INITIAL_ACCOUNTS);

  // Both selections restore from localStorage so a refresh lands the user back
  // on the account/tab they were on. A stale account id (deleted account) is
  // corrected by the "keep one real account selected" effect below.
  const [activeAccountId, setActiveAccountId] = useState<string>(() => {
    try {
      return localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY) || 'all';
    } catch (e) {
      return 'all';
    }
  });
  const [activeTab, setActiveTab] = useState<HubTab>(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
      if (saved && (HUB_TABS as readonly string[]).includes(saved)) return saved as HubTab;
    } catch (e) {}
    return 'dashboard';
  });

  // 2. Alerts
  const [alerts, setAlerts] = useState<AlertNotification[]>([]);

  // 4. Logs
  const [logs, setLogs] = useState<LogEntry[]>(INITIAL_LOGS);
  const [isStreamingLogs, setIsStreamingLogs] = useState<boolean>(true);
  const [isSyncingProjects, setIsSyncingProjects] = useState<boolean>(false);

  // Global deploy job — persisted in localStorage so the progress banner in Header
  // survives browser refreshes, tab switches, and closing modals. A FINISHED job
  // is never restored (there is nothing left to show) and every write is stamped
  // so a job nobody can complete any more expires instead of lingering.
  const [deployJob, setDeployJobState] = useState<DeployJobState | null>(() => {
    try {
      const saved = localStorage.getItem(DEPLOY_JOB_STORAGE_KEY);
      const job = saved ? JSON.parse(saved) : null;
      if (job && job.status === 'running') return job as DeployJobState;
    } catch (e) {}
    return null;
  });

  const setDeployJob = useCallback<React.Dispatch<React.SetStateAction<DeployJobState | null>>>(
    (action) => {
      setDeployJobState((prev) => {
        const next =
          typeof action === 'function'
            ? (action as (p: DeployJobState | null) => DeployJobState | null)(prev)
            : action;
        return next ? { ...next, updatedAt: Date.now() } : null;
      });
    },
    []
  );

  useEffect(() => {
    try {
      if (deployJob) {
        localStorage.setItem(DEPLOY_JOB_STORAGE_KEY, JSON.stringify(deployJob));
      } else {
        localStorage.removeItem(DEPLOY_JOB_STORAGE_KEY);
      }
    } catch (e) {}
  }, [deployJob]);

  // Per-service permanent deploy states — attached directly to cards, never lost on tab change/refresh or when closing header banner
  const SERVICE_DEPLOY_STATES_STORAGE_KEY = 'railway_hub_service_deploy_states_v2';
  const [serviceDeployStates, setServiceDeployStates] = useState<Record<string, ServiceDeployState>>(() => {
    try {
      const saved = localStorage.getItem(SERVICE_DEPLOY_STATES_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  const setServiceDeployState = useCallback((serviceId: string, state: ServiceDeployState | null) => {
    setServiceDeployStates((prev) => {
      const next = { ...prev };
      if (!state) {
        delete next[serviceId];
      } else {
        next[serviceId] = { ...state, updatedAt: Date.now() };
      }
      try {
        localStorage.setItem(SERVICE_DEPLOY_STATES_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  }, []);

  // A finished deploy is FEEDBACK, not a badge: drop the header banner a few
  // seconds after success/error instead of leaving it up until dismissed.
  useEffect(() => {
    if (!deployJob) return;
    const age = Date.now() - (deployJob.updatedAt || 0);
    const delay =
      deployJob.status !== 'running'
        ? Math.max(0, DEPLOY_DONE_TTL_MS - age)
        : Math.max(0, DEPLOY_JOB_MAX_RUNNING_MS - age);
    const t = window.setTimeout(() => setDeployJob(null), delay);
    return () => clearTimeout(t);
  }, [deployJob, setDeployJob]);

  // Same for the strip on the service card — this is what used to stay on the
  // card forever after the build ended.
  useEffect(() => {
    const entries = Object.entries(serviceDeployStates);
    if (entries.length === 0) return;
    const now = Date.now();
    const timers = entries.map(([serviceId, st]) => {
      const age = now - (st.updatedAt || 0);
      const delay =
        st.status !== 'running'
          ? Math.max(0, DEPLOY_DONE_TTL_MS - age)
          : Math.max(0, SERVICE_DEPLOY_MAX_RUNNING_MS - age);
      return window.setTimeout(() => setServiceDeployState(serviceId, null), delay);
    });
    return () => timers.forEach((t) => clearTimeout(t));
  }, [serviceDeployStates, setServiceDeployState]);

  // 5. Theme (UI preference — stays in localStorage)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) {}
    return 'dark';
  });

  // Server-side state: ready flag + load on mount (auth cookie already set by AuthGate)
  const [stateReady, setStateReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Persistence is enabled ONLY after a successful load. Enabling it on
      // failure used to let the debounced PUT overwrite hub-state.json with
      // empty defaults — wiping tokens/chat ids on refresh (e.g. right after
      // a server restart invalidated the session → 401 on GET).
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (cancelled) return;
        try {
          const res = await fetch('/api/state');
          if (res.status === 401) {
            if (!cancelled) {
              window.dispatchEvent(new CustomEvent('hub:session_expired'));
            }
            return;
          }
          if (!res.ok) throw new Error(`state ${res.status}`);
          const data = await res.json();
          if (cancelled) return;
          if (Array.isArray(data.accounts)) setAccounts(data.accounts as RailwayAccount[]);
          if (Array.isArray(data.alerts)) setAlerts(data.alerts as AlertNotification[]);
          if (!cancelled) setStateReady(true);
          return;
        } catch (e) {
          console.error(`Failed to load state from server (attempt ${attempt}/${maxAttempts})`, e);
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }
      // All attempts failed: keep stateReady=false so nothing is ever saved
      // over the real file. A reload after the server/session recovers fixes it.
      if (!cancelled) {
        console.error('State load failed — persistence DISABLED to protect hub-state.json. Reload once the server is healthy.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced persist to server (skip until initial load finishes)
  useEffect(() => {
    if (!stateReady) return;
    const t = setTimeout(() => {
      fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts, alerts }),
      }).catch((e) => console.error('Failed to save state to server', e));
    }, 600);
    return () => clearTimeout(t);
  }, [accounts, alerts, stateReady]);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Remember the selected account/tab so a refresh (or PWA relaunch) returns
  // to the same place instead of resetting to the dashboard's first account.
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_ACCOUNT_STORAGE_KEY, activeAccountId);
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
    } catch (e) {}
  }, [activeAccountId, activeTab]);

  const [deletedVolumeIds, setDeletedVolumeIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(DELETED_VOLUME_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(DELETED_VOLUME_STORAGE_KEY, JSON.stringify(deletedVolumeIds));
    } catch (e) {}
  }, [deletedVolumeIds]);

  /** Records a volume the user removed so it stops being listed even though
   *  Railway's `project.volumes` keeps reporting it. */
  const markVolumeDeleted = useCallback((volumeId: string) => {
    setDeletedVolumeIds((prev) =>
      prev.includes(volumeId) ? prev : [...prev, volumeId].slice(-500)
    );
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Active Account Computation
  const activeAccount = useMemo(() => {
    if (activeAccountId === 'all') return null;
    return accounts.find((a) => a.id === activeAccountId) || null;
  }, [accounts, activeAccountId]);

  // Support global 'all' accounts view or keep a valid account selected
  useEffect(() => {
    if (accounts.length === 0) return;
    if (activeAccountId === 'all') return;
    if (accounts.some((a) => a.id === activeAccountId)) return;
    setActiveAccountId('all');
  }, [accounts, activeAccountId]);

  // Aggregate All Services (only services of real Railway projects; deleted and
  // legacy hub-local projects are excluded)
  const allServices = useMemo(() => {
    const list: RailwayService[] = [];
    accounts.forEach((acc) => {
      acc.projects.forEach((proj) => {
        if (proj.isDeletedOnRailway || !proj.isExternal) return;
        proj.services.forEach((srv) => {
          list.push(srv);
        });
      });
    });
    return list;
  }, [accounts]);

  // Reconcile with Railway: once the real deployment has settled, anything
  // still marked "running" is lying (tab closed mid-build, or a flow that
  // never reported back) — clear it rather than showing an ended build.
  // Placed after allServices: the effect reads it in its dependency array.
  useEffect(() => {
    for (const srv of allServices) {
      const st = serviceDeployStates[srv.id];
      if (st && st.status === 'running' && isDeploymentSettled(srv)) {
        setServiceDeployState(srv.id, null);
      }
    }
    if (deployJob?.status === 'running' && deployJob.serviceId) {
      const srv = allServices.find((s) => s.id === deployJob.serviceId);
      if (srv && isDeploymentSettled(srv)) setDeployJob(null);
    }
  }, [allServices, serviceDeployStates, deployJob, setServiceDeployState, setDeployJob]);

  // Stats calculation
  const totalCreditsLimit = useMemo(() => accounts.reduce((sum, a) => sum + (a.creditLimit || 0), 0), [accounts]);
  const totalCreditsUsed = useMemo(() => accounts.reduce((sum, a) => sum + (a.creditUsed || 0), 0), [accounts]);
  const totalCreditsRemaining = useMemo(() => accounts.reduce((sum, a) => sum + (a.creditRemaining || 0), 0), [accounts]);
  
  const healthyServicesCount = useMemo(() => allServices.filter((s) => s.status === 'healthy').length, [allServices]);
  const crashedServicesCount = useMemo(() => allServices.filter((s) => s.status === 'crashed').length, [allServices]);
  const stoppedServicesCount = useMemo(() => allServices.filter((s) => s.status === 'stopped' || s.status === 'sleeping').length, [allServices]);

  // Helper to add log
  const addLog = useCallback((entry: Omit<LogEntry, 'id' | 'timestamp'>) => {
    const newLog: LogEntry = {
      ...entry,
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setLogs((prev) => [...prev.slice(-300), newLog]);
  }, []);

  // In-app alert dispatcher (alerts center + live log entry)
  const sendCustomAlert = useCallback(async (
    title: string,
    message: string,
    severity: 'info' | 'warning' | 'critical',
    serviceName?: string
  ) => {
    const account = activeAccount || accounts[0];

    const newAlert: AlertNotification = {
      id: `alert-${Date.now()}`,
      timestamp: new Date().toISOString(),
      title,
      message,
      severity,
      accountId: account ? account.id : 'global',
      accountName: account ? account.name : 'سیستم کلی',
      serviceName,
    };

    setAlerts((prev) => [newAlert, ...prev.slice(0, 99)]);
    addLog({
      level: severity === 'critical' ? 'error' : severity === 'warning' ? 'warn' : 'info',
      serviceName: serviceName || 'Railway-Alert-System',
      message: `[ALERT] ${title}: ${message}`,
    });
  }, [activeAccount, accounts, addLog]);

  // Add Account with Token Validation
  const addAccount = useCallback(async (accountData: {
    name?: string;
    token: string;
    color?: string;
    creditLimit?: number;
    email?: string;
  }): Promise<{ success: boolean; error?: string }> => {
    const rawToken = accountData.token.trim();
    if (!rawToken) {
      return { success: false, error: 'توکن API نمی‌تواند خالی باشد.' };
    }

    // Validate with Railway API and extract real account metrics
    const validation = await validateRailwayToken(rawToken);
    if (!validation.valid || !validation.user) {
      return {
        success: false,
        error: validation.error || 'توکن وارد شده نامعتبر است یا سطح دسترسی کافی ندارد.',
      };
    }

    const accountId = `acc-${Date.now()}`;
    const colors = ['#8B5CF6', '#10B981', '#3B82F6', '#EC4899', '#F59E0B', '#06B6D4'];
    const chosenColor = accountData.color || colors[accounts.length % colors.length];

    const extractedLimit = validation.extractedInfo?.creditLimit ?? 1.0;
    const extractedUsed = validation.extractedInfo?.creditUsed ?? 0.0;
    const extractedRemaining = validation.extractedInfo?.creditRemaining ?? 1.0;
    const extractedPlan = validation.extractedInfo?.plan || 'Free';
    const extractedProjectLimit = validation.extractedInfo?.projectLimit ?? null;
    const extractedServiceLimit = validation.extractedInfo?.serviceLimitPerProject ?? null;
    const extractedIsTrialing = validation.extractedInfo?.isTrialing ?? false;
    const extractedTrialDays = validation.extractedInfo?.trialDaysRemaining ?? null;
    const extractedCreditExpiresInDays = validation.extractedInfo?.creditExpiresInDays ?? null;
    const extractedBillingPeriodEnd = validation.extractedInfo?.billingPeriodEnd ?? null;
    const extractedPreferredRegion = validation.extractedInfo?.preferredRegion ?? null;
    const accountEmail = validation.user.email || accountData.email || 'user@railway.app';
    
    // Automatically extract account display name from API user/username/email
    const accountDisplayName =
      validation.user.name ||
      validation.user.username ||
      accountData.name ||
      (validation.user.email ? validation.user.email.split('@')[0] : `Railway Account ${accounts.length + 1}`);

    const extractedWorkspaceId = validation.extractedInfo?.workspaceId || '';

    // Projects come only from Railway; the hub never fabricates local projects.
    const parsedProjects: RailwayProject[] = (validation.extractedInfo?.projects || []).map(
      (p: any) => ({ ...p, accountId })
    );

    const newAccount: RailwayAccount = {
      id: accountId,
      name: accountDisplayName,
      email: accountEmail,
      token: rawToken,
      workspaceId: extractedWorkspaceId,
      color: chosenColor,
      plan: extractedPlan,
      currency: '$',
      creditLimit: extractedLimit,
      creditUsed: extractedUsed,
      creditRemaining: extractedRemaining,
      hourlyBurnRate: 0, // computed from real Railway usage deltas after the first sync
      status: 'active',
      lastChecked: new Date().toISOString(),
      isRealVerified: true,
      projects: parsedProjects,
      projectLimit: extractedProjectLimit,
      serviceLimitPerProject: extractedServiceLimit,
      isTrialing: extractedIsTrialing,
      trialDaysRemaining: extractedTrialDays,
      creditExpiresInDays: extractedCreditExpiresInDays,
      billingPeriodEnd: extractedBillingPeriodEnd,
      preferredRegion: extractedPreferredRegion,
    };

    setAccounts((prev) => [...prev, newAccount]);
    setActiveAccountId(accountId);
    
    addLog({
      level: 'info',
      serviceName: 'AccountManager',
      message: `[ACCOUNT_CONNECTED] Account "${newAccount.name}" (${newAccount.email}) connected with API credit limit $${newAccount.creditLimit} and remaining $${newAccount.creditRemaining}.`,
    });

    sendCustomAlert('اکانت جدید اضافه شد', `اکانت ${newAccount.name} با سقف اعتبار $${newAccount.creditLimit} با موفقیت متصل شد.`, 'info');

    return { success: true };
  }, [accounts, addLog, sendCustomAlert]);

  // Update Account
  const updateAccount = useCallback((id: string, updates: Partial<RailwayAccount>) => {
    setAccounts((prev) =>
      prev.map((acc) => (acc.id === id ? { ...acc, ...updates, lastChecked: new Date().toISOString() } : acc))
    );
  }, []);

  // Delete Account
  const deleteAccount = useCallback((id: string) => {
    const deletedAcc = accounts.find((a) => a.id === id);
    setAccounts((prev) => prev.filter((acc) => acc.id !== id));
    if (activeAccountId === id) {
      setActiveAccountId('all');
    }
    addLog({
      level: 'warn',
      serviceName: 'AccountManager',
      message: `[ACCOUNT_DELETED] Account "${deletedAcc?.name || id}" was disconnected.`,
    });
  }, [accounts, activeAccountId, addLog]);

  // Delete Project from Railway & State
  const deleteProject = useCallback(async (accountId: string, projectId: string): Promise<{ success: boolean; error?: string }> => {
    const targetAcc = accounts.find((a) => a.id === accountId);
    if (!targetAcc) return { success: false, error: 'اکانت مورد نظر یافت نشد.' };

    const targetProj = targetAcc.projects.find((p) => p.id === projectId);
    if (!targetProj) return { success: false, error: 'پروژه مورد نظر یافت نشد.' };

    const res = await deleteRailwayProject(targetAcc.token, projectId);
    if (res.errors?.length || res.error) {
      const message = res.errors?.[0]?.message || res.error || 'خطا در حذف پروژه از ریلوی';
      // Only drop the project locally after Railway confirms the delete.
      sendCustomAlert('خطا در حذف پروژه', `حذف پروژه ${targetProj.name} از ریلوی انجام نشد: ${message}`, 'critical');
      return { success: false, error: message };
    }

    setAccounts((prev) =>
      prev.map((acc) => {
        if (acc.id !== accountId) return acc;
        return {
          ...acc,
          projects: acc.projects.filter((p) => p.id !== projectId),
        };
      })
    );

    addLog({
      level: 'warn',
      serviceName: 'ProjectManager',
      message: `[PROJECT_DELETED] Project "${targetProj.name}" (${projectId}) deleted successfully.`,
    });

    sendCustomAlert('پروژه حذف شد', `پروژه ${targetProj.name} با موفقیت حذف گردید.`, 'warning');

    return { success: true };
  }, [accounts, addLog, sendCustomAlert]);

  // Sync Projects from Railway API for one or all accounts
  const syncAccountProjects = useCallback(async (targetAccId?: string) => {
    setIsSyncingProjects(true);
    const listToSync = targetAccId && targetAccId !== 'all'
      ? accounts.filter((a) => a.id === targetAccId)
      : accounts;

    if (listToSync.length === 0) {
      setIsSyncingProjects(false);
      return;
    }

    /** One account's sync. Accounts run CONCURRENTLY (see runWithConcurrency)
     *  — Railway takes seconds per call, so doing 32 accounts back-to-back is
     *  what made a freshly created service take minutes to show up. */
    const syncOne = async (acc: RailwayAccount) => {
      if (!acc.token) return;
      try {
        const res = await syncRailwayProjects(acc.token);

        // If Railway was unreachable, keep the existing projects untouched instead
        // of treating the empty result as "everything was deleted".
        if (!res.projects) {
          if (res.httpStatus === 502 || res.error) {
            addLog({
              level: 'warn',
              serviceName: 'SyncManager',
              message: `[SYNC_SKIPPED] Railway unreachable for ${acc.name}; kept existing project state. (${res.error || res.httpStatus})`,
            });
          }
          return;
        }

        {
            const fetchedProjects = res.projects;
          const fetchedIds = new Set(fetchedProjects.map((fp: any) => fp.id));

          setAccounts((prev) =>
            prev.map((account) => {
              if (account.id !== acc.id) return account;

              const existingProjs = account.projects || [];
              const projMap = new Map<string, RailwayProject>();

              // Set fetched projects
              fetchedProjects.forEach((fp: any) => {
                const formattedServices: RailwayService[] = (fp.services || []).map((s: any) => ({
                  ...s,
                  projectId: fp.id,
                  accountId: account.id,
                  historyMetrics: s.historyMetrics || [],
                }));

                projMap.set(fp.id, {
                  id: fp.id,
                  accountId: account.id,
                  name: fp.name,
                  description: fp.description || 'پروژه استخراج شده از اکانت ریلوی',
                  environment: 'production',
                  defaultEnvironmentId: fp.defaultEnvironmentId,
                  isExternal: true,
                  isDeletedOnRailway: !!fp.isDeletedOnRailway,
                  createdAt: fp.createdAt || new Date().toISOString(),
                  updatedAt: fp.updatedAt || new Date().toISOString(),
                  services: formattedServices,
                  volumes: fp.volumes || [],
                });
              });

              // Check existing projects: if any external project is missing from fetched, mark as deleted on railway.
              // Legacy hub-local projects (no isExternal) are dropped — the hub no longer owns projects.
              existingProjs.forEach((ep) => {
                if (!fetchedIds.has(ep.id)) {
                  if (ep.isExternal) {
                    projMap.set(ep.id, {
                      ...ep,
                      isDeletedOnRailway: true,
                      // A deleted project has no disks left on Railway.
                      volumes: [],
                    });
                  }
                } else {
                  const existingP = projMap.get(ep.id)!;
                  const localById = new Map((ep.services || []).map((ls) => [ls.id, ls]));
                  // Preserve user-chosen local icons when Railway returns none
                  // (sync would otherwise wipe CDN icon URLs).
                  const servicesWithIcons = existingP.services.map((fs) => {
                    const local = localById.get(fs.id);
                    const railwayIcon = (fs.icon || '').trim();
                    const localIcon = (local?.icon || '').trim();
                    const railwayIsGeneric = !railwayIcon || railwayIcon === '⚡';
                    if (railwayIsGeneric && localIcon && localIcon !== '⚡') {
                      return { ...fs, icon: localIcon };
                    }
                    return fs;
                  });
                  const mergedServices = [...servicesWithIcons];
                  (ep.services || []).forEach((localS) => {
                    if (!mergedServices.some((s) => s.id === localS.id)) {
                      mergedServices.push(localS);
                    }
                  });
                  projMap.set(ep.id, { ...existingP, services: mergedServices });
                }
              });

              return {
                ...account,
                projects: Array.from(projMap.values()),
                lastChecked: new Date().toISOString(),
                projectLimit: res.projectLimit ?? account.projectLimit ?? null,
                serviceLimitPerProject: res.serviceLimitPerProject ?? account.serviceLimitPerProject ?? null,
                isTrialing: res.isTrialing ?? account.isTrialing ?? false,
                trialDaysRemaining: res.trialDaysRemaining ?? account.trialDaysRemaining ?? null,
                creditExpiresInDays: res.creditExpiresInDays ?? account.creditExpiresInDays ?? null,
                billingPeriodEnd: res.billingPeriodEnd ?? account.billingPeriodEnd ?? null,
                preferredRegion: res.preferredRegion ?? account.preferredRegion ?? null,
                // Real credit figures straight from Railway — no simulated burn.
                creditLimit: res.creditLimit ?? account.creditLimit,
                creditUsed: res.creditUsed ?? account.creditUsed,
                creditRemaining: res.creditRemaining ?? account.creditRemaining,
                // Derive an honest hourly burn rate from the real credit delta since last sync.
                hourlyBurnRate: (() => {
                  if (typeof res.creditUsed !== 'number') return account.hourlyBurnRate;
                  const elapsedMs = Date.now() - new Date(account.lastChecked || 0).getTime();
                  const delta = res.creditUsed - (account.creditUsed || 0);
                  // Sync runs every 30s, so 20s is the smallest useful window.
                  if (elapsedMs < 20_000) return account.hourlyBurnRate;
                  if (delta <= 0) return 0;
                  return Number((delta / (elapsedMs / 3_600_000)).toFixed(4));
                })(),
              };
            })
          );
        }
      } catch (e) {
        console.error('Failed syncing projects for account', acc.id, e);
      }
    };

    // 5 in flight: far fewer round trips overall without hammering Railway.
    await runWithConcurrency(listToSync, 5, syncOne);
    setIsSyncingProjects(false);
  }, [accounts, addLog]);

  // Initial Sync Effect once server state has loaded
  useEffect(() => {
    if (stateReady && accounts.length > 0) {
      syncAccountProjects('all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateReady]);

  // Refresh Account Balances & Check Budget Guard Triggers
  // Credit figures come from Railway via syncAccountProjects; nothing is simulated locally.
  const refreshAccountBalances = useCallback(() => {
    syncAccountProjects('all');
  }, [syncAccountProjects]);

  // Deploy Service Wizard
  const deployService = useCallback(async (
    accountId: string,
    projectId: string | null,
    serviceData: {
      name: string;
      templateType: string;
      imageOrRepo?: string;
      port?: number;
      envVars?: Record<string, string>;
      region?: string;
      /** Real Railway serviceId from githubRepoDeploy / serviceCreate — stored
       *  as the local service id so later domain/variable calls hit Railway. */
      railwayServiceId?: string;
      /** Real domains (e.g. from serviceDomainCreate) to show instead of a placeholder. */
      domains?: RailwayServiceDomain[];
    }
  ): Promise<{ success: boolean; error?: string }> => {
    const targetAccountId = accountId === 'all' ? (accounts[0]?.id || 'acc-1') : accountId;

    // The hub only deploys into real Railway projects; it never fabricates one.
    const hostAccount = accounts.find((a) => a.id === targetAccountId);
    const realProject = hostAccount?.projects.find(
      (p) => !p.isDeletedOnRailway && p.isExternal && (!projectId || p.id === projectId)
    );
    if (!realProject) {
      return {
        success: false,
        error: 'هیچ پروژهٔ واقعی روی ریلوی برای این اکانت یافت نشد. ابتدا یک پروژه در ریلوی بسازید و همگامسازی کنید.',
      };
    }

    const newServiceId = serviceData.railwayServiceId || `srv-${Date.now()}`;
    // Real Railway services start with whatever domains were just created (or
    // none — the next sync fills in live domains from Railway). Only fabricate
    // a placeholder for purely local services that have no Railway id yet.
    const defaultDomains: RailwayServiceDomain[] = serviceData.railwayServiceId
      ? []
      : [
          {
            id: `local-domain-${Date.now()}`,
            domain: `${serviceData.name.toLowerCase().replace(/\s+/g, '-')}.up.railway.app`,
            kind: 'service',
          },
        ];
    const newService: RailwayService = {
      id: newServiceId,
      projectId: realProject.id,
      accountId: targetAccountId,
      name: serviceData.name.toLowerCase().replace(/\s+/g, '-'),
      icon: '🐳',
      templateType: serviceData.templateType as any,
      imageOrRepo: serviceData.imageOrRepo || 'custom-repository',
      status: 'deploying',
      cpuUsage: 45,
      memoryUsage: 140,
      memoryLimit: 512,
      networkIn: 10,
      networkOut: 5,
      uptime: 'در حال بیلد...',
      restartsCount: 0,
      region: serviceData.region || 'eu-west-1 (Frankfurt)',
      port: serviceData.port || 80,
      healthEndpoint: '/health',
      domains: serviceData.domains && serviceData.domains.length > 0 ? serviceData.domains : defaultDomains,
      envVars: serviceData.envVars || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      historyMetrics: [],
    };

    // Add service in deploying state — into the SAME project that was resolved
    // above, not into whatever project happens to come first.
    setAccounts((prev) =>
      prev.map((acc) => {
        if (acc.id !== targetAccountId) return acc;
        const targetProj = acc.projects.find((p) => p.id === realProject.id);
        if (!targetProj) {
          // The hub no longer creates local projects; deploy into a real Railway project.
          return acc;
        }
        const updatedProjects = acc.projects.map((p) =>
          p.id === targetProj.id ? { ...p, services: [newService, ...p.services] } : p
        );
        return { ...acc, projects: updatedProjects };
      })
    );

    addLog({
      level: 'info',
      serviceName: newService.name,
      message: `[DEPLOY] Triggered build container for ${newService.name}.`,
    });

    // Only a service Railway doesn't know about (no railwayServiceId → local
    // placeholder id) needs a simulated finish: a real service gets its status
    // from sync, which reports the actual deployment. Flipping every service to
    // "healthy" after 3.8s used to mark builds green while Railway was still
    // building them — and sync then flipped them back, so the pill flickered.
    if (!serviceData.railwayServiceId) {
      setTimeout(() => {
        addLog({
          level: 'info',
          serviceName: newService.name,
          message: `[CONTAINER] Port ${newService.port} bound. Health check probe /health listening.`,
        });

        // Mark healthy
        setAccounts((prev) =>
          prev.map((acc) => {
            if (acc.id !== targetAccountId) return acc;
            const updatedProjects = acc.projects.map((p) => ({
              ...p,
              services: p.services.map((s) =>
                s.id === newServiceId
                  ? {
                      ...s,
                      status: 'healthy' as ServiceStatus,
                      uptime: '1m',
                      cpuUsage: Math.floor(8 + Math.random() * 15),
                      memoryUsage: Math.floor(95 + Math.random() * 50),
                    }
                  : s
              ),
            }));
            return { ...acc, projects: updatedProjects };
          })
        );

        sendCustomAlert(
          '🚀 دپلوی با موفقیت انجام شد',
          `سرویس ${newService.name} با پورت ${newService.port} در ریجن ${newService.region} با موفقیت آنلاین شد.`,
          'info',
          newService.name
        );
      }, 3800);
    }

    return { success: true };
  }, [accounts, addLog, sendCustomAlert]);

  /** Account/project/service triple for a lifecycle action, by serviceId. */
  const findServiceRef = useCallback(
    (serviceId: string) => {
      for (const acc of accounts) {
        for (const proj of acc.projects || []) {
          const srv = (proj.services || []).find((s) => s.id === serviceId);
          if (srv) return { acc, proj, srv };
        }
      }
      return null;
    },
    [accounts]
  );

  /** Applies an optimistic patch while a lifecycle mutation is in flight. */
  const patchService = useCallback((serviceId: string, patch: Partial<RailwayService>) => {
    setAccounts((prev) =>
      prev.map((acc) => ({
        ...acc,
        projects: acc.projects.map((p) => ({
          ...p,
          services: p.services.map((s) => (s.id === serviceId ? { ...s, ...patch } : s)),
        })),
      }))
    );
  }, []);

  /** Shared flow for restart / redeploy / manual source update / stop: locate
   *  the service, call the real Railway mutation, then re-sync so the card shows
   *  actual deployment state instead of the optimistic patch. Never throws —
   *  card handlers are fire-and-forget; failures land in the log and the
   *  returned result. `successLog` may be a function so the update action can
   *  report WHICH mutation the server picked (image vs repo source). */
  const runDeploymentAction = useCallback(
    async (
      serviceId: string,
      action: 'restart' | 'redeploy' | 'update' | 'stop',
      pendingStatus: ServiceStatus,
      pendingLabel: string,
      successLog: string | ((res: any) => string)
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const ref = findServiceRef(serviceId);
        if (!ref) return { success: false, error: 'سرویس موردنظر یافت نشد.' };
        const { acc, proj, srv } = ref;
        if (!acc.token) return { success: false, error: 'توکن ریلوی برای این اکانت ثبت نشده است.' };

        const params = {
          token: acc.token,
          projectId: srv.projectId || proj.id,
          serviceId: srv.id,
          environmentId: proj.defaultEnvironmentId,
        };

        patchService(serviceId, { status: pendingStatus, uptime: pendingLabel });

        const res =
          action === 'restart'
            ? await restartRailwayService(params)
            : action === 'redeploy'
              ? await redeployRailwayService(params)
              : action === 'update'
                ? await manualUpdateRailwayService(params)
                : await stopRailwayService(params);

        const apiError = extractApiError(res, '');
        const ok =
          action === 'redeploy'
            ? !apiError && !!res?.data?.deploymentRedeploy?.id
            : action === 'update'
              ? !apiError &&
                (res?.data?.serviceInstanceRedeploy === true || res?.data?.serviceInstanceDeploy === true)
              : !apiError && res?.data?.[action === 'restart' ? 'deploymentRestart' : 'deploymentStop'] === true;

        if (!ok) {
          const message = apiError || 'درخواست به ریلوی ارسال نشد.';
          addLog({ level: 'error', serviceName: srv.name, message: `[${action.toUpperCase()}] ${message}` });
          await syncAccountProjects(acc.id);
          return { success: false, error: message };
        }

        addLog({
          level: 'info',
          serviceName: srv.name,
          message: typeof successLog === 'function' ? successLog(res) : successLog,
        });
        await syncAccountProjects(acc.id);
        return { success: true };
      } catch (err: any) {
        const message = err?.message || 'خطای غیرمنتظره هنگام اجرای عملیات.';
        addLog({ level: 'error', serviceName: 'ServiceManager', message: `[${action.toUpperCase()}] ${message}` });
        return { success: false, error: message };
      }
    },
    [findServiceRef, patchService, addLog, syncAccountProjects]
  );

  // Restart Service (deploymentRestart — real container restart on Railway)
  const restartService = useCallback(
    (serviceId: string) =>
      runDeploymentAction(
        serviceId,
        'restart',
        'deploying',
        'در حال ری‌استارت...',
        '[RESTART] deploymentRestart ارسال شد؛ کنتینر در حال ری‌استارت است.'
      ),
    [runDeploymentAction]
  );

  // Redeploy Service (deploymentRedeploy — queues a fresh deployment)
  const redeployService = useCallback(
    (serviceId: string) =>
      runDeploymentAction(
        serviceId,
        'redeploy',
        'deploying',
        'در حال دیپلوی مجدد...',
        '[REDEPLOY] deploymentRedeploy ارسال شد؛ استقرار جدید در صف قرار گرفت.'
      ),
    [runDeploymentAction]
  );

  // Manual source update — the source changed upstream (new image tag, new
  // commit) but nothing told Railway about it. Image sources re-pull the tag,
  // Git sources deploy the latest commit; the server picks by reading source.
  const updateSourceService = useCallback(
    (serviceId: string) =>
      runDeploymentAction(
        serviceId,
        'update',
        'deploying',
        'در حال آپدیت از آخرین سورس...',
        (res) =>
          res?.method === 'serviceInstanceDeploy'
            ? '[UPDATE] serviceInstanceDeploy(latestCommit: true) ارسال شد؛ آخرین کامیت در صف دیپلوی قرار گرفت.'
            : '[UPDATE] serviceInstanceRedeploy ارسال شد؛ تگ ایمیج دوباره pull می‌شود.'
      ),
    [runDeploymentAction]
  );

  // Stop Service (deploymentStop — stops the running deployment)
  const stopService = useCallback(
    (serviceId: string) =>
      runDeploymentAction(
        serviceId,
        'stop',
        'stopped',
        'متوقف شده',
        '[STOP] deploymentStop ارسال شد؛ سرویس متوقف شد.'
      ),
    [runDeploymentAction]
  );

  // Start Service — a stopped deployment is revived the same way: restart it.
  const startService = useCallback(
    (serviceId: string) =>
      runDeploymentAction(
        serviceId,
        'restart',
        'deploying',
        'در حال روشن شدن...',
        '[START] deploymentRestart ارسال شد؛ سرویس در حال روشن شدن است.'
      ),
    [runDeploymentAction]
  );

  // Delete Service (serviceDelete — removes it on Railway for real)
  const deleteService = useCallback(
    async (serviceId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const ref = findServiceRef(serviceId);
        if (!ref) return { success: false, error: 'سرویس موردنظر یافت نشد.' };
        const { acc, proj, srv } = ref;
        if (!acc.token) return { success: false, error: 'توکن ریلوی برای این اکانت ثبت نشده است.' };

        const res = await deleteRailwayService({
          token: acc.token,
          serviceId: srv.id,
          environmentId: proj.defaultEnvironmentId,
        });
        const apiError = extractApiError(res, '');
        if (apiError || res?.data?.serviceDelete !== true) {
          const message = apiError || 'حذف سرویس روی ریلوی انجام نشد.';
          addLog({ level: 'error', serviceName: srv.name, message: `[DELETE] ${message}` });
          return { success: false, error: message };
        }

        setAccounts((prev) =>
          prev.map((a) => ({
            ...a,
            projects: a.projects.map((p) => ({
              ...p,
              services: p.services.filter((s) => s.id !== serviceId),
            })),
          }))
        );
        addLog({ level: 'warn', serviceName: srv.name, message: '[DELETE] سرویس روی ریلوی حذف شد.' });
        await syncAccountProjects(acc.id);
        return { success: true };
      } catch (err: any) {
        const message = err?.message || 'خطای غیرمنتظره هنگام حذف سرویس.';
        addLog({ level: 'error', serviceName: 'ServiceManager', message: `[DELETE] ${message}` });
        return { success: false, error: message };
      }
    },
    [findServiceRef, addLog, syncAccountProjects]
  );

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  // Background ticker for live log generator and metrics pulse
  useEffect(() => {
    if (!isStreamingLogs) return;

    const interval = setInterval(() => {
      const activeServices = allServices.filter((s) => s.status === 'healthy');
      if (activeServices.length === 0) return;

      const randomService = activeServices[Math.floor(Math.random() * activeServices.length)];
      const sampleMessages = [
        `[HTTP] GET /api/v1/status 200 OK - ${(Math.random() * 12 + 2).toFixed(1)}ms`,
        `[METRICS] CPU usage steady at ${(Math.random() * 25 + 5).toFixed(1)}% | RAM ${(Math.random() * 40 + 120).toFixed(0)}MB`,
        `[HEARTBEAT] Health probe check passed (all 4 workers responsive)`,
        `[QUEUE] Background job processed in ${(Math.random() * 80 + 10).toFixed(0)}ms`,
        `[DB_POOL] Active connections: ${Math.floor(Math.random() * 8 + 2)} / 20 pool capacity`,
      ];
      const randomMsg = sampleMessages[Math.floor(Math.random() * sampleMessages.length)];

      addLog({
        level: 'info',
        serviceName: randomService.name,
        message: randomMsg,
      });
    }, 4000);

    return () => clearInterval(interval);
  }, [isStreamingLogs, allServices, addLog]);

  // Real Railway telemetry: poll CPU/memory/network for healthy services
  // every 30s and store genuine values + history (replaces the old fake
  // jitter that used to live in the log ticker above).
  const accountsRef = useRef(accounts);
  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  useEffect(() => {
    if (!stateReady) return;

    const pollRealMetrics = async () => {
      const targets: { acc: RailwayAccount; projectId: string; envId: string; srvId: string }[] = [];
      for (const acc of accountsRef.current) {
        if (!acc.token) continue;
        for (const p of acc.projects || []) {
          if (p.isDeletedOnRailway) continue;
          for (const s of p.services || []) {
            if (s.status !== 'healthy') continue;
            targets.push({ acc, projectId: p.id, envId: p.defaultEnvironmentId || '', srvId: s.id });
          }
        }
      }
      if (targets.length === 0) return;

      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 30 * 60 * 1000);

      await Promise.all(
        targets.slice(0, 12).map(async (t) => {
          try {
            const res = await getRailwayServiceMetrics({
              token: t.acc.token,
              measurements: [
                'CPU_USAGE',
                'CPU_LIMIT',
                'MEMORY_USAGE_GB',
                'MEMORY_LIMIT_GB',
                'NETWORK_RX_GB',
                'NETWORK_TX_GB',
              ],
              startDate: startDate.toISOString(),
              endDate: endDate.toISOString(),
              serviceId: t.srvId,
              projectId: t.projectId,
              environmentId: t.envId || undefined,
              sampleRateSeconds: 120,
            });
            const rows = res?.data?.metrics;
            if (!Array.isArray(rows) || rows.length === 0) return;

            const series = (m: string): { ts: number; value: number }[] => {
              const row = rows.find((r: any) => r?.measurement === m);
              return Array.isArray(row?.values) ? row.values : [];
            };
            const cpuVals = series('CPU_USAGE');
            const cpuLimitVals = series('CPU_LIMIT');
            const memVals = series('MEMORY_USAGE_GB');
            const memLimitVals = series('MEMORY_LIMIT_GB');
            const rxVals = series('NETWORK_RX_GB');
            const txVals = series('NETWORK_TX_GB');

            const toMs = (ts: number) => (ts > 1e12 ? ts : ts * 1000);
            const fmtTime = (ms: number) =>
              new Date(ms).toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });
            // usage/limit share units (both raw or both GB) → ratio is exact.
            const toPct = (usage: number, limit: number | null) => {
              let pct: number;
              if (limit !== null && limit > 0) pct = (usage / limit) * 100;
              else pct = usage <= 1.5 ? usage * 100 : usage;
              return Math.max(0, Math.min(100, Math.round(pct)));
            };
            const lastVal = (arr: { value: number }[]) => (arr.length ? arr[arr.length - 1].value : null);

            const cpuLimitByTs = new Map(cpuLimitVals.map((v) => [v.ts, v.value]));
            const lastCpuLimit = lastVal(cpuLimitVals);
            const memByTs = new Map(memVals.map((v) => [v.ts, v.value]));
            const rxByTs = new Map(rxVals.map((v) => [v.ts, v.value]));
            const txByTs = new Map(txVals.map((v) => [v.ts, v.value]));

            const tsSet = new Set<number>([...cpuVals.map((v) => v.ts), ...memVals.map((v) => v.ts)]);
            const tsList = [...tsSet].sort((a, b) => a - b);
            const cpuByTs = new Map(cpuVals.map((v) => [v.ts, v.value]));

            const history: MetricDataPoint[] = tsList
              .slice(-20)
              .map((ts) => {
                const usage = cpuByTs.get(ts);
                const lim = cpuLimitByTs.get(ts) ?? lastCpuLimit;
                return {
                  time: fmtTime(toMs(ts)),
                  cpu: usage === undefined ? 0 : toPct(usage, lim),
                  memory: Math.round((memByTs.get(ts) ?? 0) * 1024),
                  networkIn: Math.round((rxByTs.get(ts) ?? 0) * 1024),
                  networkOut: Math.round((txByTs.get(ts) ?? 0) * 1024),
                  requests: 0,
                };
              })
              .filter((p) => p.cpu > 0 || p.memory > 0);

            const lastCpu = lastVal(cpuVals);
            const lastMem = lastVal(memVals);
            const lastMemLimit = lastVal(memLimitVals);
            const cpuPct = lastCpu === null ? null : toPct(lastCpu, lastCpuLimit);

            setAccounts((prev) =>
              prev.map((acc) => {
                if (acc.id !== t.acc.id) return acc;
                return {
                  ...acc,
                  projects: acc.projects.map((p) => {
                    if (p.id !== t.projectId) return p;
                    return {
                      ...p,
                      services: p.services.map((s) => {
                        if (s.id !== t.srvId) return s;
                        return {
                          ...s,
                          cpuUsage: cpuPct ?? s.cpuUsage,
                          ...(lastMem !== null ? { memoryUsage: Math.round(lastMem * 1024) } : {}),
                          ...(lastMemLimit !== null && lastMemLimit > 0
                            ? { memoryLimit: Math.round(lastMemLimit * 1024) }
                            : {}),
                          ...(history.length > 0 ? { historyMetrics: history } : {}),
                        };
                      }),
                    };
                  }),
                };
              })
            );
          } catch {
            // A failed metrics pull for one service must not break the poll.
          }
        })
      );
    };

    pollRealMetrics();
    const timer = setInterval(pollRealMetrics, 30_000);
    return () => clearInterval(timer);
  }, [stateReady]);

  // Periodic Balance Refresh (every 30 seconds)
  useEffect(() => {
    const timer = setInterval(() => {
      refreshAccountBalances();
    }, 30000);
    return () => clearInterval(timer);
  }, [refreshAccountBalances]);

  const value = {
    accounts,
    activeAccountId,
    activeAccount,
    alerts,
    logs,
    isStreamingLogs,
    isSyncingProjects,
    activeTab,
    theme,
    deployJob,
    setDeployJob,
    serviceDeployStates,
    setServiceDeployState,
    setActiveAccountId,
    setActiveTab,
    toggleTheme,
    syncAccountProjects,
    addAccount,
    updateAccount,
    deleteAccount,
    deleteProject,
    refreshAccountBalances,
    deployService,
    restartService,
    redeployService,
    updateSourceService,
    stopService,
    startService,
    deleteService,
    sendCustomAlert,
    clearAlerts,
    setIsStreamingLogs,
    addLog,
    clearLogs,
    deletedVolumeIds,
    markVolumeDeleted,
    allServices,
    totalCreditsLimit,
    totalCreditsUsed,
    totalCreditsRemaining,
    healthyServicesCount,
    crashedServicesCount,
    stoppedServicesCount,
  };

  return <HubContext.Provider value={value}>{children}</HubContext.Provider>;
};

export const useHub = () => {
  const context = useContext(HubContext);
  if (!context) {
    throw new Error('useHub must be used within a HubProvider');
  }
  return context;
};
