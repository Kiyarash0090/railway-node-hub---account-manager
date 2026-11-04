/** Loopback client for the bot: every /api/railway/* route already exists in
 *  server.ts; we just call them over http://127.0.0.1:PORT with the internal
 *  secret header instead of a browser session.
 *
 *  After any mutating op we re-sync the affected account and persist it via
 *  mutateState, so the web UI and the bot never diverge. */

import { getInternalBotSecret } from '../auth';
import {
  mutateState,
  readRawState,
  writeState,
  readState,
  restoreState,
  readTelegram,
  writeTelegram,
} from '../stateStore';
import type { RailwayAccount } from '../../types';

let PORT: number = Number(process.env.PORT) || 3000;

export function setBotPort(port: number): void {
  PORT = port;
}

function base(): string {
  return `http://127.0.0.1:${PORT}`;
}

function headers(): Record<string, string> {
  return { 'x-internal-bot': getInternalBotSecret() || '' };
}

/** Generic POST to a hub /api route using the internal bot header. */
export async function apiPost<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(base() + path, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: T;
  try {
    data = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    data = text as unknown as T;
  }
  if (!res.ok && typeof data !== 'string') {
    const err = new Error(
      (data as any)?.error || `HTTP ${res.status}`
    );
    (err as any).status = res.status;
    (err as any).body = data;
    throw err;
  }
  return data;
}

export function getAccounts(): RailwayAccount[] {
  const raw = readRawState();
  const accounts = raw?.accounts;
  return Array.isArray(accounts) ? (accounts as RailwayAccount[]) : [];
}

export function findAccount(accountId: string): RailwayAccount | undefined {
  return getAccounts().find((a) => a.id === accountId);
}

/** Sync a single account's projects/credits from Railway and persist them. */
export async function syncAccount(accountId: string): Promise<RailwayAccount | null> {
  const account = findAccount(accountId);
  if (!account) return null;
  try {
    const result = await apiPost<{
      projects?: any[];
      creditLimit?: number;
      creditUsed?: number;
      creditRemaining?: number;
      plan?: string;
      projectLimit?: number | null;
      serviceLimitPerProject?: number | null;
      isTrialing?: boolean;
      trialDaysRemaining?: number | null;
      creditExpiresInDays?: number | null;
      preferredRegion?: string | null;
    }>('/api/railway/sync-projects', { token: account.token });

    await mutateState((raw) => {
      const accounts = Array.isArray(raw.accounts) ? (raw.accounts as RailwayAccount[]) : [];
      const idx = accounts.findIndex((a) => a.id === accountId);
      if (idx !== -1) {
        accounts[idx] = {
          ...accounts[idx],
          ...(result.projects ? { projects: result.projects } : {}),
          ...(typeof result.creditLimit === 'number' ? { creditLimit: result.creditLimit } : {}),
          ...(typeof result.creditUsed === 'number' ? { creditUsed: result.creditUsed } : {}),
          ...(typeof result.creditRemaining === 'number'
            ? { creditRemaining: result.creditRemaining }
            : {}),
          ...(result.plan ? { plan: result.plan as RailwayAccount['plan'] } : {}),
          projectLimit: result.projectLimit ?? accounts[idx].projectLimit,
          serviceLimitPerProject:
            result.serviceLimitPerProject ?? accounts[idx].serviceLimitPerProject,
          isTrialing: result.isTrialing ?? accounts[idx].isTrialing,
          trialDaysRemaining:
            result.trialDaysRemaining !== undefined ? result.trialDaysRemaining : accounts[idx].trialDaysRemaining,
          creditExpiresInDays:
            result.creditExpiresInDays !== undefined
              ? result.creditExpiresInDays
              : accounts[idx].creditExpiresInDays,
          preferredRegion:
            result.preferredRegion !== undefined
              ? result.preferredRegion
              : accounts[idx].preferredRegion,
          lastChecked: new Date().toISOString(),
        };
        return accounts;
      }
      return accounts;
    });

    return findAccount(accountId) || null;
  } catch (err: any) {
    if (err?.body?.code === 'RAILWAY_UNREACHABLE') return null;
    throw err;
  }
}

