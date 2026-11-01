import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Zap,
  CheckCircle2,
  AlertCircle,
  RotateCw,
  FolderGit2,
  Container,
  FileCode2,
  Terminal,
  Webhook,
  Bot,
  Plus,
  Copy,
  Check,
  FolderUp,
  FileArchive,
  Loader2,
} from 'lucide-react';
import { useHub, useBackHandler } from '../context/HubContext';
import { normalizeGitHubRepo, extractApiError } from '../utils/githubRepo';
import { RailwayServiceDomain } from '../types';
import { buildSourceTarball, formatBytes, stripCommonRoot } from '../utils/sourceBundle';
import {
  collectIgnorePatterns,
  extractEnvFromEntries,
  isRailwayManagedVariable,
  isSensitiveFile,
  readSourceSelection,
  SourceEntry,
} from '../utils/sourceFiles';
import {
  deployGitHubRepoRailway,
  deployDockerComposeRailway,
  createServiceRailway,
  getGitHubRepoInfo,
  getRailwayDeployments,
  getRailwayDeploymentLogs,
  getRailwayBuildLogs,
  createRailwaySubdomain,
  uploadRailwaySource,
  upsertRailwayVariable,
} from '../services/railwayApi';

interface DeployModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DeployModal: React.FC<DeployModalProps> = ({ isOpen, onClose }) => {
  useBackHandler(isOpen, onClose);

  const {
    accounts,
    activeAccountId,
    deployService,
    syncAccountProjects,
    setDeployJob,
    setServiceDeployState,
  } = useHub();

  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    activeAccountId !== 'all' ? activeAccountId : accounts[0]?.id || ''
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [activeDeployTab, setActiveTabMethod] = useState<
    'github' | 'registry' | 'docker-compose' | 'cli' | 'webhook' | 'agent'
  >('github');

  // GitHub Repo Tab
  const [githubRepo, setGithubRepo] = useState<string>('');
  const [githubBranch, setGithubBranch] = useState<string>('');
  const [branchTouched, setBranchTouched] = useState<boolean>(false);

  // Docker Registry Tab
  const [registryImage, setRegistryImage] = useState<string>('nginx:alpine');
  const [registryPort, setRegistryPort] = useState<number>(80);

  // Docker Compose Tab
  const [composeYaml, setComposeYaml] = useState<string>(
    `version: '3.8'\nservices:\n  web:\n    image: node:20-alpine\n    ports:\n      - "3000:3000"\n    environment:\n      NODE_ENV: production\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret123`
  );

  // Common Fields
  const [serviceName, setServiceName] = useState<string>('my-app-node');
  const [port, setPort] = useState<number>(3000);
  const [envVarsText, setEnvVarsText] = useState<string>('PORT=3000\nNODE_ENV=production');

  // CLI / Source Upload Tab — the archive is built in the browser and posted
  // to Railway's /up endpoint, so no GitHub repo is involved.
  const [sourceMode, setSourceMode] = useState<'folder' | 'zip'>('folder');
  const [sourceEntries, setSourceEntries] = useState<SourceEntry[] | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string>('');
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [isReadingSource, setIsReadingSource] = useState<boolean>(false);
  // Variables read out of the picked .env, shown before the deploy runs.
  const [detectedEnv, setDetectedEnv] = useState<{ vars: Record<string, string>; fileName: string | null }>({
    vars: {},
    fileName: null,
  });
  const [envFromFileEnabled, setEnvFromFileEnabled] = useState(true);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  /** When the current deploy attempt began — the card uses it to ignore an
   *  older deployment of the same service. */
  const deployStartedAt = useRef<number | null>(null);

