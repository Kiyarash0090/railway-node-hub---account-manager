import React, { useState, useEffect } from 'react';
import {
  X,
  Zap,
  CheckCircle2,
  AlertCircle,
  RotateCw,
  FolderGit2,
  Layers,
  Container,
  FileCode2,
  Terminal,
  Webhook,
  Bot,
  Plus,
  Copy,
  Check,
} from 'lucide-react';
import { useHub } from '../context/HubContext';
import { TEMPLATES } from '../constants/initialData';
import { normalizeGitHubRepo, extractApiError } from '../utils/githubRepo';
import { RailwayServiceDomain } from '../types';
import {
  deployGitHubRepoRailway,
  deployDockerComposeRailway,
  createServiceRailway,
  getGitHubRepoInfo,
  getRailwayDeployments,
  getRailwayDeploymentLogs,
  createRailwaySubdomain,
} from '../services/railwayApi';

interface DeployModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DeployModal: React.FC<DeployModalProps> = ({ isOpen, onClose }) => {
  const { accounts, activeAccountId, deployService, syncAccountProjects, setDeployJob } = useHub();

  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    activeAccountId !== 'all' ? activeAccountId : accounts[0]?.id || ''
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [activeDeployTab, setActiveTabMethod] = useState<
    'github' | 'template' | 'registry' | 'docker-compose' | 'cli' | 'webhook' | 'agent'
  >('github');

  // GitHub Repo Tab
  const [githubRepo, setGithubRepo] = useState<string>('');
  const [githubBranch, setGithubBranch] = useState<string>('');
  const [branchTouched, setBranchTouched] = useState<boolean>(false);

  // Template Tab
  const [selectedTemplate, setSelectedTemplate] = useState<string>('nodejs');

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