/** Add a new account from a raw Railway token. */
export async function addAccountFromToken(token: string): Promise<RailwayAccount> {
  const result = await apiPost<{
    valid: boolean;
    error?: string;
    user?: any;
    extractedInfo?: any;
  }>('/api/railway/validate-token', { token });

  if (!result.valid) {
    throw new Error(result.error || 'Railway token نامعتبر است');
  }

  const user = result.user;
  const info = result.extractedInfo;
  const projects = info?.projects || [];

  const newAccount: RailwayAccount = {
    id: crypto.randomUUID(),
    name: user?.name || user?.username || 'Railway User',
    email: user?.email || '',
    token: token,
    workspaceId: info?.workspaceId || '',
    color: '#3b82f6',
    plan: info?.plan || 'Free',
    currency: '$',
    creditLimit: info?.creditLimit ?? 1.0,
    creditUsed: info?.creditUsed ?? 0,
    creditRemaining: info?.creditRemaining ?? 0,
    hourlyBurnRate: 0,
    status: 'active',
    lastChecked: new Date().toISOString(),
    projects,
    isRealVerified: true,
    projectLimit: info?.projectLimit ?? null,
    serviceLimitPerProject: info?.serviceLimitPerProject ?? null,
    isTrialing: info?.isTrialing ?? false,
    trialDaysRemaining: info?.trialDaysRemaining ?? null,
    creditExpiresInDays: info?.creditExpiresInDays ?? null,
    billingPeriodEnd: info?.billingPeriodEnd ?? null,
    preferredRegion: info?.preferredRegion ?? null,
  };

  await mutateState((raw) => {
    const accounts = Array.isArray(raw.accounts) ? [...(raw.accounts as RailwayAccount[])] : [];
    accounts.push(newAccount);
    return accounts;
  });

  return newAccount;
}

/** Remove an account by id. */
export async function deleteAccount(accountId: string): Promise<void> {
  await mutateState((raw) => {
    const accounts = Array.isArray(raw.accounts)
      ? (raw.accounts as RailwayAccount[])
      : [];
    const filtered = accounts.filter((a) => a.id !== accountId);
    return filtered;
  });
}

/** Update account tags. */
export async function updateAccountTags(
  accountId: string,
  tags: string[]
): Promise<void> {
  await mutateState((raw) => {
    const accounts = Array.isArray(raw.accounts) ? [...(raw.accounts as RailwayAccount[])] : [];
    const idx = accounts.findIndex((a) => a.id === accountId);
    if (idx !== -1) accounts[idx] = { ...accounts[idx], tags };
    return accounts;
  });
}

/** Set the account's preferred region on Railway. */
export async function setAccountRegion(
  accountId: string,
  region: string
): Promise<void> {
  const account = findAccount(accountId);
  if (!account) return;
  await apiPost('/api/railway/workspace/region', {
    token: account.token,
    region,
    workspaceId: account.workspaceId,
  });
}

/* -------------------------------------------------------------------------
 * Project / service read + write helpers used by the bot menus.
 * Each one resolves the account token here so menus never handle tokens.
 * ---------------------------------------------------------------------- */

export interface ServiceRef {
  accountId: string;
  projectId: string;
  serviceId: string;
  environmentId?: string;
}

export function listProjects(accountId: string) {
  const account = findAccount(accountId);
  if (!account) return [];
  return (account.projects || []).filter((p: any) => !p.isDeletedOnRailway);
}

export function findProject(accountId: string, projectId: string) {
  return listProjects(accountId).find((p: any) => p.id === projectId);
}

export function findService(ref: ServiceRef) {
  const project = findProject(ref.accountId, ref.projectId);
  return project?.services?.find((s: any) => s.id === ref.serviceId);
}

export function servicesOfAccount(accountId: string) {
  const out: {
    ref: ServiceRef;
    name: string;
    status: string;
    projectName: string;
    port?: number;
    domains: string[];
  }[] = [];
  for (const p of listProjects(accountId)) {
    for (const s of p.services || []) {
      out.push({
        ref: {
          accountId,
          projectId: p.id,
          serviceId: s.id,
          environmentId: p.defaultEnvironmentId || undefined,
        },
        name: s.name || 'بدون نام',
        status: s.status || 'unknown',
        projectName: p.name || 'بدون نام',
        port: s.port,
        domains: (s.domains || []).map((d: any) => (typeof d === 'string' ? d : d.domain)),
      });
    }
  }
  return out;
}

/** Create an empty project. Returns the project id. */
export async function createProject(accountId: string, name: string): Promise<string> {
  const account = findAccount(accountId);
  if (!account) throw new Error('اکانت یافت نشد');
  const data = await apiPost<any>('/api/railway/project/create', {
    token: account.token,
    workspaceId: account.workspaceId,
    name,
  });
  const id = data?.data?.projectCreate?.id;
  if (!id) throw new Error(data?.errors?.[0]?.message || 'ساخت پروژه ناموفق بود');
  await syncAccount(accountId).catch(() => {});
  return id;
}

