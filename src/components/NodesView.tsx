import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Server,
  Plus,
  RotateCw,
  Play,
  Square,
  Terminal,
  Trash2,
  ExternalLink,
  Search,
  Globe,
  Sliders,
  FolderGit2,
  X,
  CheckCircle2,
  AlertTriangle,
  HardDrive,
  Wrench,
  Shield,
  Layers,
  Copy,
  Check,
  Zap,
  Rocket,
  DownloadCloud,
} from 'lucide-react';
import { useHub } from '../context/HubContext';
import { RailwayService, RailwayProject, RailwayServiceDomain, domainLabel } from '../types';
import {
  createRailwayProject,
  upsertRailwayVariable,
  deleteRailwayVariable,
  createRailwaySubdomain,
  createRailwayCustomDomain,
  getRailwayServiceDomains,
  deleteRailwayDomain,
  updateRailwayServiceInstance,
  createRailwayVolume,
  createRailwayEnvironment,
  getRailwayDeploymentLogs,
  deleteRailwayVolume,
  getRailwayVolumeInstances,
} from '../services/railwayApi';
import { extractApiError } from '../utils/githubRepo';
import { ServiceIcon } from './ServiceIcon';

/** "۲ دقیقه پیش" for a Railway statusUpdatedAt timestamp. */
function railTimeAgo(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'همین حالا';
  if (mins < 60) return `${mins} دقیقه پیش`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ساعت پیش`;
  return `${Math.floor(hours / 24)} روز پیش`;
}

/** Tailwind text color for a raw Railway deployment status word. */
function railStatusColor(srv: RailwayService): string {
  if (srv.deploymentStopped) return 'text-neutral-400';
  switch (srv.deploymentStatus) {
    case 'SUCCESS':
      return 'text-emerald-400';
    case 'BUILDING':
    case 'DEPLOYING':
    case 'INITIALIZING':
    case 'QUEUED':
    case 'WAITING':
    case 'NEEDS_APPROVAL':
      return 'text-amber-400';
    case 'CRASHED':
    case 'FAILED':
      return 'text-rose-400';
    case 'SLEEPING':
      return 'text-sky-400';
    default:
      return 'text-neutral-500';
  }
}

interface NodesViewProps {
  onOpenDeploy: () => void;
}

/** Status pill for one volume, from `environment.volumeInstances`.
 *  `source: 'record'` means only `project.volumes` knew about it — no state. */
function volumeStatusBadge(vol: any): { label: string; cls: string } {
  if (vol?.source !== 'instance') {
    return { label: 'وضعیت نامشخص', cls: 'border-neutral-600 bg-neutral-700/40 text-neutral-300' };
  }
  // Railway purges 48h after `deletedAt` is set — surface it before health.
  if (vol.isPendingDeletion) {
    return { label: 'در صف حذف', cls: 'border-amber-500/40 bg-amber-500/15 text-amber-300' };
  }
  if (vol.state && vol.state !== 'READY') {
    return { label: vol.state, cls: 'border-rose-500/40 bg-rose-500/15 text-rose-300' };
  }
  return vol.serviceId
    ? { label: 'متصل', cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' }
    : { label: 'جدا شده', cls: 'border-sky-500/40 bg-sky-500/15 text-sky-300' };
}

/** Tailwind color for a Railway `deploymentLogs.severity` value. */
function deployLogSeverityClass(severity?: string | null): string {
  const s = (severity || '').toUpperCase();
  if (s === 'ERROR' || s === 'CRITICAL' || s === 'FATAL') return 'text-rose-400';
  if (s === 'WARN' || s === 'WARNING') return 'text-amber-400';
  if (s === 'DEBUG') return 'text-neutral-500';
  return 'text-emerald-400/90';
}

/** Railway sends log timestamps as ISO strings or epoch numbers — render both. */
function deployLogTime(ts: any): string {
  if (ts === null || ts === undefined || ts === '') return '';
  const d = new Date(typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleTimeString('fa-IR');
}

export const NodesView: React.FC<NodesViewProps> = ({ onOpenDeploy }) => {
  const {
    accounts,
    activeAccountId,
    allServices,
    restartService,
    redeployService,
    updateSourceService,
    stopService,
    startService,
    deleteService,
    setActiveTab,
    addLog,
    deletedVolumeIds,
    markVolumeDeleted,
    sendCustomAlert,
    updateAccount,
    syncAccountProjects,
    isSyncingProjects,
    deleteProject,
    deployJob,
    setDeployJob,
    serviceDeployStates,
    setServiceDeployState,
  } = useHub();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  // Transient feedback for card lifecycle actions (restart/redeploy/stop/delete)
  const [cardActionToast, setCardActionToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // Two-click confirm — delete now removes the service on Railway for real.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const flashCardToast = (kind: 'ok' | 'error', text: string) => {
    setCardActionToast({ kind, text });
    setTimeout(() => setCardActionToast(null), 4500);
  };

  /** Runs a lifecycle action and reports the outcome on a card toast. */
  const runCardAction = async (
    srv: RailwayService,
    fn: (id: string) => Promise<{ success: boolean; error?: string }>,
    successText: string
  ) => {
    const res = await fn(srv.id);
    if (res.success) flashCardToast('ok', successText);
    else flashCardToast('error', res.error || 'عملیات روی ریلوی انجام نشد.');
  };

  // Modals state
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState('');

  // 1. Env Vars Modal State
  const [selectedEnvService, setSelectedEnvService] = useState<RailwayService | null>(null);
  const [varKeyInput, setVarKeyInput] = useState('');
  const [varValInput, setVarValInput] = useState('');
  const [skipDeploysToggle, setSkipDeploysToggle] = useState(true);
  const [isSavingVar, setIsSavingVar] = useState(false);

  // 2. Domain Modal State
  const [selectedDomainService, setSelectedDomainService] = useState<RailwayService | null>(null);
  const [customDomainInput, setCustomDomainInput] = useState('');
  const [targetPortInput, setTargetPortInput] = useState(3000);
  const [isCreatingDomain, setIsCreatingDomain] = useState(false);
  const [isRefreshingDomains, setIsRefreshingDomains] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [dnsRecordsInfo, setDnsRecordsInfo] = useState<any[] | null>(null);

  // 3. Build & Run Config Modal State
  const [selectedBuildConfigService, setSelectedBuildConfigService] = useState<RailwayService | null>(null);
  const [builder, setBuilder] = useState('NIXPACKS');
  const [buildCommand, setBuildCommand] = useState('npm run build');
  const [startCommand, setStartCommand] = useState('npm start');
  const [rootDirectory, setRootDirectory] = useState('');
  const [healthcheckPath, setHealthcheckPath] = useState('/health');
  const [isSavingConfig, setIsSavingEnvConfig] = useState(false);

  // 4. Volume Modal State
  const [selectedVolumeService, setSelectedVolumeService] = useState<RailwayService | null>(null);
  const [mountPathInput, setMountPathInput] = useState('/app/data');
  const [isCreatingVolume, setIsCreatingVolume] = useState(false);

  // 5. Deploy Logs Modal State (real Railway deploymentLogs for one service)
  const [selectedLogService, setSelectedLogService] = useState<RailwayService | null>(null);
  const [deployLogs, setDeployLogs] = useState<any[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const logsScrollRef = useRef<HTMLDivElement>(null);

  // 6. Project Volumes Modal State (list + volumeDelete)
  const [volumeProjectId, setVolumeProjectId] = useState<string | null>(null);
  const [confirmDeleteVolumeId, setConfirmDeleteVolumeId] = useState<string | null>(null);
  const [isDeletingVolume, setIsDeletingVolume] = useState(false);
  const [volumeError, setVolumeError] = useState<string | null>(null);
  // Live status from environment.volumeInstances (null = not fetched yet).
  const [volumeInstances, setVolumeInstances] = useState<any[] | null>(null);
  const [isLoadingInstances, setIsLoadingInstances] = useState(false);
  const [instancesError, setInstancesError] = useState<string | null>(null);

  // Target Account & Project
  const targetAccount = accounts.find((a) => a.id === activeAccountId) || accounts[0];

  // Aggregate Projects List — only real Railway projects (deleted, and any legacy
// hub-local ones, are hidden). Volumes this app already removed are filtered
  // here (single choke point) because Railway's `project.volumes` keeps
  // returning them after a successful volumeDelete.
  const allProjects = useMemo(() => {
    const list: RailwayProject[] = [];
    accounts.forEach((acc) => {
      if (activeAccountId === 'all' || acc.id === activeAccountId) {
        acc.projects.forEach((p) => {
          if (!p.isDeletedOnRailway && p.isExternal) {
            list.push(
              p.volumes && p.volumes.length > 0
                ? { ...p, volumes: p.volumes.filter((v) => !deletedVolumeIds.includes(v.id)) }
                : p
            );
          }
        });
      }
    });
    return list;
  }, [accounts, activeAccountId, deletedVolumeIds]);

  // Active Selected Project Object
  const selectedProject = useMemo(() => {
    if (selectedProjectId === 'all') return null;
    return allProjects.find((p) => p.id === selectedProjectId) || null;
  }, [allProjects, selectedProjectId]);

  // Resolved live from state (not a snapshot) so the volume list drops a disk
  // as soon as the post-delete sync returns.
  const volumeProject = useMemo(
    () => (volumeProjectId ? allProjects.find((p) => p.id === volumeProjectId) || null : null),
    [allProjects, volumeProjectId]
  );

  /** Rows for the modal: live instances (status, mount, size) plus any bare
   *  record `project.volumes` still reports. Volumes this app deleted are
   *  filtered out — Railway keeps returning them for the 48h purge window. */
  const volumeRows = useMemo(() => {
    if (!volumeProject) return [];
    const rows = new Map<string, any>();
    for (const inst of volumeInstances || []) {
      const id = inst?.volume?.id || inst?.id;
      if (!id || deletedVolumeIds.includes(id)) continue;
      rows.set(id, { id, name: inst.volume?.name || '', source: 'instance', ...inst });
    }
    for (const rec of volumeProject.volumes || []) {
      if (rows.has(rec.id)) continue;
      rows.set(rec.id, { id: rec.id, name: rec.name, source: 'record' });
    }
    return Array.from(rows.values());
  }, [volumeProject, volumeInstances, deletedVolumeIds]);

  // The "all projects" option was removed — always keep exactly one project
  // selected (auto-selects the first one when the list changes).
  useEffect(() => {
    if (allProjects.length === 0) return;
    if (selectedProjectId !== 'all' && allProjects.some((p) => p.id === selectedProjectId)) return;
    setSelectedProjectId(allProjects[0].id);
  }, [allProjects, selectedProjectId]);

  // Filtered Services List
  const filteredServices = useMemo(() => {
    return allServices.filter((srv) => {
      if (activeAccountId !== 'all' && srv.accountId !== activeAccountId) {
        return false;
      }
      if (selectedProjectId !== 'all' && srv.projectId !== selectedProjectId) {
        return false;
      }
      if (statusFilter !== 'all' && srv.status !== statusFilter) {
        return false;
      }
      if (
        searchQuery &&
        !srv.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !srv.imageOrRepo.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [allServices, activeAccountId, selectedProjectId, statusFilter, searchQuery]);

  // Handle Project Creation
  const handleCreateProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || !targetAccount) return;

    setCreateProjectError('');
    setIsCreatingProject(true);

    try {
      const res = await createRailwayProject(targetAccount.token, newProjectName.trim(), newProjectDesc.trim());

      // The server returns our own limit error (403) or the raw Railway GraphQL errors.
      if (res.error || res.errors?.length) {
        const apiMessage = res.error || res.errors?.[0]?.message || 'خطا در ساخت پروژه در ریلوی';
        setCreateProjectError(apiMessage);
        addLog({
          level: 'error',
          serviceName: 'ProjectManager',
          message: `[PROJECT_CREATE_FAILED] ${apiMessage}`,
        });
        setIsCreatingProject(false);
        return;
      }

      const created = res.data?.projectCreate;
      if (!created?.id) {
        setCreateProjectError('ریلوی پروژه را نساخت (پاسخ نامعتبر). دوباره تلاش کنید.');
        setIsCreatingProject(false);
        return;
      }

      const newProjObj: RailwayProject = {
        id: created.id,
        accountId: targetAccount.id,
        name: created.name || newProjectName.trim(),
        description: created.description || newProjectDesc.trim() || 'پروژه ایجاد شده از پنل مدیریت',
        environment: 'production',
        defaultEnvironmentId: created.environments?.edges?.[0]?.node?.id,
        isExternal: true,
        isDeletedOnRailway: false,
        createdAt: created.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        services: [],
      };

      updateAccount(targetAccount.id, {
        projects: [...targetAccount.projects, newProjObj],
      });

      addLog({
        level: 'info',
        serviceName: 'ProjectManager',
        message: `[PROJECT_CREATED] New Railway project "${newProjObj.name}" (${newProjObj.id}) created on account ${targetAccount.name}.`,
      });

      sendCustomAlert('پروژه جدید ساخته شد', `پروژه ${newProjObj.name} با موفقیت در ریلوی ایجاد گردید.`, 'info');

      setIsCreatingProject(false);
      setIsNewProjectModalOpen(false);
      setNewProjectName('');
      setNewProjectDesc('');
    } catch (err: any) {
      setCreateProjectError(err?.message || 'خطای غیرمنتظره در ساخت پروژه');
      setIsCreatingProject(false);
    }
  };

  // Whether the active account has reached its Railway project limit
  const liveProjectsCount = targetAccount
    ? targetAccount.projects.filter((p) => !p.isDeletedOnRailway).length
    : 0;
  const atProjectLimit =
    !!targetAccount?.projectLimit && liveProjectsCount >= targetAccount.projectLimit;

  // Handle Variable Upsert (variableUpsert)
  const handleAddVariable = async () => {
    if (!selectedEnvService || !varKeyInput.trim() || !targetAccount) return;
    setIsSavingVar(true);

    const k = varKeyInput.trim();
    const v = varValInput.trim();

    await upsertRailwayVariable({
      token: targetAccount.token,
      projectId: selectedEnvService.projectId,
      serviceId: selectedEnvService.id,
      name: k,
      value: v,
      skipDeploys: skipDeploysToggle,
    });

    // Local update
    const updatedVars = { ...(selectedEnvService.envVars || {}), [k]: v };
    accounts.forEach((acc) => {
      const updatedProjects = acc.projects.map((p) => ({
        ...p,
        services: p.services.map((s) => (s.id === selectedEnvService.id ? { ...s, envVars: updatedVars } : s)),
      }));
      updateAccount(acc.id, { projects: updatedProjects });
    });

    addLog({
      level: 'info',
      serviceName: selectedEnvService.name,
      message: `[VAR_UPSERT] Variable ${k} set (skipDeploys: ${skipDeploysToggle}).`,
    });

    setVarKeyInput('');
    setVarValInput('');
    setIsSavingVar(false);
  };

  // Handle Variable Delete (variableDelete)
  const handleDeleteVariable = async (keyToDelete: string) => {
    if (!selectedEnvService || !targetAccount) return;

    await deleteRailwayVariable({
      token: targetAccount.token,
      projectId: selectedEnvService.projectId,
      name: keyToDelete,
    });

    const updatedVars = { ...(selectedEnvService.envVars || {}) };
    delete updatedVars[keyToDelete];

    accounts.forEach((acc) => {
      const updatedProjects = acc.projects.map((p) => ({
        ...p,
        services: p.services.map((s) => (s.id === selectedEnvService.id ? { ...s, envVars: updatedVars } : s)),
      }));
      updateAccount(acc.id, { projects: updatedProjects });
    });

    addLog({
      level: 'warn',
      serviceName: selectedEnvService.name,
      message: `[VAR_DELETE] Variable ${keyToDelete} removed.`,
    });
  };

  /** Resolves the environment UUID for a service's project (needed by domain APIs). */
  const resolveServiceEnvId = (service: RailwayService): string => {
    for (const acc of accounts) {
      const proj = acc.projects.find((p) => p.id === service.projectId);
      if (proj?.defaultEnvironmentId) return proj.defaultEnvironmentId;
    }
    return '';
  };

  /** The account that OWNS a service — Railway rejects a token from another
   *  account, so never fall back to the globally selected one silently. */
  const accountForService = (service: RailwayService) =>
    accounts.find((a) => a.id === service.accountId) || targetAccount;

  /** Pulls real build/run logs for a service's latest deployment. */
  const loadDeployLogs = async (service: RailwayService) => {
    const acc = accountForService(service);
    if (!acc?.token) {
      setDeployLogs([]);
      setLogsError('توکن ریلوی برای اکانت این سرویس ثبت نشده است.');
      setIsLoadingLogs(false);
      return;
    }
    if (!service.latestDeploymentId) {
      setDeployLogs([]);
      setLogsError('هنوز استقراری برای این سرویس روی ریلوی ثبت نشده است.');
      setIsLoadingLogs(false);
      return;
    }

    setIsLoadingLogs(true);
    setLogsError(null);
    try {
      const res = await getRailwayDeploymentLogs({
        token: acc.token,
        deploymentId: service.latestDeploymentId,
        limit: 200,
      });
      const err = extractApiError(res, '');
      if (err) throw new Error(err);
      const list = res?.data?.deploymentLogs;
      setDeployLogs(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setDeployLogs([]);
      setLogsError(e.message || 'دریافت لاگ از ریلوی ناموفق بود.');
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const openDeployLogs = async (service: RailwayService) => {
    setSelectedLogService(service);
    setDeployLogs([]);
    setLogsError(null);
    await loadDeployLogs(service);
  };

  // Keep the newest log line in view once a fetch lands.
  useEffect(() => {
    if (isLoadingLogs) return;
    logsScrollRef.current?.scrollTo({ top: logsScrollRef.current.scrollHeight });
  }, [deployLogs, isLoadingLogs]);

  /** Writes a domains array onto a service in local hub state. */
  const applyServiceDomains = (serviceId: string, domains: RailwayServiceDomain[]) => {
    accounts.forEach((acc) => {
      const updatedProjects = acc.projects.map((p) => ({
        ...p,
        services: p.services.map((s) => (s.id === serviceId ? { ...s, domains } : s)),
      }));
      updateAccount(acc.id, { projects: updatedProjects });
    });
    setSelectedDomainService((prev) =>
      prev && prev.id === serviceId ? { ...prev, domains } : prev
    );
  };

  /** Pulls live domains from Railway for the open modal's service. */
  const handleRefreshDomains = async () => {
    if (!selectedDomainService || !targetAccount) return;
    setIsRefreshingDomains(true);
    setDomainError(null);
    try {
      const res = await getRailwayServiceDomains({
        token: targetAccount.token,
        projectId: selectedDomainService.projectId,
        serviceId: selectedDomainService.id,
        environmentId: resolveServiceEnvId(selectedDomainService) || undefined,
      });
      const err = extractApiError(res, '');
      if (err) throw new Error(err);
      const domains: RailwayServiceDomain[] = res.domains || [];
      applyServiceDomains(selectedDomainService.id, domains);
      if (domains[0]?.targetPort) setTargetPortInput(Number(domains[0].targetPort));
    } catch (e: any) {
      setDomainError(e.message || 'دریافت دامنه‌ها از ریلوی ناموفق بود');
    } finally {
      setIsRefreshingDomains(false);
    }
  };

  // When the domain modal opens, pull live domains from Railway and seed the
  // target-port field from the first domain that has one.
  useEffect(() => {
    if (!selectedDomainService) return;
    setDomainError(null);
    const firstPort = (selectedDomainService.domains || []).find((d) => d.targetPort)?.targetPort;
    if (firstPort) setTargetPortInput(Number(firstPort));
    // Auto-fetch so the list always reflects Railway, not stale local state.
    void handleRefreshDomains();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDomainService?.id]);

  /** Deletes a domain on Railway (serviceDomainDelete / customDomainDelete). */
  const handleDeleteDomain = async (dom: RailwayServiceDomain) => {
    if (!selectedDomainService || !targetAccount) return;
    if (!window.confirm(`دامنه «${dom.domain}» از ریلوی حذف شود؟`)) return;

    setIsCreatingDomain(true);
    setDomainError(null);
    try {
      const res = await deleteRailwayDomain({
        token: targetAccount.token,
        id: dom.id,
        kind: dom.kind,
      });
      const err = extractApiError(res, '');
      if (err) throw new Error(err);
      // Boolean! success → drop locally and refresh from Railway.
      const remaining = (selectedDomainService.domains || []).filter((d) => d.id !== dom.id);
      applyServiceDomains(selectedDomainService.id, remaining);

      addLog({
        level: 'warn',
        serviceName: selectedDomainService.name,
        message: `[DOMAIN_DELETED] Removed domain ${dom.domain} (${dom.kind}).`,
      });
      sendCustomAlert('دامنه حذف شد', `دامنه ${dom.domain} از سرویس حذف گردید.`, 'warning');

      await handleRefreshDomains();
    } catch (e: any) {
      setDomainError(e.message || 'حذف دامنه از ریلوی ناموفق بود');
    } finally {
      setIsCreatingDomain(false);
    }
  };

  // Handle Free Subdomain Creation (*.up.railway.app)
  const handleCreateFreeSubdomain = async () => {
    if (!selectedDomainService || !targetAccount) return;
    setIsCreatingDomain(true);
    setDomainError(null);

    try {
      const envId = resolveServiceEnvId(selectedDomainService);
      const res = await createRailwaySubdomain({
        token: targetAccount.token,
        projectId: selectedDomainService.projectId,
        environmentId: envId || undefined,
        serviceId: selectedDomainService.id,
        targetPort: targetPortInput,
      });
      const err = extractApiError(res, '');
      if (err) throw new Error(err);

      const created = res.data?.serviceDomainCreate || res.serviceDomainCreate;
      const generatedDomain = created?.domain || `${selectedDomainService.name}.up.railway.app`;
      const newEntry: RailwayServiceDomain = {
        id: created?.id || `dom-${Date.now()}`,
        domain: generatedDomain,
        targetPort: targetPortInput,
        kind: 'service',
        environmentId: envId || undefined,
      };
      const next = [newEntry, ...(selectedDomainService.domains || [])];
      applyServiceDomains(selectedDomainService.id, next);

      addLog({
        level: 'info',
        serviceName: selectedDomainService.name,
        message: `[SUBDOMAIN_CREATED] Assigned domain ${generatedDomain}.`,
      });
    } catch (e: any) {
      setDomainError(e.message || 'ساخت زیردامنه ناموفق بود');
    } finally {
      setIsCreatingDomain(false);
    }
  };

  // Handle Custom Domain Attachment (customDomainCreate)
  const handleCreateCustomDomain = async () => {
    if (!selectedDomainService || !customDomainInput.trim() || !targetAccount) return;
    setIsCreatingDomain(true);
    setDomainError(null);

    try {
      const envId = resolveServiceEnvId(selectedDomainService);
      const res = await createRailwayCustomDomain({
        token: targetAccount.token,
        projectId: selectedDomainService.projectId,
        environmentId: envId || undefined,
        serviceId: selectedDomainService.id,
        domain: customDomainInput.trim(),
        targetPort: targetPortInput,
      });
      const err = extractApiError(res, '');
      if (err) throw new Error(err);

      const created = res.data?.customDomainCreate || res.customDomainCreate;
      const dnsRecords = created?.status?.dnsRecords || [
        { type: 'CNAME', name: customDomainInput.trim(), value: `${selectedDomainService.name}.up.railway.app` },
      ];
      setDnsRecordsInfo(dnsRecords);

      const newEntry: RailwayServiceDomain = {
        id: created?.id || `cdom-${Date.now()}`,
        domain: customDomainInput.trim(),
        targetPort: targetPortInput,
        kind: 'custom',
        environmentId: envId || undefined,
      };
      const next = [newEntry, ...(selectedDomainService.domains || [])];
      applyServiceDomains(selectedDomainService.id, next);
      setCustomDomainInput('');
    } catch (e: any) {
      setDomainError(e.message || 'اتصال دامنه اختصاصی ناموفق بود');
    } finally {
      setIsCreatingDomain(false);
    }
  };

  // Handle Build/Run Config Update (serviceInstanceUpdate)
  const handleSaveInstanceConfig = async () => {
    if (!selectedBuildConfigService || !targetAccount) return;
    setIsSavingEnvConfig(true);

    await updateRailwayServiceInstance({
      token: targetAccount.token,
      serviceId: selectedBuildConfigService.id,
      builder,
      buildCommand,
      startCommand,
      rootDirectory,
      healthcheckPath,
    });

    addLog({
      level: 'info',
      serviceName: selectedBuildConfigService.name,
      message: `[BUILD_CONFIG_UPDATED] Builder set to ${builder}, startCommand: "${startCommand}".`,
    });

    setIsSavingEnvConfig(false);
    setSelectedBuildConfigService(null);
  };

  // Handle Persistent Volume Creation (volumeCreate). Region is NOT guessed
  // here: Railway requires a region that matches the service and answers a
  // wrong/missing one with a bare `Not Authorized`, so the server resolves it
  // from the service's own deployment. Only the environment UUID is needed.
  const handleCreateVolumeSubmit = async () => {
    if (!selectedVolumeService || !targetAccount) return;
    setIsCreatingVolume(true);

    const res = await createRailwayVolume({
      token: targetAccount.token,
      projectId: selectedVolumeService.projectId,
      environmentId: resolveServiceEnvId(selectedVolumeService) || undefined,
      serviceId: selectedVolumeService.id,
      mountPath: mountPathInput,
    });
    const err = extractApiError(res, '');
    if (err) {
      flashCardToast('error', err);
      setIsCreatingVolume(false);
      return;
    }

    const region = res?.region ? ` in region ${res.region}` : '';
    addLog({
      level: 'info',
      serviceName: selectedVolumeService.name,
      message: `[VOLUME_CREATED] Persistent disk mounted at ${mountPathInput}${region}.`,
    });

    setIsCreatingVolume(false);
    setSelectedVolumeService(null);
  };

  // Handle Volume Deletion (volumeDelete) — erases everything on the disk, so
  // the caller (the row) only reaches this after a second confirming click.
  /** Live volume status (state / attached / pending deletion) from the
   *  environment — `project.volumes` reports none of it. */
  const loadVolumeInstances = async (project: RailwayProject) => {
    const acc = accounts.find((a) => a.id === project.accountId) || targetAccount;
    if (!acc?.token) {
      setVolumeInstances(null);
      setInstancesError('توکن ریلوی برای اکانت این پروژه ثبت نشده است.');
      return;
    }
    if (!project.defaultEnvironmentId) {
      setVolumeInstances(null);
      setInstancesError('محیط این پروژه مشخص نیست؛ وضعیت Volume قابل خواندن نیست.');
      return;
    }

    setIsLoadingInstances(true);
    setInstancesError(null);
    try {
      const res = await getRailwayVolumeInstances({
        token: acc.token,
        environmentId: project.defaultEnvironmentId,
      });
      const err = extractApiError(res, '');
      if (err) throw new Error(err);
      setVolumeInstances(Array.isArray(res.instances) ? res.instances : []);
    } catch (e: any) {
      setVolumeInstances(null);
      setInstancesError(e.message || 'دریافت وضعیت Volume از ریلوی ناموفق بود.');
    } finally {
      setIsLoadingInstances(false);
    }
  };

  const openVolumeModal = (project: RailwayProject) => {
    setVolumeProjectId(project.id);
    setVolumeError(null);
    setConfirmDeleteVolumeId(null);
    setInstancesError(null);
    setVolumeInstances(null);
    void loadVolumeInstances(project);
  };

  const handleDeleteVolume = async (volumeId: string) => {
    if (!volumeProject) return;
    const acc = accounts.find((a) => a.id === volumeProject.accountId) || targetAccount;
    if (!acc?.token) {
      setVolumeError('توکن ریلوی برای اکانت این پروژه ثبت نشده است.');
      return;
    }

    setIsDeletingVolume(true);
    setVolumeError(null);
    try {
      const res = await deleteRailwayVolume({ token: acc.token, volumeId });
      const err = extractApiError(res, '');
      if (err) throw new Error(err);
      if (res?.data?.volumeDelete !== true) throw new Error('ریلوی حذف Volume را نپذیرفت.');

      // Railway keeps returning the volume from `project.volumes` after a
      // successful delete, so remember it here or the next sync brings it back.
      markVolumeDeleted(volumeId);

      addLog({
        level: 'info',
        serviceName: volumeProject.name,
        message: `[VOLUME_DELETED] Volume ${volumeId} deleted — its data is gone.`,
      });
      flashCardToast('ok', 'Volume روی ریلوی حذف شد.');
      await syncAccountProjects(acc.id);
    } catch (e: any) {
      const message = e.message || 'حذف Volume روی ریلوی انجام نشد.';
      setVolumeError(message);
      flashCardToast('error', message);
    } finally {
      setIsDeletingVolume(false);
      setConfirmDeleteVolumeId(null);
    }
  };

  return (
    <div className="space-y-5 pb-20 lg:pb-8 w-full max-w-full overflow-hidden">
      
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-base sm:text-xl font-black text-white flex items-center gap-2">
            <Server className="h-5 w-5 sm:h-6 sm:w-6 text-purple-400 shrink-0" />
            <span>مدیریت نودها، سرویس‌ها و پروژه‌ها</span>
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            ساخت پروژه جدید، تنظیمات بیلد، دامنه‌های اختصاصی، متغیرهای محیطی و دیسک پایدار Volume
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => syncAccountProjects(activeAccountId)}
            disabled={isSyncingProjects}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-300 hover:text-white hover:border-neutral-700 transition disabled:opacity-50"
            title="فراخوانی تمام پروژه‌ها و سرویس‌های ساخته‌شده مستقیم در اکانت ریلیوی"
          >
            <RotateCw className={`h-3.5 w-3.5 text-sky-400 ${isSyncingProjects ? 'animate-spin' : ''}`} />
            <span>همگام‌سازی پروژه‌ها از ریلیوی</span>
          </button>

          <button
            onClick={() => setIsNewProjectModalOpen(true)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 px-3.5 py-2 text-xs font-semibold text-neutral-200 hover:text-white hover:border-neutral-700 transition"
          >
            <FolderGit2 className="h-4 w-4 text-purple-400" />
            <span>پروژه جدید</span>
          </button>
        </div>
      </div>

      {/* Projects Ribbon Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full no-scrollbar">
        <span className="text-xs font-semibold text-neutral-400 shrink-0">پروژه‌ها:</span>
        {allProjects.map((proj) => {
          const isSelected = selectedProjectId === proj.id;
          return (
            <button
              key={proj.id}
              onClick={() => setSelectedProjectId(proj.id)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium shrink-0 transition flex items-center gap-1.5 ${
                isSelected
                  ? 'bg-purple-600 text-white font-bold shadow-md shadow-purple-600/20'
                  : 'bg-neutral-900 border border-neutral-800 text-neutral-300 hover:border-neutral-700'
              }`}
            >
              <span>{proj.name}</span>
              <span className={`text-[9px] px-1.5 py-0.2 rounded font-semibold ${isSelected ? 'bg-white/20 text-white' : 'bg-sky-500/15 text-sky-300 border border-sky-500/25'}`}>
                از ریلوی
              </span>
              {proj.volumes && proj.volumes.length > 0 && (
                <span
                  className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.2 text-[9px] font-semibold border ${
                    isSelected
                      ? 'bg-white/15 text-white border-white/25'
                      : 'bg-amber-500/15 text-amber-300 border-amber-500/25'
                  }`}
                  title={`Volume ها: ${proj.volumes.map((v) => v.name).join('، ')}`}
                >
                  <HardDrive className="h-2.5 w-2.5" />
                  {proj.volumes.length}
                </span>
              )}
              <span className="rounded-full bg-neutral-950/40 px-1.5 py-0.2 text-[10px] font-mono">
                {proj.services?.length || 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected Project Detailed Info Card (if specific project is selected) */}
{selectedProject && (
        <div className="rounded-2xl border border-purple-500/20 bg-gradient-to-r from-purple-950/20 via-neutral-900/50 to-neutral-900/80 p-4 backdrop-blur-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl border bg-purple-500/10 border-purple-500/30 text-purple-400 flex items-center justify-center shrink-0">
              <FolderGit2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white truncate">{selectedProject.name}</h3>
                <span className="rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 px-2 py-0.5 text-[10px] font-semibold">
                  همگامشده از ریلوی
                </span>
              </div>
              <p className="text-xs text-neutral-400 truncate mt-0.5">
                {selectedProject.description || 'بدون توضیحات'} • {selectedProject.services?.length || 0} سرویس فعال
                {(selectedProject.volumes?.length || 0) > 0 && (
                  <span
                    className="text-amber-300/90"
                    title={selectedProject.volumes!.map((v) => v.name).join('، ')}
                  >
                    {' '}
                    • {selectedProject.volumes!.length} Volume
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
            <button
              onClick={() => openVolumeModal(selectedProject)}
              className="flex items-center gap-1.5 rounded-xl bg-sky-500/10 border border-sky-500/30 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 transition"
              title="مدیریت Volume های این پروژه (project.volumes / volumeDelete)"
            >
              <HardDrive className="h-3.5 w-3.5" />
              <span>
                Volume‌ها
                {(selectedProject.volumes?.length || 0) > 0 ? ` (${selectedProject.volumes!.length})` : ''}
              </span>
            </button>

            <button
              onClick={onOpenDeploy}
              className="flex items-center gap-1.5 rounded-xl bg-purple-600/30 border border-purple-500/40 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-600/50 transition"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>افزودن سرویس</span>
            </button>

            <button
              onClick={() => {
                if (targetAccount) {
                  if (window.confirm(`آیا از حذف پروژه "${selectedProject.name}" اطمینان دارید؟`)) {
                    deleteProject(targetAccount.id, selectedProject.id).then((res) => {
                      if (res.success) setSelectedProjectId('all');
                    });
                  }
                }
              }}
              className="flex items-center gap-1.5 rounded-xl bg-rose-600/20 border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-600/40 transition"
              title="حذف کامل پروژه"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>حذف پروژه</span>
            </button>
          </div>
        </div>
      )}

      {/* Search and Status Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 rounded-2xl bg-neutral-900/60 p-2.5 border border-neutral-800 backdrop-blur-md max-w-full overflow-hidden">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-neutral-400" />
          <input
            type="text"
            placeholder="جستجوی نود بر اساس نام سرویس یا ایمیج..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-950 pr-9 pl-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-purple-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full sm:w-auto rounded-xl border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-300 focus:border-purple-500 focus:outline-none cursor-pointer truncate"
          >
            <option value="all">همه وضعیت‌ها</option>
            <option value="healthy">آنلاین و فعال</option>
            <option value="deploying">در حال دپلوی/بیلد</option>
            <option value="stopped">متوقف شده</option>
            <option value="crashed">دارای خطا</option>
            <option value="sleeping">خواب (SLEEPING)</option>
          </select>
        </div>
      </div>

      {/* Services Cards List */}
      {filteredServices.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-neutral-800 bg-neutral-900/40 p-8 sm:p-12 text-center max-w-full">
          <div className="h-12 w-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center mx-auto mb-3">
            <Server className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-white mb-1">هیچ سرویسی در این نمای یافت نشد</h3>
          <p className="text-xs text-neutral-400 max-w-md mx-auto mb-4">
            می‌توانید با استفاده از یکی از ۷ روش رسمی API ریلوی سرویس جدید دیپلوی کنید.
          </p>
          <button
            onClick={onOpenDeploy}
            className="rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 transition shadow-lg shadow-purple-600/20"
          >
            دیپلوی اولین سرویس
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 max-w-full overflow-hidden">
          {filteredServices.map((srv) => {
            const parentAccount = accounts.find((a) => a.id === srv.accountId);
            const isHealthy = srv.status === 'healthy';
            const isStopped = srv.status === 'stopped';
            const isCrashed = srv.status === 'crashed';
            const isDeploying = srv.status === 'deploying';
            const isSleeping = srv.status === 'sleeping';

            return (
              <div
                key={srv.id}
                className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 backdrop-blur-md transition-all hover:border-neutral-700 flex flex-col justify-between max-w-full overflow-hidden"
              >
                <div>
                  {/* Top Bar Tag & Status */}
                  <div className="flex items-center justify-between gap-1 mb-2.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: parentAccount?.color || '#8B5CF6' }}
                      />
                      <span className="text-[10px] text-neutral-400 truncate max-w-[110px]">
                        {parentAccount?.name || 'حذف شده'}
                      </span>
                    </div>

                    {isHealthy && (
                      <span className="rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[9px] font-semibold flex items-center gap-1 shrink-0">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        آنلاین
                      </span>
                    )}
                    {isDeploying && (
                      <span className="rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 text-[9px] font-semibold flex items-center gap-1 shrink-0">
                        <RotateCw className="h-2.5 w-2.5 animate-spin" />
                        در حال بیلد
                      </span>
                    )}
                    {isStopped && (
                      <span className="rounded-full bg-neutral-800 text-neutral-400 border border-neutral-700 px-2 py-0.5 text-[9px] font-medium shrink-0">
                        متوقف
                      </span>
                    )}
                    {isCrashed && (
                      <span className="rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 text-[9px] font-bold flex items-center gap-1 shrink-0">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        خطای اجرا
                      </span>
                    )}
                    {isSleeping && (
                      <span className="rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2 py-0.5 text-[9px] font-semibold shrink-0">
                        خواب
                      </span>
                    )}
                  </div>

                  {/* Real Railway deployment status (refreshed by project sync) */}
                  <div className="flex items-center gap-1.5 mb-2 -mt-1 text-[9px] font-mono text-neutral-500">
                    <span>railway:</span>
                    <span className={`font-bold ${railStatusColor(srv)}`}>
                      {srv.deploymentStopped ? 'STOPPED' : srv.deploymentStatus || '—'}
                    </span>
                    {srv.deploymentStatusAt && <span>· {railTimeAgo(srv.deploymentStatusAt)}</span>}
                  </div>

                  {/* Live deploy-job strip for THIS service (independent of header banner, survives refresh/tab switch) */}
                  {(() => {
                    const cardState = serviceDeployStates[srv.id] || (deployJob?.serviceId === srv.id ? deployJob : null);
                    if (!cardState) return null;
                    return (
                      <div
                        className={`mb-2.5 flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-medium ${
                          cardState.status === 'running'
                            ? 'bg-sky-500/10 border-sky-500/30 text-sky-300'
                            : cardState.status === 'success'
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                        }`}
                      >
                        {cardState.status === 'running' ? (
                          <RotateCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
                        ) : cardState.status === 'success' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                        )}
                        <span className="truncate flex-1 font-mono text-[11px]" title={cardState.phase}>
                          {cardState.phase}
                        </span>
                        {cardState.domain && (
                          <a
                            href={`https://${cardState.domain}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[9px] bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 rounded-lg text-emerald-200 shrink-0 hover:bg-emerald-500/30 transition"
                          >
                            دامنه
                          </a>
                        )}
                        <button
                          onClick={() => {
                            setServiceDeployState(srv.id, null);
                            if (deployJob?.serviceId === srv.id) setDeployJob(null);
                          }}
                          title="بستن اعلان دیپلوی"
                          className="shrink-0 rounded-md p-0.5 text-current opacity-50 hover:opacity-100 transition"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })()}

                  {/* Title & Domain */}
                  <div className="flex items-start gap-2.5 mb-3">
                    <div className="text-2xl p-2 rounded-xl bg-neutral-950 border border-neutral-800 shrink-0">
                      <ServiceIcon icon={srv.icon} alt={srv.name} imgClassName="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-extrabold text-white text-sm truncate">{srv.name}</h3>
                      <div className="text-[10px] font-mono text-neutral-400 truncate mt-0.5">
                        {srv.imageOrRepo}
                      </div>
                      {srv.domains && srv.domains.length > 0 && (
                        <a
                          href={`https://${domainLabel(srv.domains[0])}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300 mt-1 truncate"
                        >
                          <Globe className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{domainLabel(srv.domains[0])}</span>
                          {srv.domains.length > 1 && (
                            <span className="text-neutral-500 shrink-0">+{srv.domains.length - 1}</span>
                          )}
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Live Metrics Gauge Bars */}
                  <div className="space-y-2 my-3 bg-neutral-950/80 rounded-xl p-2.5 border border-neutral-800/80 text-[11px]">
                    <div>
                      <div className="flex justify-between text-neutral-400 mb-0.5 text-[10px]">
                        <span>مصرف CPU</span>
                        <span className="font-mono text-white font-bold">{srv.cpuUsage}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-neutral-900 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-purple-500 transition-all duration-300"
                          style={{ width: `${Math.min(100, srv.cpuUsage)}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-neutral-400 mb-0.5 text-[10px]">
                        <span>رم (RAM)</span>
                        <span className="font-mono text-white font-bold">{srv.memoryUsage}MB / {srv.memoryLimit}MB</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-neutral-900 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                          style={{ width: `${Math.min(100, (srv.memoryUsage / srv.memoryLimit) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer Toolbar Controls */}
                <div className="pt-2.5 border-t border-neutral-800 flex items-center justify-between gap-1 flex-wrap">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setSelectedEnvService(srv)}
                      className="rounded-lg border border-neutral-800 bg-neutral-950 p-1.5 text-neutral-400 hover:text-white hover:border-neutral-700 transition"
                      title="مدیریت متغیرهای محیطی (variableUpsert)"
                    >
                      <Sliders className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setSelectedDomainService(srv);
                        const firstPort = (srv.domains || []).find((d) => d.targetPort)?.targetPort;
                        if (firstPort) setTargetPortInput(Number(firstPort));
                      }}
                      className="rounded-lg border border-neutral-800 bg-neutral-950 p-1.5 text-neutral-400 hover:text-purple-400 hover:border-neutral-700 transition"
                      title="تنظیم دامنه (serviceDomainCreate / customDomainCreate / delete)"
                    >
                      <Globe className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setSelectedBuildConfigService(srv)}
                      className="rounded-lg border border-neutral-800 bg-neutral-950 p-1.5 text-neutral-400 hover:text-amber-400 hover:border-neutral-700 transition"
                      title="تنظیمات بیلد و نحوه اجرا (serviceInstanceUpdate)"
                    >
                      <Wrench className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setSelectedVolumeService(srv)}
                      className="rounded-lg border border-neutral-800 bg-neutral-950 p-1.5 text-neutral-400 hover:text-sky-400 hover:border-neutral-700 transition"
                      title="ایجاد دیسک پایدار Volume (volumeCreate)"
                    >
                      <HardDrive className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => openDeployLogs(srv)}
                      className="rounded-lg border border-neutral-800 bg-neutral-950 p-1.5 text-neutral-400 hover:text-emerald-400 hover:border-emerald-500/30 transition"
                      title="لاگ‌های دیپلوی این سرویس (deploymentLogs)"
                    >
                      <Terminal className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => runCardAction(srv, restartService, 'درخواست ری‌استارت به ریلوی ارسال شد.')}
                      className="rounded-lg border border-neutral-800 bg-neutral-950 p-1.5 text-neutral-400 hover:text-amber-400 hover:border-amber-500/30 transition"
                      title="ری‌استارت سرویس (deploymentRestart)"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => runCardAction(srv, redeployService, 'دیپلوی مجدد در ریلوی صف شد.')}
                      className="rounded-lg border border-neutral-800 bg-neutral-950 p-1.5 text-neutral-400 hover:text-purple-400 hover:border-purple-500/30 transition"
                      title="دیپلوی مجدد (deploymentRedeploy)"
                    >
                      <Rocket className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() =>
                        runCardAction(srv, updateSourceService, 'آپدیت از آخرین سورس در ریلوی صف شد.')
                      }
                      className="rounded-lg border border-neutral-800 bg-neutral-950 p-1.5 text-neutral-400 hover:text-emerald-400 hover:border-emerald-500/30 transition"
                      title="آپدیت دستی از آخرین سورس (ایمیج: serviceInstanceRedeploy · ریپو: serviceInstanceDeploy + latestCommit)"
                    >
                      <DownloadCloud className="h-3.5 w-3.5" />
                    </button>

                    {isHealthy ? (
                      <button
                        onClick={() => runCardAction(srv, stopService, 'سرویس روی ریلوی متوقف شد.')}
                        className="rounded-lg border border-neutral-800 bg-neutral-950 p-1.5 text-neutral-400 hover:text-rose-400 hover:border-rose-500/30 transition"
                        title="توقف سرویس (deploymentStop)"
                      >
                        <Square className="h-3.5 w-3.5 fill-current" />
                      </button>
                    ) : (
                      <button
                        onClick={() => runCardAction(srv, startService, 'روشن کردن سرویس در ریلوی ارسال شد.')}
                        className="rounded-lg border border-neutral-800 bg-neutral-950 p-1.5 text-emerald-400 hover:bg-emerald-500/10 transition"
                        title="روشن کردن سرویس (deploymentRestart)"
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
                      </button>
                    )}

                    <button
                      onClick={() => {
                        // First click arms the confirm; second click (within 3s)
                        // really deletes the service on Railway.
                        if (confirmDeleteId !== srv.id) {
                          setConfirmDeleteId(srv.id);
                          setTimeout(() => setConfirmDeleteId((cur) => (cur === srv.id ? null : cur)), 3000);
                          return;
                        }
                        setConfirmDeleteId(null);
                        void runCardAction(srv, deleteService, 'سرویس روی ریلوی حذف شد.');
                      }}
                      className={
                        confirmDeleteId === srv.id
                          ? 'rounded-lg border border-rose-500 bg-rose-500/20 p-1.5 text-rose-300 transition animate-pulse'
                          : 'rounded-lg border border-neutral-800 bg-neutral-950 p-1.5 text-neutral-400 hover:text-rose-400 hover:border-rose-500/30 transition'
                      }
                      title={
                        confirmDeleteId === srv.id
                          ? 'کلیک دوباره = حذف قطعی از ریلوی'
                          : 'حذف سرویس (serviceDelete)'
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Lifecycle action toast (restart/redeploy/stop/delete result) */}
      {cardActionToast && (
        <div
          className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] rounded-xl border px-4 py-2.5 text-xs font-semibold shadow-2xl backdrop-blur-md max-w-[90vw] ${
            cardActionToast.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-950/90 text-emerald-300'
              : 'border-rose-500/30 bg-rose-950/90 text-rose-300'
          }`}
          role="status"
        >
          {cardActionToast.text}
        </div>
      )}

      {/* 1. Environment Variables Modal (variableUpsert / variableDelete) */}
      {selectedEnvService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-md animate-in fade-in">
          <div className="w-[94vw] max-w-xl rounded-3xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Sliders className="h-5 w-5 text-purple-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">متغیرهای محیطی {selectedEnvService.name}</h3>
                  <p className="text-[10px] text-neutral-400 font-mono">variableUpsert & variableDelete API</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedEnvService(null)}
                className="rounded-xl border border-neutral-800 p-1 text-neutral-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Add Variable Row */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="کلید (مثال: DATABASE_URL)"
                  value={varKeyInput}
                  onChange={(e) => setVarKeyInput(e.target.value)}
                  className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-1.5 font-mono text-xs text-white focus:border-purple-500 focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="مقدار (مثال: postgres://...)"
                  value={varValInput}
                  onChange={(e) => setVarValInput(e.target.value)}
                  className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-1.5 font-mono text-xs text-white focus:border-purple-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between bg-neutral-950 p-2.5 rounded-xl border border-neutral-800 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-neutral-300">
                  <input
                    type="checkbox"
                    checked={skipDeploysToggle}
                    onChange={(e) => setSkipDeploysToggle(e.target.checked)}
                    className="rounded accent-purple-600"
                  />
                  <span>skipDeploys (اعمال متغیر بدون ری‌استارت فوری)</span>
                </label>

                <button
                  onClick={handleAddVariable}
                  disabled={isSavingVar || !varKeyInput.trim()}
                  className="rounded-xl bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 transition disabled:opacity-50"
                >
                  افزودن متغیر
                </button>
              </div>

              {/* Current Variables List */}
              <div className="border border-neutral-800 rounded-2xl bg-neutral-950 p-3 space-y-2 max-h-56 overflow-y-auto">
                <span className="text-[11px] font-bold text-neutral-400 block mb-1">لیست متغیرهای فعال:</span>
                {Object.entries(selectedEnvService.envVars || {}).length === 0 ? (
                  <p className="text-xs text-neutral-500 text-center py-4">هیچ متغیری هنوز ست نشده است.</p>
                ) : (
                  Object.entries(selectedEnvService.envVars || {}).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between bg-neutral-900/80 p-2 rounded-xl text-xs font-mono border border-neutral-800">
                      <div className="truncate min-w-0 mr-2">
                        <span className="text-purple-300 font-bold">{k}</span>
                        <span className="text-neutral-500 mx-1.5">=</span>
                        <span className="text-emerald-400">{v}</span>
                      </div>
                      <button
                        onClick={() => handleDeleteVariable(k)}
                        className="text-neutral-500 hover:text-rose-400 shrink-0"
                        title="حذف متغیر"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Domain Management Modal (serviceDomainCreate / customDomainCreate) */}
      {selectedDomainService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-md animate-in fade-in">
          <div className="w-[94vw] max-w-lg rounded-3xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-purple-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">مدیریت دامنه‌ها و SSL {selectedDomainService.name}</h3>
                  <p className="text-[10px] text-neutral-400 font-mono">serviceDomainCreate & customDomainCreate API</p>
                </div>
              </div>
              <button
                onClick={() => { setSelectedDomainService(null); setDnsRecordsInfo(null); }}
                className="rounded-xl border border-neutral-800 p-1 text-neutral-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Option A: Free Subdomain */}
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">۱. ایجاد زیردامنه رایگان (*.up.railway.app)</span>
                  <button
                    onClick={handleCreateFreeSubdomain}
                    disabled={isCreatingDomain}
                    className="rounded-xl bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 transition disabled:opacity-50"
                  >
                    ساخت زیردامنه رایگان
                  </button>
                </div>
              </div>

              {/* Option B: Custom Domain */}
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3.5 space-y-2.5">
                <span className="text-xs font-bold text-white block">۲. اتصال دامنه اختصاصی (Custom Domain)</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="مثال: api.example.com"
                    value={customDomainInput}
                    onChange={(e) => setCustomDomainInput(e.target.value)}
                    className="flex-1 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 font-mono text-xs text-white focus:border-purple-500 focus:outline-none"
                  />
                  <button
                    onClick={handleCreateCustomDomain}
                    disabled={isCreatingDomain || !customDomainInput.trim()}
                    className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition disabled:opacity-50 shrink-0"
                  >
                    اتصال دامنه
                  </button>
                </div>

                {/* DNS Records Instructions */}
                {dnsRecordsInfo && (
                  <div className="mt-3 bg-neutral-900/90 rounded-xl p-3 border border-neutral-800 text-[11px] font-mono space-y-1">
                    <span className="text-amber-400 font-bold block mb-1">تنظیمات CNAME در DNS Provider:</span>
                    {dnsRecordsInfo.map((r, i) => (
                      <div key={i} className="text-neutral-300">
                        Type: <span className="text-purple-300">{r.type}</span> | Name: <span className="text-emerald-400">{r.name}</span> | Value: <span className="text-sky-300">{r.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Active Domains List */}
              <div className="border border-neutral-800 rounded-2xl bg-neutral-950 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-neutral-400">
                    دامنه‌های متصل فعال ({selectedDomainService.domains?.length || 0})
                  </span>
                  <button
                    onClick={handleRefreshDomains}
                    disabled={isRefreshingDomains}
                    className="flex items-center gap-1 rounded-lg border border-neutral-800 px-2 py-1 text-[10px] text-neutral-300 hover:text-white hover:border-neutral-600 transition disabled:opacity-50"
                    title="بازخوانی دامنه‌ها از ریلوی"
                  >
                    <RotateCw className={`h-3 w-3 ${isRefreshingDomains ? 'animate-spin' : ''}`} />
                    بروزرسانی
                  </button>
                </div>

                {domainError && (
                  <div className="mb-2 rounded-xl bg-rose-500/10 border border-rose-500/30 p-2 text-[11px] text-rose-300">
                    {domainError}
                  </div>
                )}

                {!selectedDomainService.domains?.length && !isRefreshingDomains && (
                  <p className="text-[11px] text-neutral-500 py-2 text-center">
                    دامنه‌ای روی این سرویس ثبت نشده است.
                  </p>
                )}

                {selectedDomainService.domains?.map((d) => {
                  const entry = typeof d === 'string' ? null : d;
                  const label = domainLabel(d);
                  return (
                    <div
                      key={entry?.id || label}
                      className="flex items-center justify-between gap-2 text-xs font-mono bg-neutral-900 p-2 rounded-xl border border-neutral-800 mb-1"
                    >
                      <div className="min-w-0 flex-1">
                        <a
                          href={`https://${label}`}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-purple-300 hover:text-purple-200"
                        >
                          {label}
                        </a>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                              entry?.kind === 'custom'
                                ? 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30'
                                : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                            }`}
                          >
                            {entry?.kind === 'custom' ? 'Custom' : 'Railway'}
                          </span>
                          {entry?.targetPort ? (
                            <span className="text-[9px] text-neutral-400">port {entry.targetPort}</span>
                          ) : null}
                        </div>
                      </div>
                      {entry?.id && (
                        <button
                          onClick={() => handleDeleteDomain(entry)}
                          disabled={isCreatingDomain}
                          className="shrink-0 rounded-lg border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-400 hover:bg-rose-500/20 transition disabled:opacity-50"
                          title="حذف دامنه از ریلوی"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Build & Run Config Modal (serviceInstanceUpdate) */}
      {selectedBuildConfigService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-md animate-in fade-in">
          <div className="w-[94vw] max-w-lg rounded-3xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-amber-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">تنظیمات بیلد و اجرای {selectedBuildConfigService.name}</h3>
                  <p className="text-[10px] text-neutral-400 font-mono">serviceInstanceUpdate API</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedBuildConfigService(null)}
                className="rounded-xl border border-neutral-800 p-1 text-neutral-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-neutral-300 font-medium mb-1">انتخاب موتور بیلد (Builder)</label>
                <select
                  value={builder}
                  onChange={(e) => setBuilder(e.target.value)}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-white font-mono focus:border-purple-500 focus:outline-none"
                >
                  <option value="NIXPACKS">NIXPACKS (توصیه شده)</option>
                  <option value="HEROKU">HEROKU BUILDPACKS</option>
                  <option value="PAKETO">PAKETO</option>
                  <option value="RAILPACK">RAILPACK</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-300 font-medium mb-1">دستور بیلد (Build Command)</label>
                  <input
                    type="text"
                    value={buildCommand}
                    onChange={(e) => setBuildCommand(e.target.value)}
                    placeholder="npm run build"
                    className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-white focus:border-purple-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-neutral-300 font-medium mb-1">دستور اجرا (Start Command)</label>
                  <input
                    type="text"
                    value={startCommand}
                    onChange={(e) => setStartCommand(e.target.value)}
                    placeholder="npm start"
                    className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-white focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-300 font-medium mb-1">مسیر Healthcheck</label>
                  <input
                    type="text"
                    value={healthcheckPath}
                    onChange={(e) => setHealthcheckPath(e.target.value)}
                    placeholder="/health"
                    className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-white focus:border-purple-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-neutral-300 font-medium mb-1">Root Directory (Monorepo)</label>
                  <input
                    type="text"
                    value={rootDirectory}
                    onChange={(e) => setRootDirectory(e.target.value)}
                    placeholder="apps/web"
                    className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-white focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-neutral-800">
                <button
                  onClick={() => setSelectedBuildConfigService(null)}
                  className="rounded-xl border border-neutral-800 px-3.5 py-1.5 text-neutral-400 hover:text-white"
                >
                  انصراف
                </button>
                <button
                  onClick={handleSaveInstanceConfig}
                  disabled={isSavingConfig}
                  className="rounded-xl bg-purple-600 px-4 py-1.5 font-bold text-white hover:bg-purple-500 transition disabled:opacity-50"
                >
                  ذخیره تنظیمات بیلد
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Persistent Volume Modal (volumeCreate) */}
      {selectedVolumeService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-md animate-in fade-in">
          <div className="w-[92vw] max-w-md rounded-3xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-sky-400" />
                <h3 className="text-sm font-bold text-white">ایجاد دیسک پایدار Volume</h3>
              </div>
              <button
                onClick={() => setSelectedVolumeService(null)}
                className="rounded-xl border border-neutral-800 p-1 text-neutral-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block text-neutral-300 font-medium mb-1">مسیر Mount Path روی کانتینر</label>
                <input
                  type="text"
                  value={mountPathInput}
                  onChange={(e) => setMountPathInput(e.target.value)}
                  placeholder="/app/data"
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-white focus:border-purple-500 focus:outline-none"
                />
                <p className="text-[10px] text-neutral-500 mt-1">
                  پیش‌فرض <span className="font-mono text-neutral-400">/app/data</span> — باید با مسیری که اپ
                  رویش می‌نویسد یکی باشد (مثلاً <span className="font-mono text-neutral-400">/data</span> یا{' '}
                  <span className="font-mono text-neutral-400">/var/lib/app</span>).
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-neutral-800">
                <button
                  onClick={() => setSelectedVolumeService(null)}
                  className="rounded-xl border border-neutral-800 px-3.5 py-1.5 text-neutral-400 hover:text-white"
                >
                  انصراف
                </button>
                <button
                  onClick={handleCreateVolumeSubmit}
                  disabled={isCreatingVolume}
                  className="rounded-xl bg-purple-600 px-4 py-1.5 font-bold text-white hover:bg-purple-500 transition"
                >
                  ایجاد دیسک Volume
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Deploy Logs Modal (deploymentLogs) */}
      {selectedLogService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-md animate-in fade-in">
          <div className="w-[94vw] max-w-3xl rounded-3xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between gap-2 border-b border-neutral-800 pb-3 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <Terminal className="h-5 w-5 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">
                    لاگ‌های دیپلوی {selectedLogService.name}
                  </h3>
                  <p className="text-[10px] text-neutral-500 font-mono truncate" dir="ltr">
                    {selectedLogService.latestDeploymentId || 'no deployment'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${railStatusColor(selectedLogService)}`}
                >
                  {selectedLogService.deploymentStatus || 'نامشخص'}
                </span>
                <button
                  onClick={() => loadDeployLogs(selectedLogService)}
                  disabled={isLoadingLogs}
                  title="تازه‌سازی لاگ"
                  className="rounded-lg border border-neutral-800 p-1.5 text-neutral-400 hover:text-white hover:border-neutral-700 transition disabled:opacity-50"
                >
                  <RotateCw className={`h-3.5 w-3.5 ${isLoadingLogs ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => setSelectedLogService(null)}
                  title="بستن"
                  className="rounded-lg border border-neutral-800 p-1.5 text-neutral-400 hover:text-white hover:border-neutral-700 transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div
              ref={logsScrollRef}
              className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-3 font-mono text-[11px] space-y-1"
            >
              {isLoadingLogs ? (
                <div className="py-10 text-center text-xs text-neutral-400">
                  در حال دریافت لاگ از ریلوی...
                </div>
              ) : logsError ? (
                <div className="py-10 text-center text-xs text-amber-400/90 px-4 leading-relaxed">
                  {logsError}
                </div>
              ) : deployLogs.length === 0 ? (
                <div className="py-10 text-center text-xs text-neutral-500">
                  لاگی برای این استقرار برگردانده نشد.
                </div>
              ) : (
                deployLogs.map((log: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 leading-relaxed">
                    <span className="shrink-0 select-none text-neutral-600 tabular-nums">
                      {deployLogTime(log?.timestamp)}
                    </span>
                    <span
                      className={`w-[54px] shrink-0 text-[9px] font-bold uppercase pt-[3px] ${deployLogSeverityClass(
                        log?.severity
                      )}`}
                    >
                      {log?.severity || ''}
                    </span>
                    <span className="min-w-0 whitespace-pre-wrap break-all text-neutral-300">
                      {log?.message ?? ''}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 7. Project Volumes Modal (project.volumes + volumeDelete) */}
      {volumeProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-md animate-in fade-in">
          <div className="w-[92vw] max-w-lg rounded-3xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <HardDrive className="h-5 w-5 text-sky-400 shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">
                    Volume های {volumeProject.name}
                  </h3>
                  <p className="text-[10px] text-neutral-500 truncate">
                    حذف Volume = پاک شدن کل داده‌های روی دیسک
                  </p>
                </div>
              </div>
              <button
                onClick={async () => {
                  if (volumeProject) await loadVolumeInstances(volumeProject);
                  const acc = accounts.find((a) => a.id === volumeProject.accountId) || targetAccount;
                  if (acc) await syncAccountProjects(acc.id);
                }}
                title="تازه‌سازی وضعیت Volume از ریلوی"
                className="rounded-xl border border-neutral-800 p-1 text-neutral-400 hover:text-white"
              >
                <RotateCw className={`h-4 w-4 ${isLoadingInstances ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setVolumeProjectId(null)}
                className="rounded-xl border border-neutral-800 p-1 text-neutral-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {volumeError && (
              <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-950/60 px-3 py-2 text-[11px] text-rose-300">
                {volumeError}
              </div>
            )}

            {instancesError && (
              <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-950/60 px-3 py-2 text-[11px] text-amber-300">
                {instancesError} — وضعیت از روی لیست پروژه نمایش داده می‌شود.
              </div>
            )}

            {isLoadingInstances && volumeRows.length === 0 ? (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-8 text-center text-xs text-neutral-400">
                در حال دریافت وضعیت Volume از ریلوی...
              </div>
            ) : volumeRows.length === 0 ? (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-8 text-center text-xs text-neutral-500">
                Volume فعالی در این پروژه نیست.
              </div>
            ) : (
              <>
                {volumeRows.some((r) => r.isPendingDeletion) && (
                  <div className="mb-2 rounded-xl border border-amber-500/25 bg-amber-950/40 px-3 py-2 text-[10px] leading-relaxed text-amber-300/90">
                    ریلوی حذف را نرم انجام می‌دهد: رکوردِ حذف‌شده تا ۴۸ ساعت دیده می‌شود و بعد از تاریخ
                    مندرج برای همیشه پاک می‌شود.
                  </div>
                )}

                <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-0.5">
                  {volumeRows.map((vol) => {
                    const isConfirming = confirmDeleteVolumeId === vol.id;
                    const pending = !!vol.isPendingDeletion;
                    const badge = volumeStatusBadge(vol);
                    const purgeDate = pending && vol.deletedAt
                      ? new Date(vol.deletedAt).toLocaleDateString('fa-IR')
                      : null;
                    return (
                      <div
                        key={vol.id}
                        className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-white truncate">{vol.name}</span>
                              <span
                                className={`shrink-0 rounded border px-1.5 py-px text-[9px] font-semibold ${badge.cls}`}
                              >
                                {badge.label}
                              </span>
                            </div>
                            <div className="truncate text-[10px] text-neutral-500 font-mono" dir="ltr">
                              {vol.id}
                            </div>
                          </div>

                          <button
                            onClick={() => {
                              // First click arms the confirm; second (within 3s) deletes.
                              if (isConfirming) {
                                void handleDeleteVolume(vol.id);
                                return;
                              }
                              setConfirmDeleteVolumeId(vol.id);
                              setTimeout(
                                () => setConfirmDeleteVolumeId((cur) => (cur === vol.id ? null : cur)),
                                3000
                              );
                            }}
                            disabled={isDeletingVolume || pending}
                            className={
                              isConfirming
                                ? 'shrink-0 rounded-lg border border-rose-500 bg-rose-500/20 px-2.5 py-1.5 text-[11px] font-bold text-rose-300 animate-pulse'
                                : 'shrink-0 rounded-lg border border-neutral-800 px-2 py-1.5 text-neutral-400 hover:border-rose-500/40 hover:text-rose-400 transition disabled:opacity-40'
                            }
                            title={
                              pending
                                ? 'قبلاً در صف حذف است — تا ۴۸ ساعت دیگر پاک می‌شود'
                                : isConfirming
                                  ? 'کلیک دوباره = حذف قطعی Volume و همه داده‌هایش'
                                  : 'حذف Volume (volumeDelete)'
                            }
                          >
                            {isConfirming ? (
                              'حذف قطعی؟'
                            ) : isDeletingVolume ? (
                              <RotateCw className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-neutral-500">
                          {vol.mountPath && (
                            <span className="font-mono" dir="ltr">
                              {vol.mountPath}
                            </span>
                          )}
                          {typeof vol.sizeMB === 'number' && (
                            <span className="font-mono" dir="ltr">
                              {vol.currentSizeMB ?? 0}MB / {vol.sizeMB}MB
                            </span>
                          )}
                          {vol.region && <span dir="ltr">{vol.region}</span>}
                          {purgeDate && <span>حذف نهایی: {purgeDate}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div className="mt-4 flex justify-end border-t border-neutral-800 pt-3">
              <button
                onClick={() => setVolumeProjectId(null)}
                className="rounded-xl border border-neutral-800 px-3.5 py-1.5 text-xs text-neutral-400 hover:text-white"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Project Modal */}
      {isNewProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-md animate-in fade-in">
          <div className="w-[92vw] max-w-md rounded-3xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <FolderGit2 className="h-5 w-5 text-purple-400" />
                <h3 className="text-sm font-bold text-white">ایجاد پروژه جدید در Railway</h3>
              </div>
              <button
                onClick={() => setIsNewProjectModalOpen(false)}
                className="rounded-xl border border-neutral-800 p-1 text-neutral-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

<form onSubmit={handleCreateProjectSubmit} className="space-y-3.5">
              {targetAccount?.projectLimit != null && (
                <div className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-[11px]">
                  <span className="text-neutral-400">سقف پروژه این پلن</span>
                  <span className={`font-mono font-semibold ${atProjectLimit ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {liveProjectsCount} از {targetAccount.projectLimit}
                    {targetAccount.isTrialing ? ' (Trial)' : ''}
                  </span>
                </div>
              )}

              {atProjectLimit && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    این اکانت به سقف پروژه پلن
                    {targetAccount.isTrialing ? ' تریال' : ' خود'} رسیده است. برای ساخت پروژه بیشتر باید پلن را ارتقا دهید
                    یا این سقف با تغییر پلن در ریلوی بهروز میشود.
                  </span>
                </div>
              )}

              {createProjectError && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{createProjectError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1">
                  نام پروژه <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="مثال: Production Telegram Bots"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white focus:border-purple-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1">
                  توضیحات (اختیاری)
                </label>
                <input
                  type="text"
                  placeholder="پروژه مدیریت رباتها و سرورهای بکاند"
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white focus:border-purple-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={() => setIsNewProjectModalOpen(false)}
                  className="rounded-xl border border-neutral-800 px-3.5 py-1.5 text-xs text-neutral-400 hover:text-white"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isCreatingProject || atProjectLimit}
                  className="flex items-center gap-1.5 rounded-xl bg-purple-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreatingProject ? (
                    <>
                      <RotateCw className="h-3.5 w-3.5 animate-spin" />
                      در حال ساخت پروژه...
                    </>
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5" />
                      ساخت پروژه
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