  // Deploy status
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [deploySuccess, setDeploySuccess] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCli, setCopiedCli] = useState<boolean>(false);
  // Live progress while the Railway build/domain flow runs
  const [deployPhase, setDeployPhase] = useState<string | null>(null);
  const [deployedDomain, setDeployedDomain] = useState<string | null>(null);

  /** Mirrors progress into the global deployJob so the status stays visible
   *  in the header banner. */
  const reportPhase = (phase: string, extra?: { repo?: string; domain?: string; serviceId?: string }) => {
    setDeployPhase(phase);
    setDeployJob((prev) => ({
      status: 'running',
      phase,
      repo: extra?.repo ?? prev?.repo,
      domain: extra?.domain ?? prev?.domain,
      serviceId: extra?.serviceId ?? prev?.serviceId,
    }));
    if (extra?.serviceId) {
      // Preserve startedAt/railwayStatus: the live poller owns those.
      setServiceDeployState(extra.serviceId, {
        status: 'running',
        phase,
        domain: extra.domain,
        startedAt: deployStartedAt.current ?? Date.now(),
      });
    }
  };

  const targetAccount = accounts.find((a) => a.id === selectedAccountId) || accounts[0];
  // Projects that exist on Railway (deleted and legacy hub-local ones excluded)
  const deployableProjects = (targetAccount?.projects || []).filter(
    (p) => !p.isDeletedOnRailway && p.isExternal
  );

  // Follow the globally active account when it changes elsewhere in the app.
  useEffect(() => {
    if (activeAccountId !== 'all' && accounts.some((a) => a.id === activeAccountId)) {
      setSelectedAccountId(activeAccountId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId]);

  // Always keep a valid target project selected for the chosen account.
  useEffect(() => {
    if (deployableProjects.length === 0) {
      setSelectedProjectId('');
      return;
    }
    if (!deployableProjects.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId(deployableProjects[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, accounts]);

  if (!isOpen) return null;

  const targetProjectId = selectedProjectId || deployableProjects[0]?.id || '';
  const targetProject = deployableProjects.find((p) => p.id === targetProjectId);

  /** Throws the first real Railway/proxy error contained in a response. */
  const throwApiError = (res: any, fallback: string) => {
    const msg = extractApiError(res, fallback);
    if (msg) throw new Error(msg);
  };

  /**
   * Real GitHub deploy: normalizes any pasted URL to `owner/repo`, checks the
   * account's access to the repo (and its real default branch), then calls
   * githubRepoDeploy. Returns the serviceId Railway assigned (the mutation's
   * string output) plus resolved project/environment ids for domain creation.
   *
   * Note: when the connected GitHub App account is suspended, the `githubRepo`
   * metadata query fails with "Sorry. Your account was suspended" — but PUBLIC
   * repos still deploy fine via githubRepoDeploy (same as the Railway
   * dashboard). That error must not block the deploy; we only lose the
   * default-branch hint and fall back to the user branch or `main`.
   */
  const deployFromGitHub = async (
    repoInput: string,
    opts: { token: string; projectId: string; branch?: string; preferDefaultBranch: boolean }
  ) => {
    const repo = normalizeGitHubRepo(repoInput);
    if (!repo) {
      throw new Error(
        'آدرس ریپوی گیت‌هاب معتبر نیست. نمونه درست: https://github.com/Kiyarash0090/terminal.git یا owner/repository'
      );
    }

    const info = await getGitHubRepoInfo({ token: opts.token, repo });

    // Access check uses gitHubRepoAccessAvailable — reliable for public repos
    // even when the GitHub App account is suspended.
    const access = info?.githubRepoAccessAvailable || info?.data?.gitHubRepoAccessAvailable || null;
    const ghMetaError: string | null = info?.githubRepoError || null;

    if (access && access.hasAccess === false) {
      throw new Error(
        ghMetaError ||
          'ریلوی به این ریپو دسترسی ندارد. ریپو باید عمومی باشد یا GitHub App اکانت ریلوی به اکانت گیت‌هاب شما وصل باشد.'
      );
    }

    // No access data at all AND a real failure — surface it.
    if (!access && !info?.data?.githubRepo) {
      const msg = ghMetaError || extractApiError(info, '');
      if (msg) throw new Error(msg);
    }

    // Default branch is best-effort: githubRepo dies when the GitHub App
    // account is suspended, but public-repo deploys still work.
    const defaultBranch: string | undefined =
      info?.githubRepo?.defaultBranch || info?.data?.githubRepo?.defaultBranch;
    const branch =
      (!opts.preferDefaultBranch && opts.branch?.trim()) ||
      defaultBranch ||
      opts.branch?.trim() ||
      'main';

    const ghRes = await deployGitHubRepoRailway({
      token: opts.token,
      projectId: opts.projectId,
      repo,
      branch,
    });
    throwApiError(ghRes, 'ریلوی دیپلوی از این ریپو را نپذیرفت');

    // githubRepoDeploy returns a plain string = the new serviceId (not deploymentId).
    const serviceId: string | undefined =
      typeof ghRes?.data?.githubRepoDeploy === 'string' ? ghRes.data.githubRepoDeploy : undefined;

    return {
      repo,
      branch,
      serviceId,
      projectId: ghRes?.resolvedProjectId || opts.projectId,
      environmentId: ghRes?.resolvedEnvironmentId || '',
    };
  };

  /**
   * Polls deployments(input:{projectId}) until Railway reports a terminal
   * status (SUCCESS / FAILED / CRASHED / REMOVED) or the deadline passes.
   * Build times vary (~2 min for small TypeScript apps, up to 5–10 min for
   * larger ones), so we allow 5 minutes and surface status transitions.
   */
  const pollDeploymentUntilSettled = async (opts: {
    token: string;
    projectId: string;
    /** Set for source uploads: the service's OUR deploy must be polled, not
     *  whichever deployment of the project happens to be newest. */
    serviceId?: string | null;
    /** Only deployments created at/after this moment count — otherwise the
     *  project's previous deployment would be mistaken for this deploy. */
    notBefore?: number;
  }): Promise<{ id: string; status: string } | null> => {
    const deadline = Date.now() + 5 * 60 * 1000;
    let lastStatus = '';

    while (Date.now() < deadline) {
      const res = await getRailwayDeployments({ token: opts.token, projectId: opts.projectId });
      throwApiError(res, 'دریافت وضعیت دیپلوی از ریلوی ناموفق بود');

      const edges = res?.data?.deployments?.edges || [];
      const candidates = edges
        .map((edge: any) => edge?.node)
        .filter((node: any) => {
          if (!node?.id || !node?.status) return false;
          if (opts.serviceId && node.serviceId && node.serviceId !== opts.serviceId) return false;
          if (opts.notBefore) {
            const created = new Date(node.createdAt || 0).getTime();
            if (Number.isFinite(created) && created < opts.notBefore) return false;
          }
          return true;
        });
      const latest = candidates[0];
      if (latest?.status && latest.status !== lastStatus) {
        lastStatus = latest.status;
        reportPhase(`وضعیت دیپلوی روی ریلوی: ${latest.status}`);
      }

      if (latest && ['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED'].includes(latest.status)) {
        return latest;
      }

      await new Promise((r) => setTimeout(r, 8000));
    }
    return null;
  };

  /** Fetches the BUILD log tail — the only stream that explains a failed build.
   *  Falls back to the runtime deploymentLogs, which is where a crash after a
   *  successful build writes instead. */
  const fetchDeploymentLogTail = async (token: string, deploymentId: string) => {
    const buildRes = await getRailwayBuildLogs({ token, deploymentId, limit: 300 });
    const buildLogs = buildRes?.data?.buildLogs;

    if (Array.isArray(buildLogs) && buildLogs.length > 0) {
      return buildLogs
        .slice(-40)
        .map((l: any) => (typeof l?.message === 'string' ? l.message.replace(/\r/g, '') : ''))
        .filter(Boolean)
        .join('')
        .slice(-4000);
    }

    const res = await getRailwayDeploymentLogs({ token, deploymentId, limit: 60 });
    const logs = res?.data?.deploymentLogs || [];
    if (!Array.isArray(logs) || logs.length === 0) return '';
    return logs
      .slice(-30)
      .map((l: any) => (typeof l?.message === 'string' ? l.message.replace(/\r/g, '') : ''))
      .filter(Boolean)
      .join('\n');
  };

  /**
   * Full guided flow from the Railway service/domain guide:
   * githubRepoDeploy → poll deployments → on SUCCESS create the free
   * subdomain with the app's targetPort (Railway defaults to 8080; wrong
   * port = deploy SUCCESS but domain 502).
   * Local hub-state update is the caller's job.
   */
  const runGitHubDeployFlow = async (
    repoInput: string,
    opts: { token: string; projectId: string; branch?: string; preferDefaultBranch: boolean; port: number }
  ) => {
    reportPhase('ارسال githubRepoDeploy به ریلوی...');
    const { repo, branch, serviceId, projectId, environmentId } = await deployFromGitHub(repoInput, opts);

    reportPhase('در انتظار بیلد و دیپلوی (INITIALIZING → BUILDING → DEPLOYING)...', {
      repo,
      serviceId,
    });
    const deployment = await pollDeploymentUntilSettled({ token: opts.token, projectId });

    let domain: string | null = null;

    if (!deployment) {
      // Timed out waiting — the deploy may still finish on Railway's side.
      reportPhase('زمان انتظار تمام شد؛ دیپلوی ممکن است هنوز در جریان باشد.');
    } else if (deployment.status !== 'SUCCESS') {
      reportPhase(`دیپلوی با وضعیت ${deployment.status} شکست خورد؛ دریافت لاگ...`);
      const logTail = await fetchDeploymentLogTail(opts.token, deployment.id);
      const detail = logTail ? `\n\n--- لاگ بیلد ---\n${logTail}` : '';
      throw new Error(`دیپلوی روی ریلوی با وضعیت ${deployment.status} شکست خورد.${detail}`);
    } else if (serviceId) {
      reportPhase('ساخت دامنه رایگان (*.up.railway.app) با پورت انتخابی...');
      const domainRes = await createRailwaySubdomain({
        token: opts.token,
        projectId,
        environmentId,
        serviceId,
        targetPort: opts.port,
      });
      throwApiError(domainRes, 'ساخت دامنه روی ریلوی ناموفق بود');
      domain = domainRes?.data?.serviceDomainCreate?.domain || null;
    }

    return { repo, branch, serviceId, projectId, environmentId, domain };
  };

  /** Creates a real (empty) service on Railway — used by the CLI / Webhook /
   *  Agent flows. */
  const createRealService = async (opts: {
    token: string;
    projectId: string;
    name: string;
    image?: string;
    variables: Record<string, string>;
  }) => {
    const res = await createServiceRailway({
      token: opts.token,
      projectId: opts.projectId,
      name: opts.name,
      image: opts.image,
      variables: opts.variables,
    });
    throwApiError(res, 'ساخت سرویس روی ریلوی ناموفق بود');
    return res;
  };

  /** Loads the picked folder / zip into memory so its size can be reported
   *  before the user commits to an upload. */
  const handleSourceSelection = async (
    kind: 'directory' | 'zip',
    files?: FileList | File[],
    zip?: File
  ) => {
    setSourceError(null);
    setIsReadingSource(true);
    try {
      const raw = await readSourceSelection({ kind, files, zip });
      const entries = stripCommonRoot(raw);
      const total = entries.reduce((sum, e) => sum + (e.data ? e.data.length : 0), 0);
      if (total === 0) throw new Error('فایل یا پوشه‌ای برای آپلود پیدا نشد.');
      setSourceEntries(entries);
      setSourceLabel(zip?.name || (entries[0]?.path.split('/')[0] ?? ''));

      // The project's own .env is what actually configures it — fill the
      // variables from it so the user sees them before deploying.
      const detected = extractEnvFromEntries(entries);
      setDetectedEnv(detected);
      if (detected.fileName && Object.keys(detected.vars).length > 0) {
        setEnvFromFileEnabled(true);
        mergeDetectedEnv(detected.vars);
      }
    } catch (err: any) {
      setSourceEntries(null);
      setSourceLabel('');
      setSourceError(err.message || 'خواندن سورس انتخاب‌شده ناموفق بود.');
    } finally {
      setIsReadingSource(false);
    }
  };

  /** Writes the .env values into the variables editor without removing
   *  anything the user typed by hand. */
  const mergeDetectedEnv = (vars: Record<string, string>) => {
    setEnvVarsText((prev) => {
      const current = new Map<string, string>();
      prev.split('\n').forEach((line) => {
        const idx = line.indexOf('=');
        if (idx > 0) current.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
      });
      for (const [key, value] of Object.entries(vars)) {
        // An explicit edit in the box beats the file.
        if (!current.has(key)) current.set(key, value);
      }
      return [...current.entries()].map(([k, v]) => `${k}=${v}`).join('\n');
    });
  };

  const selectedSourceBytes =
    sourceEntries?.reduce((sum, e) => sum + (e.data ? e.data.length : 0), 0) ?? 0;
  const sensitiveFiles = (sourceEntries || [])
    .filter((e) => !e.directory && isSensitiveFile(e.path))
    .map((e) => e.path);

  /**
   * Uploads the archive to Railway's /up endpoint, which creates the service
   * and queues the build. Polling reuses the GitHub flow's deployment list.
   */
  const runSourceDeployFlow = async (opts: {
    token: string;
    projectId: string;
    environmentId?: string;
    serviceId?: string;
    archive: Blob;
    port: number;
    serviceName: string;
    envVars?: Record<string, string>;
    /** Called as soon as Railway has created the service, so its card exists
     *  while the build runs — not only after the whole flow finishes. */
    onServiceCreated?: (info: { serviceId: string; projectId: string; environmentId: string }) => void;
  }) => {
    reportPhase('آپلود آرشیو سورس به ریلوی...');
    // Clock starts before the upload: any deployment listed afterwards belongs
    // to this run, so a previous one can never be mistaken for it.
    const startedAt = Date.now();
    const upload = await uploadRailwaySource({
      token: opts.token,
      projectId: opts.projectId,
      environmentId: opts.environmentId,
      serviceId: opts.serviceId,
      name: opts.serviceName,
      archive: opts.archive,
    });
    if (upload.error) throw new Error(upload.error);

    const projectId = upload.resolvedProjectId || opts.projectId;
    const environmentId = upload.resolvedEnvironmentId || opts.environmentId || '';
    const serviceId = upload.serviceId || opts.serviceId || null;

    // The build starts now. Register the card immediately so the user can
    // watch it instead of seeing nothing until the flow ends.
    if (serviceId) {
      opts.onServiceCreated?.({ serviceId, projectId, environmentId });
    }

    // /up creates the service itself, so the form's variables have to be set
    // on it afterwards. skipDeploys keeps them from restarting the build that
    // this upload just queued.
    // RAILWAY_* is Railway's own ("added by Railway") — sending it back
      // duplicates what Railway already manages.
      const variableEntries = Object.entries(opts.envVars || {}).filter(
        ([key]) => key.trim() && !isRailwayManagedVariable(key)
      );
    if (serviceId && variableEntries.length > 0) {
      reportPhase(`اعمال ${variableEntries.length} متغیر محیطی روی سرویس...`);
      for (const [name, value] of variableEntries) {
        const varRes = await upsertRailwayVariable({
          token: opts.token,
          projectId,
          environmentId,
          serviceId,
          name,
          value,
          skipDeploys: true,
        });
        throwApiError(varRes, `ثبت متغیر محیطی ${name} روی ریلوی ناموفق بود`);
      }
    }

    reportPhase('آپلود انجام شد؛ در انتظار بیلد و دیپلوی (INITIALIZING → BUILDING → DEPLOYING)...', {
      serviceId: serviceId || undefined,
    });
    const deployment = await pollDeploymentUntilSettled({
      token: opts.token,
      projectId,
      serviceId,
      // Allow for clock skew between this machine and Railway.
      notBefore: startedAt - 120_000,
    });

    let domain: string | null = upload.deploymentDomain || null;

    if (!deployment) {
      reportPhase('زمان انتظار تمام شد؛ دیپلوی ممکن است هنوز در جریان باشد.');
    } else if (deployment.status !== 'SUCCESS') {
      reportPhase(`دیپلوی با وضعیت ${deployment.status} شکست خورد؛ دریافت لاگ بیلد...`);
      const logTail = await fetchDeploymentLogTail(opts.token, deployment.id);

      // Attach the failure to the card itself. The header banner expires, so
      // without this the reason a build died would be lost seconds later.
      if (serviceId) {
        setServiceDeployState(serviceId, {
          status: 'error',
          phase: `دیپلوی روی ریلوی شکست خورد (${deployment.status})`,
          railwayStatus: deployment.status,
          deploymentId: deployment.id,
          buildLogs: logTail || undefined,
          startedAt: startedAt,
          updatedAt: Date.now(),
        });
      }

      const detail = logTail ? `\n\n--- لاگ بیلد ---\n${logTail}` : '';
      throw new Error(`دیپلوی سورس روی ریلوی با وضعیت ${deployment.status} شکست خورد.${detail}`);
    } else if (serviceId && !domain) {
      reportPhase('ساخت دامنه رایگان (*.up.railway.app) با پورت انتخابی...');
      const domainRes = await createRailwaySubdomain({
        token: opts.token,
        projectId,
        environmentId,
        serviceId,
        targetPort: opts.port,
      });
      domain = domainRes?.data?.serviceDomainCreate?.domain || null;
    }

    return { projectId, environmentId, serviceId, deployment, domain };
  };

  const handleDeploySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAccount) {
      setErrorMsg('لطفاً ابتدا یک اکانت Railway اضافه کنید.');
      return;
    }

    // Capture current form values
    const chosenAccount = targetAccount;
    const chosenProjectId = targetProjectId;
    const chosenServiceName = serviceName;
    const chosenPort = port;
    const chosenGithubRepo = githubRepo;
    const chosenGithubBranch = githubBranch;
    const chosenBranchTouched = branchTouched;
    const chosenTab = activeDeployTab;
    const chosenComposeYaml = composeYaml;
    const chosenRegistryImage = registryImage;
    const chosenRegistryPort = registryPort;
    const chosenSourceEntries = sourceEntries;

    // Parse env vars
    const envVars: Record<string, string> = {};
    envVarsText.split('\n').forEach((line) => {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        if (key) envVars[key] = val;
      }
    });

    // A source deploy cannot start without a source, and the modal is about to
    // close — so fail here, while the message can still be seen.
    if (chosenTab === 'cli' && (!chosenSourceEntries || chosenSourceEntries.length === 0)) {
      setErrorMsg('ابتدا پوشه پروژه یا فایل zip سورس را انتخاب کنید.');
      return;
    }

    // Checked before uploading: without a real project the hub cannot record
    // the service, so the upload would leave an orphan service on Railway.
    if (!chosenProjectId) {
      setErrorMsg(
        'این اکانت روی ریلوی پروژهای ندارد. یک پروژه در داشبورد ریلوی بسازید و بعد از همگامسازی دوباره تلاش کنید.'
      );
      return;
    }

    // Close the popup immediately as requested
    setIsDeploying(false);
    setErrorMsg(null);
    onClose();

    // Run deployment in the background and update global deployJob
    (async () => {
      try {
        deployStartedAt.current = Date.now();
        setDeployJob({
          status: 'running',
          phase: 'شروع دپلوی روی ریلوی...',
        });

        if (chosenTab === 'cli') {
          if (!chosenSourceEntries) return;

          setDeployJob({
            status: 'running',
            phase: 'ساخت آرشیو gzip از سورس انتخابی...',
          });

          // The new service's id only exists after the upload, so its card has
          // nothing to show during bundling. The running job itself carries the
          // status until then.
          setDeployJob((prev) => (prev ? { ...prev, repo: chosenServiceName } : prev));

          const bundle = await buildSourceTarball(
            chosenSourceEntries,
            collectIgnorePatterns(chosenSourceEntries)
          );

          const flow = await runSourceDeployFlow({
            token: chosenAccount.token,
            projectId: chosenProjectId,
            environmentId: targetProject?.defaultEnvironmentId,
            archive: bundle.blob,
            port: chosenPort,
            serviceName: chosenServiceName,
            envVars,
            onServiceCreated: ({ serviceId, projectId, environmentId }) => {
              // Show the card now, with the build running, instead of waiting
              // for the whole flow to end.
              void deployService(chosenAccount.id, projectId, {
                name: chosenServiceName || 'source-app',
                templateType: 'custom',
                imageOrRepo: `source-upload (${bundle.fileCount} files)`,
                port: chosenPort,
                envVars,
                railwayServiceId: serviceId,
                domains: undefined,
              });
              setServiceDeployState(serviceId, {
                status: 'running',
                phase: 'در حال بیلد',
                startedAt: deployStartedAt.current ?? Date.now(),
                stageTimestamps: { init: Date.now() },
              });
              void environmentId;
            },
          });

          await deployService(chosenAccount.id, flow.projectId || chosenProjectId, {
            name: chosenServiceName || 'source-app',
            templateType: 'custom',
            imageOrRepo: `source-upload (${bundle.fileCount} files)`,
            port: chosenPort,
            envVars,
            railwayServiceId: flow.serviceId || undefined,
            domains: flow.domain
              ? [
                  {
                    id: `deploy-domain-${Date.now()}`,
                    domain: flow.domain,
                    targetPort: chosenPort,
                    kind: 'service',
                    environmentId: flow.environmentId || undefined,
                  } as RailwayServiceDomain,
                ]
              : undefined,
          });

          await syncAccountProjects(chosenAccount.id);

          if (flow.serviceId) {
            setServiceDeployState(flow.serviceId, {
              status: 'success',
              phase: 'دیپلوی موفق',
              domain: flow.domain || undefined,
            });
          }

          setDeployJob({
            status: 'success',
            phase: flow.domain
              ? `دیپلوی سورس موفق — دامنه: ${flow.domain}`
              : 'سورس با موفقیت آپلود و دیپلوی شد',
            domain: flow.domain || undefined,
            serviceId: flow.serviceId || undefined,
          });
        } else if (chosenTab === 'github') {
          setDeployJob({
            status: 'running',
            phase: 'ارسال درخواست دپلوی ریپوزیتوری گیت‌هاب به ریلوی...',
            repo: chosenGithubRepo,
          });

          const flow = await runGitHubDeployFlow(chosenGithubRepo, {
            token: chosenAccount.token,
            projectId: chosenProjectId,
            branch: chosenGithubBranch,
            preferDefaultBranch: !chosenBranchTouched,
            port: chosenPort,
          });

          await deployService(chosenAccount.id, flow.projectId || chosenProjectId, {
            name: chosenServiceName || flow.repo.split('/')[1] || 'github-app',
            templateType: 'custom',
            imageOrRepo: `${flow.repo} @ ${flow.branch}`,
            port: chosenPort,
            envVars,
            railwayServiceId: flow.serviceId,
            domains: flow.domain
              ? [
                  {
                    id: `deploy-domain-${Date.now()}`,
                    domain: flow.domain,
                    targetPort: chosenPort,
                    kind: 'service',
                    environmentId: flow.environmentId || undefined,
                  } as RailwayServiceDomain,
                ]
              : undefined,
          });

          await syncAccountProjects(chosenAccount.id);

          if (flow.serviceId) {
            setServiceDeployState(flow.serviceId, {
              status: 'success',
              phase: 'دیپلوی موفق',
              domain: flow.domain || undefined,
            });
          }

          setDeployJob({
            status: 'success',
            phase: flow.domain
              ? `دیپلوی موفق — دامنه: ${flow.domain}`
              : 'دیپلوی سرویس با موفقیت انجام شد',
            domain: flow.domain || undefined,
            repo: flow.repo,
            serviceId: flow.serviceId,
          });
        } else if (chosenTab === 'docker-compose') {
          setDeployJob({
            status: 'running',
            phase: 'در حال وارد کردن و ساخت سرویس‌های Docker Compose...',
          });

          const dcRes = await deployDockerComposeRailway({
            token: chosenAccount.token,
            projectId: chosenProjectId,
            yaml: chosenComposeYaml,
          });
          throwApiError(dcRes, 'وارد کردن Docker Compose توسط ریلوی نپذیرفته شد');

          const srvRes = await deployService(chosenAccount.id, dcRes?.resolvedProjectId || chosenProjectId, {
            name: chosenServiceName || 'docker-compose-stack',
            templateType: 'docker',
            imageOrRepo: 'docker-compose.yml',
            port: chosenPort,
            envVars,
          });

          await syncAccountProjects(chosenAccount.id);

          setDeployJob({
            status: 'success',
            phase: 'سرویس Docker Compose با موفقیت ساخته شد',
          });
        } else if (chosenTab === 'registry') {
          setDeployJob({
            status: 'running',
            phase: `در حال ساخت سرویس با ایمیج ${chosenRegistryImage}...`,
          });

          const svcRes = await createRealService({
            token: chosenAccount.token,
            projectId: chosenProjectId,
            name: chosenServiceName || 'registry-service',
            image: chosenRegistryImage,
            variables: envVars,
          });

          const svcId = svcRes?.data?.serviceCreate?.id;

          await deployService(chosenAccount.id, svcRes?.resolvedProjectId || chosenProjectId, {
            name: chosenServiceName || 'registry-service',
            templateType: 'docker',
            imageOrRepo: chosenRegistryImage,
            port: chosenRegistryPort,
            envVars,
            railwayServiceId: svcId,
          });

          await syncAccountProjects(chosenAccount.id);

          if (svcId) {
            setServiceDeployState(svcId, {
              status: 'success',
              phase: `سرویس با ایمیج ${chosenRegistryImage} با موفقیت ساخته شد`,
            });
          }

          setDeployJob({
            status: 'success',
            phase: `سرویس با ایمیج ${chosenRegistryImage} با موفقیت ساخته شد`,
            serviceId: svcId,
          });
        } else {
          setDeployJob({
            status: 'running',
            phase: 'در حال ساخت سرویس جدید روی ریلوی...',
          });

          const svcRes = await createRealService({
            token: chosenAccount.token,
            projectId: chosenProjectId,
            name: chosenServiceName || 'empty-service',
            variables: envVars,
          });

          const svcId = svcRes?.data?.serviceCreate?.id;

          await deployService(chosenAccount.id, svcRes?.resolvedProjectId || chosenProjectId, {
            name: chosenServiceName || 'empty-service',
            templateType: 'custom',
            imageOrRepo: 'empty-service',
            port: chosenPort,
            envVars,
            railwayServiceId: svcId,
          });

          await syncAccountProjects(chosenAccount.id);

          if (svcId) {
            setServiceDeployState(svcId, {
              status: 'success',
              phase: 'سرویس روی ریلوی با موفقیت ساخته شد',
            });
          }

          setDeployJob({
            status: 'success',
            phase: 'سرویس روی ریلوی با موفقیت ساخته شد',
            serviceId: svcId,
          });
        }
      } catch (err: any) {
        setDeployJob({
          status: 'error',
          phase: err.message || 'دیپلوی ناموفق بود',
        });
      }
    })();
  };

  const cliTargetProjectId = targetProjectId || 'project-id';
  const copyCliCommand = () => {
    navigator.clipboard.writeText(`railway link -p ${cliTargetProjectId} && railway up`);
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-md modal-backdrop-anim">
      <div className="w-[96vw] max-w-3xl rounded-3xl border border-neutral-800 bg-neutral-900 p-4 sm:p-6 shadow-2xl overflow-y-auto max-h-[92vh] modal-content-anim">

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/30 ring-1 ring-purple-400/30 shrink-0">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black text-white">مرکز دپلوی و ساخت سرویس جدید در Railway</h2>
              <p className="text-[11px] text-neutral-400">
                پشتیبانی از ۶ روش رسمی دیپلوی مستقیم API ریلوی (گیت‌هاب، کامپوز، داکر رجستری و CLI)
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

        {/* Success Screen */}
        {deploySuccess ? (
          <div className="py-12 text-center space-y-3">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 ring-4 ring-emerald-500/10">
              <CheckCircle2 className="h-8 w-8 animate-bounce" />
            </div>
            <h3 className="text-base sm:text-xl font-black text-white">دیپلوی سرویس با موفقیت انجام شد!</h3>
            {deployedDomain ? (
              <div className="mx-auto max-w-md space-y-1.5">
                <p className="text-xs text-neutral-400">دامنه سرویس شما:</p>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(`https://${deployedDomain}`)}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-300 hover:bg-emerald-500/20 transition"
                  title="کپی آدرس"
                >
                  <span dir="ltr">{deployedDomain}</span>
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <p className="text-[11px] text-neutral-500">
                  برای تست: <span className="font-mono" dir="ltr">GET / → 200</span> و{' '}
                  <span className="font-mono" dir="ltr">GET /api/health</span> (اگر اپ سلامتی داشته باشد).
                  پاسخ 502 یعنی پورت دامنه با پورت واقعی اپ هم‌خوان نیست.
                </p>
              </div>
            ) : (
              <p className="text-xs text-neutral-400 max-w-md mx-auto">
                وضعیت نهایی دیپلوی مشخص نشد یا دامنه ساخته نشد. در تب نودها وضعیت سرویس را بررسی کنید.
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleDeploySubmit} className="space-y-4">

            {/* Account Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">
                  اکانت مقصد Railway <span className="text-rose-400">*</span>
                </label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white focus:border-purple-500 focus:outline-none cursor-pointer truncate font-mono"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.email}) — باقی‌مانده: ${acc.creditRemaining.toFixed(2)}
                      {typeof acc.creditExpiresInDays === 'number' ? ` · ${acc.creditExpiresInDays} روز تا انقضا` : ''}
                      {acc.billingPeriodEnd ? ` · ریست: ${new Date(acc.billingPeriodEnd).toLocaleDateString('fa-IR')}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Project Selector — deploy into ANY project of the account */}
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">
                  پروژه مقصد روی ریلوی
                </label>
                <select
                  value={targetProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white focus:border-purple-500 focus:outline-none cursor-pointer truncate font-mono"
                  disabled={deployableProjects.length === 0}
                >
                  {deployableProjects.length === 0 ? (
                    <option value="">— پروژه‌ای موجود نیست؛ هنگام دپلوی ساخته می‌شود —</option>
                  ) : (
                    deployableProjects.map((proj) => (
                      <option key={proj.id} value={proj.id}>
                        {proj.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            {/* Deployment Method Tabs */}
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
                روش دیپلوی سرویس
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 rounded-2xl bg-neutral-950 p-1.5 border border-neutral-800">
                <button
                  type="button"
                  onClick={() => setActiveTabMethod('github')}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2 px-2 text-[11px] font-medium transition ${
                    activeDeployTab === 'github'
                      ? 'bg-purple-600 text-white font-bold shadow-md'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <FolderGit2 className="h-3.5 w-3.5" />
                  <span>GitHub Repo</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTabMethod('registry')}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2 px-2 text-[11px] font-medium transition ${
                    activeDeployTab === 'registry'
                      ? 'bg-purple-600 text-white font-bold shadow-md'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <Container className="h-3.5 w-3.5" />
                  <span>Docker Image</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTabMethod('docker-compose')}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2 px-2 text-[11px] font-medium transition ${
                    activeDeployTab === 'docker-compose'
                      ? 'bg-purple-600 text-white font-bold shadow-md'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <FileCode2 className="h-3.5 w-3.5" />
                  <span>Docker Compose</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTabMethod('cli')}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2 px-2 text-[11px] font-medium transition ${
                    activeDeployTab === 'cli'
                      ? 'bg-purple-600 text-white font-bold shadow-md'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <Terminal className="h-3.5 w-3.5" />
                  <span>CLI / Source</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTabMethod('webhook')}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2 px-2 text-[11px] font-medium transition ${
                    activeDeployTab === 'webhook'
                      ? 'bg-purple-600 text-white font-bold shadow-md'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <Webhook className="h-3.5 w-3.5" />
                  <span>Webhook / CI</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTabMethod('agent')}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2 px-2 text-[11px] font-medium transition ${
                    activeDeployTab === 'agent'
                      ? 'bg-purple-600 text-white font-bold shadow-md'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <Bot className="h-3.5 w-3.5" />
                  <span>Cloud Agent Auto-Deploy</span>
                </button>
              </div>
            </div>

            {/* TAB CONTENT 1: GitHub Repo */}
            {activeDeployTab === 'github' && (
              <div className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3.5">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <FolderGit2 className="h-4 w-4 text-purple-400" />
                  <span>دیپلوی از ریپوزیتوری گیت‌هاب (githubRepoDeploy)</span>
                </div>
                <p className="text-[11px] text-neutral-400 leading-relaxed">
                  می‌توانید کامل‌ترین آدرس ریپو را جای‌گذاری کنید؛ آدرس‌هایی مثل
                  <span className="font-mono text-purple-300"> https://github.com/owner/repo.git</span> به‌صورت خودکار
                  به فرمت <span className="font-mono text-purple-300">owner/repo</span> تبدیل می‌شوند. ریپوهای عمومی هم پشتیبانی می‌شوند.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-neutral-300 mb-1">
                      آدرس یا نام ریپو (GitHub Repo)
                    </label>
                    <input
                      type="text"
                      placeholder="مثال: https://github.com/Kiyarash0090/terminal.git"
                      value={githubRepo}
                      onChange={(e) => setGithubRepo(e.target.value)}
                      className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-white focus:border-purple-500 focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-neutral-300 mb-1">
                      شاخه (Branch) — خالی = شاخه پیش‌فرض ریپو
                    </label>
                    <input
                      type="text"
                      placeholder="خالی بگذارید تا شاخه پیشفرض خودکار انتخاب شود"
                      value={githubBranch}
                      onChange={(e) => {
                        setGithubBranch(e.target.value);
                        setBranchTouched(true);
                      }}
                      className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-white focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT 2: Docker Registry Image */}
            {activeDeployTab === 'registry' && (
              <div className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3.5">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Container className="h-4 w-4 text-purple-400" />
                  <span>دیپلوی مستقیم ایمیج داکر (registryCredentials / source)</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-medium text-neutral-300 mb-1">
                      نام ایمیج (Image Repository Name)
                    </label>
                    <input
                      type="text"
                      placeholder="nginx:alpine یا ghcr.io/user/app:v1"
                      value={registryImage}
                      onChange={(e) => setRegistryImage(e.target.value)}
                      className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-white focus:border-purple-500 focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-neutral-300 mb-1">
                      پورت listening کانتینر
                    </label>
                    <input
                      type="number"
                      value={registryPort}
                      onChange={(e) => setRegistryPort(Number(e.target.value))}
                      className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-white focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT 3: Docker Compose Import */}
            {activeDeployTab === 'docker-compose' && (
              <div className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3.5">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <FileCode2 className="h-4 w-4 text-purple-400" />
                  <span>وارد کردن فایل Docker Compose (dockerComposeImport)</span>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-neutral-300 mb-1">
                    محتوای فایل docker-compose.yml
                  </label>
                  <textarea
                    rows={6}
                    value={composeYaml}
                    onChange={(e) => setComposeYaml(e.target.value)}
                    className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-[11px] text-emerald-400 focus:border-purple-500 focus:outline-none leading-relaxed"
                    required
                  />
                </div>
              </div>
            )}

            {/* TAB CONTENT 4: CLI / Source Upload */}
            {activeDeployTab === 'cli' && (
              <div className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3.5">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <FolderUp className="h-4 w-4 text-purple-400" />
                  <span>آپلود مستقیم سورس کد بدون ریپوی گیتهاب</span>
                </div>
                <p className="text-[11px] text-neutral-400 leading-relaxed">
                  سورس پروژه از دستگاه شما خوانده، در مرورگر به آرشیو gzip تبدیل می‌شود و مستقیم به ریلوی ارسال می‌شود؛
                  ریلوی خودش بیلد و دیپلوی را انجام می‌دهد. مسیر <span className="font-mono text-purple-300">node_modules</span> و{' '}
                  <span className="font-mono text-purple-300">.git</span> و فایل‌های داخل{' '}
                  <span className="font-mono text-purple-300">.gitignore</span> /{' '}
                  <span className="font-mono text-purple-300">.railwayignore</span> خودکار حذف می‌شوند.
                </p>

                {/* Source mode switch */}
                <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-neutral-900 p-1 border border-neutral-800">
                  <button
                    type="button"
                    onClick={() => setSourceMode('folder')}
                    className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium transition ${
                      sourceMode === 'folder'
                        ? 'bg-purple-600 text-white font-bold'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <FolderUp className="h-3.5 w-3.5" />
                    <span>انتخاب پوشه پروژه</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceMode('zip')}
                    className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium transition ${
                      sourceMode === 'zip'
                        ? 'bg-purple-600 text-white font-bold'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <FileArchive className="h-3.5 w-3.5" />
                    <span>آپلود فایل zip</span>
                  </button>
                </div>

                <input
                  ref={folderInputRef}
                  type="file"
                  className="hidden"
                  /* @ts-expect-error webkitdirectory is non-standard but supported */
                  webkitdirectory=""
                  directory=""
                  multiple
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) handleSourceSelection('directory', files);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={zipInputRef}
                  type="file"
                  className="hidden"
                  accept=".zip,application/zip"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleSourceSelection('zip', undefined, file);
                    e.target.value = '';
                  }}
                />

                <button
                  type="button"
                  disabled={isReadingSource}
                  onClick={() =>
                    sourceMode === 'folder' ? folderInputRef.current?.click() : zipInputRef.current?.click()
                  }
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-700 bg-neutral-900/70 px-3 py-4 text-xs font-medium text-neutral-300 hover:border-purple-500/60 hover:text-white transition disabled:opacity-50"
                >
                  {isReadingSource ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>در حال خواندن فایل‌ها...</span>
                    </>
                  ) : sourceEntries ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span className="truncate" dir="ltr">
                        {sourceLabel || 'سورس انتخاب شد'}
                      </span>
                      <span className="text-[10px] text-neutral-500">— تغییر انتخاب</span>
                    </>
                  ) : (
                    <>
                      <FolderUp className="h-4 w-4 text-purple-400" />
                      <span>{sourceMode === 'folder' ? 'انتخاب پوشه پروژه' : 'انتخاب فایل zip'}</span>
                    </>
                  )}
                </button>

                {sourceEntries && (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-neutral-900 border border-neutral-800 px-2 py-1.5">
                      <div className="text-[10px] text-neutral-500">تعداد فایل</div>
                      <div className="text-xs font-bold text-white">
                        {sourceEntries.filter((e) => !e.directory).length.toLocaleString('fa-IR')}
                      </div>
                    </div>
                    <div className="rounded-xl bg-neutral-900 border border-neutral-800 px-2 py-1.5">
                      <div className="text-[10px] text-neutral-500">حجم سورس</div>
                      <div className="text-xs font-bold text-white">{formatBytes(selectedSourceBytes)}</div>
                    </div>
                    <div className="rounded-xl bg-neutral-900 border border-neutral-800 px-2 py-1.5">
                      <div className="text-[10px] text-neutral-500">فشرده‌سازی</div>
                      <div className="text-xs font-bold text-emerald-400">gzip</div>
                    </div>
                  </div>
                )}

                {detectedEnv.fileName && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
                        <FileCode2 className="h-3.5 w-3.5" />
                        <span>
                          {Object.keys(detectedEnv.vars).length.toLocaleString('fa-IR')} متغیر از{' '}
                          <span className="font-mono" dir="ltr">
                            {detectedEnv.fileName}
                          </span>{' '}
                          خوانده شد
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !envFromFileEnabled;
                          setEnvFromFileEnabled(next);
                          // Both directions keep the editor honest: apply the
                          // file's values, or take them back out again.
                          if (next) {
                            mergeDetectedEnv(detectedEnv.vars);
                          } else {
                            const keys = new Set(Object.keys(detectedEnv.vars));
                            setEnvVarsText((prev) =>
                              prev
                                .split('\n')
                                .filter((line) => {
                                  const idx = line.indexOf('=');
                                  return idx <= 0 || !keys.has(line.slice(0, idx).trim());
                                })
                                .join('\n')
                            );
                          }
                        }}
                        className={`rounded-md px-2 py-0.5 text-[10px] font-semibold border transition ${
                          envFromFileEnabled
                            ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200'
                            : 'border-neutral-700 bg-neutral-800 text-neutral-400'
                        }`}
                      >
                        {envFromFileEnabled ? 'اعمال می‌شود' : 'اعمال نشود'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(detectedEnv.vars).slice(0, 12).map(([key, value]) => (
                        <span
                          key={key}
                          title={`${key}=${value}`}
                          className="rounded-md bg-neutral-900 border border-neutral-800 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300"
                          dir="ltr"
                        >
                          {key}
                        </span>
                      ))}
                      {Object.keys(detectedEnv.vars).length > 12 && (
                        <span className="text-[9px] text-neutral-500">
                          +{(Object.keys(detectedEnv.vars).length - 12).toLocaleString('fa-IR')} دیگر
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {sensitiveFiles.length > 0 && (
                  <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 p-2.5 text-[11px] text-amber-300">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span className="leading-relaxed">
                      این فایل‌ها محتوای حساس دارند و داخل آرشیو رفتند:{' '}
                      <span className="font-mono" dir="ltr">
                        {sensitiveFiles.slice(0, 5).join(', ')}
                        {sensitiveFiles.length > 5 ? ` +${sensitiveFiles.length - 5}` : ''}
                      </span>
                    </span>
                  </div>
                )}

                {sourceError && (
                  <div className="flex items-start gap-2 rounded-xl bg-rose-500/10 border border-rose-500/30 p-2.5 text-[11px] text-rose-300">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span className="whitespace-pre-wrap break-words leading-relaxed">{sourceError}</span>
                  </div>
                )}

                <details className="rounded-xl bg-neutral-900/60 border border-neutral-800 px-2.5 py-2">
                  <summary className="cursor-pointer text-[10px] text-neutral-500 hover:text-neutral-300">
                    یا با CLI خودتان آپلود کنید (railway up)
                  </summary>
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-neutral-950 p-2 border border-neutral-800 font-mono text-[11px] text-purple-300">
                    <code className="truncate">railway link -p {cliTargetProjectId} && railway up</code>
                    <button
                      type="button"
                      onClick={copyCliCommand}
                      className="flex items-center gap-1 rounded-md bg-neutral-800 px-2 py-1 text-[10px] text-white hover:bg-neutral-700 shrink-0"
                    >
                      {copiedCli ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      <span>{copiedCli ? 'کپی شد' : 'کپی'}</span>
                    </button>
                  </div>
                </details>
              </div>
            )}

            {/* TAB CONTENT 5: Webhook / CI Trigger */}
            {activeDeployTab === 'webhook' && (
              <div className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3.5">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Webhook className="h-4 w-4 text-purple-400" />
                  <span>اتصال CI/CD خارجی (ساخت سرویس واقعی + تریگر)</span>
                </div>
                <p className="text-[11px] text-neutral-400 leading-relaxed">
                  با ثبت این فرم یک سرویس واقعی روی پروژه انتخاب‌شده ساخته می‌شود؛ سپس می‌توانید در داشبورد ریلوی برای آن
                  سرویس یک Webhook Trigger (deploymentTriggerCreate) متصل کنید تا با ارسال request از GitLab CI، Jenkins یا
                  GitHub Actions دپلوی خودکار تریگر شود.
                </p>
              </div>
            )}

            {/* TAB CONTENT 6: Cloud Agent */}
            {activeDeployTab === 'agent' && (
              <div className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3.5">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Bot className="h-4 w-4 text-purple-400" />
                  <span>عامل هوشمند ابری (ساخت سرویس واقعی برای استقرار خودکار)</span>
                </div>
                <p className="text-[11px] text-neutral-400 leading-relaxed">
                  با ثبت این فرم یک سرویس واقعی روی پروژه انتخاب‌شده ساخته می‌شود تا عامل ابری ریلوی بتواند ساختار سورس کد
                  را آنالیز کرده، dependencies را تشخیص دهد و کانتینر اپتیمایز شده را روی همین سرویس دپلوی کند.
                </p>
              </div>
            )}

            {/* Common Config: Name & Env Vars */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">
                  نام سرویس در ریلوی
                </label>
                <input
                  type="text"
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  placeholder="my-app-node"
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-white placeholder-neutral-500 focus:border-purple-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">
                  پورت برنامه (Port)
                </label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-white focus:border-purple-500 focus:outline-none"
                  required
                />
              </div>
            </div>

            {/* Environment Variables Editor */}
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                متغیرهای محیطی (Environment Variables - KEY=VALUE)
              </label>
              <textarea
                rows={3}
                value={envVarsText}
                onChange={(e) => setEnvVarsText(e.target.value)}
                placeholder="PORT=3000&#10;NODE_ENV=production"
                className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-emerald-400 focus:border-purple-500 focus:outline-none leading-relaxed"
              />
            </div>

            {deployPhase && isDeploying && (
              <div className="flex items-center gap-2 rounded-xl bg-sky-500/10 border border-sky-500/30 p-3 text-xs text-sky-300">
                <RotateCw className="h-4 w-4 shrink-0 animate-spin" />
                <span>{deployPhase}</span>
              </div>
            )}

            {errorMsg && (
              <div className="flex items-start gap-2 rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">{errorMsg}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-800">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-neutral-800 px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white"
              >
                انصراف
              </button>
              <button
                type="submit"
                disabled={isDeploying || isReadingSource || (activeDeployTab === 'cli' && !sourceEntries)}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2 text-xs font-bold text-white hover:from-purple-500 hover:to-indigo-500 transition shadow-lg shadow-purple-600/30 disabled:opacity-50"
              >
                {isDeploying ? (
                  <>
                    <RotateCw className="h-4 w-4 animate-spin" />
                    {deployPhase || 'در حال ارسال به API ریلوی...'}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    راه‌اندازی و دیپلوی سرویس
                  </>
                )}
              </button>
            </div>

          </form>
        )}

      </div>
    </div>
  );
};