/** Create a service from a Docker image (or empty service when image is null). */
export async function createService(
  accountId: string,
  projectId: string,
  opts: { name: string; image?: string; port?: number; variables?: Record<string, string> }
): Promise<{ serviceId: string | null; projectId: string }> {
  const account = findAccount(accountId);
  if (!account) throw new Error('اکانت یافت نشد');
  const project = findProject(accountId, projectId);
  const data = await apiPost<any>('/api/railway/deploy/service-create', {
    token: account.token,
    projectId,
    environmentId: project?.defaultEnvironmentId,
    name: opts.name,
    image: opts.image || undefined,
    variables: opts.variables,
  });
  if (data?.errors?.length) {
    throw new Error(data.errors[0]?.message || 'ساخت سرویس ناموفق بود');
  }
  const serviceId = data?.data?.serviceCreate?.id || null;
  const resolvedProjectId = data?.resolvedProjectId || projectId;
  await syncAccount(accountId).catch(() => {});
  return { serviceId, projectId: resolvedProjectId };
}

/** Attach a free *.up.railway.app subdomain to a service. */
export async function createSubdomain(ref: ServiceRef, targetPort: number): Promise<string> {
  const account = findAccount(ref.accountId);
  if (!account) throw new Error('اکانت یافت نشد');
  const data = await apiPost<any>('/api/railway/domain/create-subdomain', {
    token: account.token,
    projectId: ref.projectId,
    environmentId: ref.environmentId,
    serviceId: ref.serviceId,
    targetPort,
  });
  if (data?.errors?.length) {
    throw new Error(data.errors[0]?.message || 'ساخت دامنه ناموفق بود');
  }
  return data?.data?.serviceDomainCreate?.domain || '';
}

export async function listDomains(ref: ServiceRef) {
  const account = findAccount(ref.accountId);
  if (!account) throw new Error('اکانت یافت نشد');
  const data = await apiPost<any>('/api/railway/domains', {
    token: account.token,
    projectId: ref.projectId,
    serviceId: ref.serviceId,
    environmentId: ref.environmentId,
  });
  return Array.isArray(data?.domains) ? data.domains : [];
}

export async function deleteDomain(accountId: string, id: string, kind: 'service' | 'custom') {
  const account = findAccount(accountId);
  if (!account) throw new Error('اکانت یافت نشد');
  await apiPost('/api/railway/domain/delete', { token: account.token, id, kind });
}

export async function upsertVariable(ref: ServiceRef, name: string, value: string) {
  const account = findAccount(ref.accountId);
  if (!account) throw new Error('اکانت یافت نشد');
  const data = await apiPost<any>('/api/railway/variables/upsert', {
    token: account.token,
    projectId: ref.projectId,
    environmentId: ref.environmentId,
    serviceId: ref.serviceId,
    name,
    value,
    skipDeploys: true,
  });
  if (data?.errors?.length) throw new Error(data.errors[0]?.message || 'ذخیره متغیر ناموفق بود');
}

export async function deleteVariable(ref: ServiceRef, name: string) {
  const account = findAccount(ref.accountId);
  if (!account) throw new Error('اکانت یافت نشد');
  const data = await apiPost<any>('/api/railway/variables/delete', {
    token: account.token,
    projectId: ref.projectId,
    environmentId: ref.environmentId,
    serviceId: ref.serviceId,
    name,
  });
  if (data?.errors?.length) throw new Error(data.errors[0]?.message || 'حذف متغیر ناموفق بود');
}

export async function listVolumes(ref: ServiceRef) {
  const account = findAccount(ref.accountId);
  if (!account) throw new Error('اکانت یافت نشد');
  const project = findProject(ref.accountId, ref.projectId);
  const envId = ref.environmentId || project?.defaultEnvironmentId;
  if (!envId) return [];
  const data = await apiPost<any>('/api/railway/volume/instances', {
    token: account.token,
    environmentId: envId,
  });
  const instances = Array.isArray(data?.instances) ? data.instances : [];
  return instances.filter((v: any) => !v.serviceId || v.serviceId === ref.serviceId);
}