  // Deploy status
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [deploySuccess, setDeploySuccess] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCli, setCopiedCli] = useState<boolean>(false);
  // Live progress while the Railway build/domain flow runs
  const [deployPhase, setDeployPhase] = useState<string | null>(null);
  const [deployedDomain, setDeployedDomain] = useState<string | null>(null);

  /** Mirrors progress into the global deployJob so the status stays visible
   *  (in the header banner and the service card) even after this modal closes. */
  const reportPhase = (phase: string, extra?: { repo?: string; domain?: string; serviceId?: string }) => {
    setDeployPhase(phase);
    setDeployJob((prev) => ({
      status: 'running',
      phase,
      repo: extra?.repo ?? prev?.repo,
      domain: extra?.domain ?? prev?.domain,
      serviceId: extra?.serviceId ?? prev?.serviceId,
    }));
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

  const handleTemplateChange = (tmplId: string) => {
    setSelectedTemplate(tmplId);
    const tmpl = TEMPLATES.find((t) => t.id === tmplId);
    if (tmpl) {
      setPort(tmpl.defaultPort);
      setServiceName(`${tmplId}-service`);
      const envLines = Object.entries(tmpl.defaultEnv)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
      setEnvVarsText(envLines);
    }
  };

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
  }): Promise<{ id: string; status: string } | null> => {
    const deadline = Date.now() + 5 * 60 * 1000;
    let lastStatus = '';

    while (Date.now() < deadline) {
      const res = await getRailwayDeployments({ token: opts.token, projectId: opts.projectId });
      throwApiError(res, 'دریافت وضعیت دیپلوی از ریلوی ناموفق بود');

      const edges = res?.data?.deployments?.edges || [];
      const latest = edges[0]?.node;
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

  /** Fetches deploymentLogs (direct array — no edges) and formats a short tail. */
  const fetchDeploymentLogTail = async (token: string, deploymentId: string) => {
    const res = await getRailwayDeploymentLogs({ token, deploymentId, limit: 40 });
    const logs = res?.data?.deploymentLogs || [];
    if (!Array.isArray(logs) || logs.length === 0) return '';
    return logs
      .slice(-12)
      .map((l: any) => (typeof l?.message === 'string' ? l.message : ''))
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

  /** Creates a real (empty) service on Railway — used by template/custom and
   *  the CLI / Webhook / Agent flows. */
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

  const handleDeploySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAccount) {
      setErrorMsg('لطفاً ابتدا یک اکانت Railway اضافه کنید.');
      return;
    }

    setIsDeploying(true);
    setErrorMsg(null);
    setDeployPhase(null);
    setDeployJob(null);
    setDeployedDomain(null);

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

    try {
      if (activeDeployTab === 'github') {
        // Method 1: GitHub Repo Deploy via live GraphQL API
        // Full guide flow: deploy → poll build → create domain with targetPort
        const flow = await runGitHubDeployFlow(githubRepo, {
          token: targetAccount.token,
          projectId: targetProjectId,
          branch: githubBranch,
          preferDefaultBranch: !branchTouched,
          port,
        });
        setDeployedDomain(flow.domain);

        // flow.projectId is the REAL project the server deployed into — it
        // differs from targetProjectId when a missing project was recreated.
        await deployService(targetAccount.id, flow.projectId || targetProjectId, {
          name: serviceName || flow.repo.split('/')[1] || 'github-app',
          templateType: 'custom',
          imageOrRepo: `${flow.repo} @ ${flow.branch}`,
          port,
          envVars,
          railwayServiceId: flow.serviceId,
          domains: flow.domain
            ? [
                {
                  id: `deploy-domain-${Date.now()}`,
                  domain: flow.domain,
                  targetPort: port,
                  kind: 'service',
                  environmentId: flow.environmentId || undefined,
                } as RailwayServiceDomain,
              ]
            : undefined,
        });
      } else if (activeDeployTab === 'template') {
        // Method 2: Ready-made templates — each one triggers a REAL deploy
        const tmpl = TEMPLATES.find((t) => t.id === selectedTemplate) || TEMPLATES[0];

        if (tmpl.deployMethod === 'github' && tmpl.repo) {
          const flow = await runGitHubDeployFlow(tmpl.repo, {
            token: targetAccount.token,
            projectId: targetProjectId,
            preferDefaultBranch: true,
            port,
          });
          setDeployedDomain(flow.domain);
          await deployService(targetAccount.id, flow.projectId || targetProjectId, {
            name: serviceName || `${tmpl.id}-service`,
            templateType: tmpl.id,
            imageOrRepo: `${flow.repo} @ ${flow.branch}`,
            port,
            envVars,
            railwayServiceId: flow.serviceId,
            domains: flow.domain
              ? [
                  {
                    id: `deploy-domain-${Date.now()}`,
                    domain: flow.domain,
                    targetPort: port,
                    kind: 'service',
                    environmentId: flow.environmentId || undefined,
                  } as RailwayServiceDomain,
                ]
              : undefined,
          });
        } else if (tmpl.deployMethod === 'image' && tmpl.image) {
          const svcRes = await createRealService({
            token: targetAccount.token,
            projectId: targetProjectId,
            name: serviceName || `${tmpl.id}-service`,
            image: tmpl.image,
            variables: envVars,
          });
          await deployService(targetAccount.id, svcRes?.resolvedProjectId || targetProjectId, {
            name: serviceName || `${tmpl.id}-service`,
            templateType: tmpl.id,
            imageOrRepo: tmpl.image,
            port,
            envVars,
          });
        } else {
          const svcRes = await createRealService({
            token: targetAccount.token,
            projectId: targetProjectId,
            name: serviceName || `${tmpl.id}-service`,
            variables: envVars,
          });
          await deployService(targetAccount.id, svcRes?.resolvedProjectId || targetProjectId, {
            name: serviceName || `${tmpl.id}-service`,
            templateType: tmpl.id,
            imageOrRepo: 'empty-service',
            port,
            envVars,
          });
        }
      } else if (activeDeployTab === 'docker-compose') {
        // Method 3: Docker Compose Import (real environmentId resolved server-side)
        const dcRes = await deployDockerComposeRailway({
          token: targetAccount.token,
          projectId: targetProjectId,
          yaml: composeYaml,
        });
        throwApiError(dcRes, 'وارد کردن Docker Compose توسط ریلوی نپذیرفته شد');

        await deployService(targetAccount.id, dcRes?.resolvedProjectId || targetProjectId, {
          name: serviceName || 'docker-compose-stack',
          templateType: 'docker',
          imageOrRepo: 'docker-compose.yml',
          port,
          envVars,
        });
      } else if (activeDeployTab === 'registry') {
        // Method 4: Registry Image (real serviceCreate with source.image)
        const svcRes = await createRealService({
          token: targetAccount.token,
          projectId: targetProjectId,
          name: serviceName || 'registry-service',
          image: registryImage,
          variables: envVars,
        });

        await deployService(targetAccount.id, svcRes?.resolvedProjectId || targetProjectId, {
          name: serviceName || 'registry-service',
          templateType: 'docker',
          imageOrRepo: registryImage,
          port: registryPort,
          envVars,
        });
      } else {
        // Methods 5/6/7 (CLI / Webhook / Agent): create a real empty service
        // on Railway so the subsequent CLI upload / trigger actually has a target.
        const svcRes = await createRealService({
          token: targetAccount.token,
          projectId: targetProjectId,
          name: serviceName || 'empty-service',
          variables: envVars,
        });

        await deployService(targetAccount.id, svcRes?.resolvedProjectId || targetProjectId, {
          name: serviceName || 'empty-service',
          templateType: 'custom',
          imageOrRepo: 'empty-service',
          port,
          envVars,
        });
      }

      // The deploy may have auto-created the target project — pull it and the
      // new service into hub state right away instead of waiting for the next
      // periodic sync (30s) to discover them.
      await syncAccountProjects(targetAccount.id);

      setIsDeploying(false);
      setDeploySuccess(true);
      setDeployJob((prev) => ({
        status: 'success',
        phase: deployedDomain
          ? `دیپلوی موفق — دامنه: ${deployedDomain}`
          : 'دیپلوی سرویس با موفقیت انجام شد',
        domain: deployedDomain || undefined,
        repo: prev?.repo,
        serviceId: prev?.serviceId,
      }));

      // Keep the result on screen long enough to read/copy the domain.
      setTimeout(() => {
        setDeploySuccess(false);
        onClose();
      }, deployedDomain ? 6000 : 2000);
    } catch (err: any) {
      setIsDeploying(false);
      setErrorMsg(err.message || 'خطا در برقراری ارتباط با API دیپلوی ریلوی');
      setDeployJob((prev) => ({
        status: 'error',
        phase: err.message || 'دیپلوی ناموفق بود',
        repo: prev?.repo,
        serviceId: prev?.serviceId,
      }));
    }
  };

  const cliTargetProjectId = targetProjectId || 'project-id';
  const copyCliCommand = () => {
    navigator.clipboard.writeText(`railway link -p ${cliTargetProjectId} && railway up`);
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-md animate-in fade-in">
      <div className="w-[96vw] max-w-3xl rounded-3xl border border-neutral-800 bg-neutral-900 p-4 sm:p-6 shadow-2xl overflow-y-auto max-h-[92vh]">

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/30 ring-1 ring-purple-400/30 shrink-0">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black text-white">مرکز دپلوی و ساخت سرویس جدید در Railway</h2>
              <p className="text-[11px] text-neutral-400">
                پشتیبانی از ۷ روش رسمی دیپلوی مستقیم API ریلوی (گیت‌هاب، تمپلیت، کامپوز، داکر رجستری و CLI)
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 rounded-2xl bg-neutral-950 p-1.5 border border-neutral-800">
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
                  onClick={() => setActiveTabMethod('template')}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2 px-2 text-[11px] font-medium transition ${
                    activeDeployTab === 'template'
                      ? 'bg-purple-600 text-white font-bold shadow-md'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>Template آماده</span>
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
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2 px-2 text-[11px] font-medium transition col-span-2 sm:col-span-2 ${
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

            {/* TAB CONTENT 2: Marketplace Templates */}
            {activeDeployTab === 'template' && (
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-neutral-300 mb-1">
                  تمپلیت‌های آماده واقعی (دیپلوی مستقیم با API ریلوی)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto p-1 border border-neutral-800 rounded-2xl bg-neutral-950">
                  {TEMPLATES.map((tmpl) => {
                    const isSelected = selectedTemplate === tmpl.id;
                    const methodLabel =
                      tmpl.deployMethod === 'github'
                        ? 'گیت‌هاب'
                        : tmpl.deployMethod === 'image'
                        ? 'ایمیج داکر'
                        : 'سرویس خالی';
                    const methodColor =
                      tmpl.deployMethod === 'github'
                        ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                        : tmpl.deployMethod === 'image'
                        ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                        : 'bg-neutral-700/40 text-neutral-300 border-neutral-600';
                    return (
                      <div
                        key={tmpl.id}
                        onClick={() => handleTemplateChange(tmpl.id)}
                        className={`cursor-pointer rounded-xl border p-2.5 transition ${
                          isSelected
                            ? 'border-purple-500 bg-purple-600/10 ring-1 ring-purple-500/30'
                            : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700'
                        }`}
                      >
                        <div className="text-lg mb-0.5">{tmpl.icon}</div>
                        <div className="text-xs font-bold text-white truncate">{tmpl.name}</div>
                        <div className="text-[9px] text-neutral-400 mt-0.5 line-clamp-2">
                          {tmpl.description}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-1">
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${methodColor}`}>
                            {methodLabel}
                          </span>
                          {(tmpl.repo || tmpl.image) && (
                            <span className="text-[8px] font-mono text-neutral-500 truncate" dir="ltr">
                              {tmpl.repo || tmpl.image}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-neutral-400 leading-relaxed">
                  هر تمپلیت یک منبع واقعی دارد: تمپلیت‌های گیت‌هابی با <span className="font-mono text-purple-300">githubRepoDeploy</span>،
                  دیتابیس‌ها با <span className="font-mono text-purple-300">serviceCreate + source.image</span> و سرویس خالی با
                  ساخت واقعی سرویس روی پروژه انتخاب‌شده دیپلوی می‌شوند.
                </p>
              </div>
            )}

            {/* TAB CONTENT 3: Docker Registry Image */}
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

            {/* TAB CONTENT 4: Docker Compose Import */}
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

            {/* TAB CONTENT 5: CLI / Source Upload */}
            {activeDeployTab === 'cli' && (
              <div className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3.5">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Terminal className="h-4 w-4 text-purple-400" />
                  <span>آپلود دستی سورس کد با CLI (railway up)</span>
                </div>
                <p className="text-[11px] text-neutral-400 leading-relaxed">
                  با ثبت این فرم یک سرویس خالی واقعی روی پروژه انتخاب‌شده ساخته می‌شود و سپس می‌توانید سورس کد محلی خود را
                  با دستور زیر مستقیم بدون ریپوی گیت‌هاب دپلوی کنید.
                </p>

                <div className="flex items-center justify-between rounded-xl bg-neutral-900 p-2.5 border border-neutral-800 font-mono text-xs text-purple-300">
                  <code>railway link -p {cliTargetProjectId} && railway up</code>
                  <button
                    type="button"
                    onClick={copyCliCommand}
                    className="flex items-center gap-1 rounded-lg bg-neutral-800 px-2 py-1 text-[10px] text-white hover:bg-neutral-700"
                  >
                    {copiedCli ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedCli ? 'کپی شد' : 'کپی'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB CONTENT 6: Webhook / CI Trigger */}
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

            {/* TAB CONTENT 7: Cloud Agent */}
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
                disabled={isDeploying}
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