export async function createVolume(ref: ServiceRef, mountPath: string) {
  const account = findAccount(ref.accountId);
  if (!account) throw new Error('اکانت یافت نشد');
  const data = await apiPost<any>('/api/railway/volume/create', {
    token: account.token,
    projectId: ref.projectId,
    serviceId: ref.serviceId,
    environmentId: ref.environmentId,
    mountPath,
  });
  if (data?.errors?.length) throw new Error(data.errors[0]?.message || 'ساخت ولوم ناموفق بود');
}

export async function deleteVolume(accountId: string, volumeId: string) {
  const account = findAccount(accountId);
  if (!account) throw new Error('اکانت یافت نشد');
  await apiPost('/api/railway/volume/delete', { token: account.token, volumeId });
}

export async function updateServiceSettings(
  ref: ServiceRef,
  input: {
    buildCommand?: string;
    startCommand?: string;
    rootDirectory?: string;
    healthcheckPath?: string;
    builder?: string;
  }
) {
  const account = findAccount(ref.accountId);
  if (!account) throw new Error('اکانت یافت نشد');
  const data = await apiPost<any>('/api/railway/service/instance-update', {
    token: account.token,
    serviceId: ref.serviceId,
    environmentId: ref.environmentId,
    ...input,
  });
  if (data?.errors?.length) throw new Error(data.errors[0]?.message || 'ذخیره تنظیمات ناموفق بود');
}

export async function fetchLogs(
  ref: ServiceRef,
  kind: 'deploy' | 'build'
): Promise<string> {
  const account = findAccount(ref.accountId);
  if (!account) throw new Error('اکانت یافت نشد');
  const service = findService(ref);
  const deploymentId = service?.latestDeploymentId;
  if (!deploymentId) return 'استقراری برای این سرویس ثبت نشده است.';

  const endpoint = kind === 'deploy' ? 'deployment-logs' : 'build-logs';
  const data = await apiPost<any>(`/api/railway/${endpoint}`, {
    token: account.token,
    deploymentId,
    limit: 300,
  });
  const logs = data?.data?.deploymentLogs || data?.data?.buildLogs || [];
  if (!Array.isArray(logs) || logs.length === 0) return 'لاگی یافت نشد.';
  return logs
    .map((l: any) => `[${l?.severity || 'info'}] ${l?.message ?? ''}`)
    .join('\n');
}

/** Deploy a GitHub repo into a project and poll until the deployment settles. */
export async function deployGithub(
  accountId: string,
  projectId: string,
  repo: string,
  branch: string
): Promise<{ ok: boolean; serviceId?: string | null; status?: string; error?: string }> {
  const account = findAccount(accountId);
  if (!account) return { ok: false, error: 'اکانت یافت نشد' };

  const data = await apiPost<any>('/api/railway/deploy/github', {
    token: account.token,
    projectId,
    repo,
    branch,
  });
  if (data?.errors?.length) {
    return { ok: false, error: data.errors[0]?.message || 'دیپلوی GitHub ناموفق بود' };
  }

  const realProjectId = data?.resolvedProjectId || projectId;
  let serviceId: string | null = null;
  // githubRepoDeploy returns no service id; read it from the newest deployment.
  for (let i = 0; i < 10 && !serviceId; i++) {
    const dep = await apiPost<any>('/api/railway/deployments', {
      token: account.token,
      projectId: realProjectId,
    }).catch(() => null);
    const edges = dep?.data?.deployments?.edges || [];
    const newest = edges
      .map((e: any) => e?.node)
      .filter((n: any) => n?.id)
      .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
    serviceId = newest?.serviceId || null;
    if (!serviceId) await new Promise((r) => setTimeout(r, 3000));
  }

  const settled = await waitForDeployment(accountId, realProjectId, serviceId);
  await syncAccount(accountId).catch(() => {});
  return { ok: true, serviceId, status: settled.status, error: settled.failed ? settled.status : undefined };
}

/** Poll the newest deployment of a service until it leaves the "deploying" states. */
export async function waitForDeployment(
  accountId: string,
  projectId: string,
  serviceId: string | null,
  timeoutMs = 8 * 60_000
): Promise<{ status: string; failed: boolean }> {
  const account = findAccount(accountId);
  if (!account || !serviceId) return { status: 'UNKNOWN', failed: false };

  const started = Date.now();
  const pending = new Set(['BUILDING', 'DEPLOYING', 'INITIALIZING', 'QUEUED', 'WAITING', 'NEEDS_APPROVAL']);
  let status = 'QUEUED';

  while (Date.now() - started < timeoutMs) {
    const data = await apiPost<any>('/api/railway/deployments', {
      token: account.token,
      projectId,
    }).catch(() => null);
    const edges = data?.data?.deployments?.edges || [];
    const mine = edges
      .map((e: any) => e?.node)
      .filter((n: any) => n?.serviceId === serviceId)
      .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
    if (mine?.status) {
      status = String(mine.status);
      if (!pending.has(status)) break;
    }
    await new Promise((r) => setTimeout(r, 8000));
  }

  return { status, failed: status === 'FAILED' || status === 'CRASHED' };
}

export async function deployDockerCompose(
  accountId: string,
  projectId: string,
  yaml: string
): Promise<{ ok: boolean; error?: string }> {
  const account = findAccount(accountId);
  if (!account) return { ok: false, error: 'اکانت یافت نشد' };
  const data = await apiPost<any>('/api/railway/deploy/docker-compose', {
    token: account.token,
    projectId,
    yaml,
  });
  const errors = data?.data?.dockerComposeImport?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return { ok: false, error: errors.join(' | ') };
  }
  await syncAccount(accountId).catch(() => {});
  return { ok: true };
}

/** Upload a .tar.gz source archive; returns the service id Railway created. */
export async function deploySourceUpload(
  accountId: string,
  projectId: string,
  archive: Buffer,
  name?: string
): Promise<{ ok: boolean; serviceId?: string | null; status?: string; error?: string }> {
  const account = findAccount(accountId);
  if (!account) throw new Error('اکانت یافت نشد');
  const project = findProject(accountId, projectId);

  const params = new URLSearchParams({ projectId });
  if (project?.defaultEnvironmentId) params.set('environmentId', project.defaultEnvironmentId);
  if (name) params.set('name', name);

  const res = await fetch(`${base()}/api/railway/deploy/source-upload?${params.toString()}`, {
    method: 'POST',
    headers: {
      ...headers(),
      'Content-Type': 'application/gzip',
      'x-railway-token': account.token,
    },
    body: new Uint8Array(archive),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: (data as any)?.error || `HTTP ${res.status}` };
  }
  const payload = data as any;
  const serviceId = payload?.serviceId || null;
  const realProjectId = payload?.resolvedProjectId || projectId;
  const settled = await waitForDeployment(accountId, realProjectId, serviceId);
  await syncAccount(accountId).catch(() => {});
  return {
    ok: true,
    serviceId,
    status: settled.status,
    error: settled.failed ? settled.status : undefined,
  };
}
/* ------------------------------------------------------------- backups */

/** Full state payload as sent for a backup (accounts + alerts + telegram). */
export function buildBackupPayload(): string {
  const state = readState() || { accounts: [], alerts: [], updatedAt: null };
  const telegram = readTelegram();
  return JSON.stringify(
    {
      accounts: state.accounts,
      alerts: state.alerts,
      ...(telegram ? { telegram } : {}),
      exportedAt: new Date().toISOString(),
    },
    null,
    2
  );
}

/** Record where the last backup lives, so "restore last" works after a restart. */
export function rememberBackup(fileId: string, fileName: string, messageId: number): void {
  const cfg = readTelegram();
  if (!cfg) return;
  writeTelegram({
    ...cfg,
    lastBackupAt: new Date().toISOString(),
    lastBackupFileId: fileId,
    lastBackupFileName: fileName,
    lastBackupMessageId: messageId,
  });
}

export function lastBackupRecord() {
  const cfg = readTelegram();
  if (!cfg?.lastBackupFileId) return null;
  return {
    fileId: cfg.lastBackupFileId,
    fileName: cfg.lastBackupFileName || 'backup.json',
    at: cfg.lastBackupAt || null,
  };
}

export type RestoreResult = { ok: true; accounts: number; alerts: number } | { ok: false; error: string };

/** Validate + apply a backup JSON payload (same rules as the web restore). */
export function applyBackupJson(raw: string): RestoreResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'فایل JSON معتبر نیست' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'فایل بکاپ باید یک آبجکت JSON باشد' };
  }
  const body = parsed as Record<string, unknown>;
  if (!Array.isArray(body.accounts) || !Array.isArray(body.alerts)) {
    return { ok: false, error: 'فایل بکاپ معتبر نیست (accounts/alerts پیدا نشد)' };
  }
  restoreState({
    accounts: body.accounts,
    alerts: body.alerts,
    telegram: body.telegram,
  });
  return { ok: true, accounts: body.accounts.length, alerts: body.alerts.length };
}
