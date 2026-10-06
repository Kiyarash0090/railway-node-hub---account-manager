import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import dns from 'dns';
import fs from 'fs';
import { authGuard, mountAuthRoutes } from './src/server/auth';
import {
  readState,
  writeState,
  readTelegram,
  writeTelegram,
  restoreState,
  stateFilePath,
} from './src/server/stateStore';
import { tgGetMe, tgSendMessage, tgSendDocument, tgDownloadFile, tgErrorToPersian } from './src/server/telegram';
import { normalizeGitHubRepo } from './src/utils/githubRepo';

dotenv.config();

// Prefer IPv4 for outbound DNS: some ISPs return broken/blocked IPv6 routes
// for Railway/Cloudflare, which surfaces as ETIMEDOUT AggregateError from fetch.
dns.setDefaultResultOrder('ipv4first');

// Retry transient network failures for hosts that suffer intermittent
// ISP filtering (Railway/Cloudflare). Also injects a browser User-Agent —
// Cloudflare 403s backboard without one.
const RETRY_HOSTS = ['backboard.railway.app'];
const railwayFetchBase = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!RETRY_HOSTS.some((h) => url.includes(h))) {
    return railwayFetchBase(input, init);
  }

  let opts = init || {};
  try {
    const headers = new Headers(opts.headers || {});
    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', 'Mozilla/5.0');
    }
    opts = { ...opts, headers };
  } catch {
    // Headers constructor can fail on exotic inputs — fall through unchanged.
  }

  // One extra attempt: mid-flight ISP drops are common on this network.
  const maxAttempts = 4;
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await railwayFetchBase(input, opts);
    } catch (err: any) {
      lastErr = err;
      const code = err?.cause?.code || err?.code || '';
      const isTransient =
        code === 'ETIMEDOUT' ||
        code === 'ECONNRESET' ||
        code === 'ENOTFOUND' ||
        code === 'ECONNREFUSED' ||
        code === 'EAI_AGAIN' ||
        code === 'EPIPE';
      if (!isTransient || attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastErr;
}) as typeof fetch;

const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

/** Days until this account's usage credit window ends.
 *  Railway's own dashboard "N days remaining" is trialDaysRemaining — even
 *  when isTrialing is false on FREE accounts — so prefer that whenever it is
 *  a positive number. Otherwise fall back to days until billingPeriod.end. */
function computeCreditExpiresInDays(customer: any): number | null {
  if (typeof customer?.trialDaysRemaining === 'number' && customer.trialDaysRemaining > 0) {
    return customer.trialDaysRemaining;
  }
  if (customer?.isTrialing) return 0;
  const end = customer?.billingPeriod?.end;
  if (end) {
    const ms = new Date(end).getTime() - Date.now();
    if (Number.isFinite(ms)) return Math.max(0, Math.ceil(ms / 86_400_000));
  }
  if (typeof customer?.trialDaysRemaining === 'number' && customer.trialDaysRemaining === 0) {
    return 0;
  }
  return null;
}

async function startServer() {
  const app = express();

  // 10mb: default 100kb would reject state-restore payloads before any
  // route-level parser could see them (global parser runs first).
  app.use(express.json({ limit: '10mb' }));

  // Auth: public status/setup/login/logout, then gate everything else under /api
  mountAuthRoutes(app);

  // Health check (public — Railway monitoring)
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api', authGuard);

  // Server-side app state (accounts, alerts) on Volume JSON file
  app.get('/api/state', (req, res) => {
    const exists = fs.existsSync(stateFilePath());
    const state = readState();
    // File exists but can't be parsed → DO NOT return an empty state: the
    // client would treat it as "fresh install" and save empties over it.
    if (exists && !state) {
      return res.status(500).json({ error: 'State file exists but is unreadable' });
    }
    res.json(
      state || {
        accounts: [],
        alerts: [],
        updatedAt: null,
      }
    );
  });

  app.put('/api/state', (req, res) => {
    try {
      const { accounts, alerts } = req.body || {};
      if (!Array.isArray(accounts)) {
        return res.status(400).json({ error: 'accounts must be an array' });
      }
      const saved = writeState({
        accounts,
        alerts: Array.isArray(alerts) ? alerts : [],
      });
      res.json({ success: true, updatedAt: saved.updatedAt });
    } catch (err: any) {
      console.error('State save error:', err);
      res.status(500).json({ error: err.message || 'Failed to save state' });
    }
  });

  // --- Telegram config + database backup / restore -------------------------
  // All routes below sit behind authGuard (mounted above), so they require a
  // valid session cookie like every other /api route.

  /** Validate a restore payload (shared by local-file and Telegram restores). */
  function validateRestoreBody(
    body: unknown
  ): { accounts: unknown[]; alerts: unknown[]; telegram?: unknown } | { error: string } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { error: 'فایل بک‌اپ باید یک آبجکت JSON باشد' };
    }
    const b = body as Record<string, unknown>;
    if (!Array.isArray(b.accounts) || !Array.isArray(b.alerts)) {
      return { error: 'فایل بک‌اپ معتبر نیست (فیلدهای accounts یا alerts پیدا نشد)' };
    }
    return { accounts: b.accounts, alerts: b.alerts, telegram: b.telegram };
  }

  function backupStamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(
      d.getMinutes()
    )}`;
  }

  app.get('/api/telegram/config', (req, res) => {
    res.json({ telegram: readTelegram() });
  });

  app.put('/api/telegram/config', (req, res) => {
    try {
      const botToken = String(req.body?.botToken ?? '').trim();
      const chatId = String(req.body?.chatId ?? '').trim();
      if (!botToken || !chatId) {
        return res.status(400).json({ error: 'توکن ربات و شناسه چت را وارد کنید' });
      }
      const prev = readTelegram();
      // Backups are addressed by file_id, which is only valid for the bot that
      // uploaded them — changing the token invalidates the recorded backup.
      const tokenChanged = !!prev && prev.botToken !== botToken;
      const telegram = writeTelegram({
        botToken,
        chatId,
        lastBackupAt: tokenChanged ? null : (prev?.lastBackupAt ?? null),
        lastBackupFileId: tokenChanged ? null : (prev?.lastBackupFileId ?? null),
        lastBackupFileName: tokenChanged ? null : (prev?.lastBackupFileName ?? null),
        lastBackupMessageId: tokenChanged ? null : (prev?.lastBackupMessageId ?? null),
      });
      res.json({ success: true, telegram });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'ذخیره تنظیمات ناموفق بود' });
    }
  });

  app.post('/api/telegram/test', async (req, res) => {
    try {
      const stored = readTelegram();
      const botToken = String(req.body?.botToken ?? '').trim() || stored?.botToken || '';
      const chatId = String(req.body?.chatId ?? '').trim() || stored?.chatId || '';
      if (!botToken) {
        return res.status(400).json({ error: 'توکن ربات وارد نشده است' });
      }
      const me = await tgGetMe(botToken);
      let messageSent = false;
      if (chatId) {
        await tgSendMessage(
          botToken,
          chatId,
          `اتصال موفق ✅\nربات ${me.username ? '@' + me.username : ''} به Railway Hub متصل شد.`
        );
        messageSent = true;
      }
      res.json({ ok: true, botUsername: me.username, messageSent });
    } catch (err) {
      res.status(400).json({ error: tgErrorToPersian(err) });
    }
  });

  app.post('/api/telegram/backup', async (req, res) => {
    try {
      const cfg = readTelegram();
      if (!cfg?.botToken || !cfg?.chatId) {
        return res.status(400).json({
          code: 'TELEGRAM_NOT_CONFIGURED',
          error: 'ابتدا تنظیمات اتصال تلگرام را ذخیره کنید',
        });
      }

      const exists = fs.existsSync(stateFilePath());
      const state = readState();
      if (exists && !state) {
        return res.status(500).json({ error: 'فایل دیتابیس خوانا نیست' });
      }
      // Self-contained backup: current state + the telegram block itself.
      const payload = {
        ...(state || { accounts: [], alerts: [] }),
        telegram: cfg,
      };
      const fileName = `hub-state-${backupStamp()}.json`;
      const sent = await tgSendDocument(cfg.botToken, cfg.chatId, JSON.stringify(payload, null, 2), fileName);
      if (!sent.fileId) {
        return res.status(502).json({ error: 'پاسخ تلگرام فاقد شناسه فایل بود؛ دوباره تلاش کنید' });
      }

      const lastBackupAt = new Date().toISOString();
      writeTelegram({
        ...cfg,
        lastBackupAt,
        lastBackupFileId: sent.fileId,
        lastBackupFileName: sent.fileName,
        lastBackupMessageId: sent.messageId,
      });
      res.json({ success: true, lastBackupAt, fileName: sent.fileName });
    } catch (err) {
      res.status(400).json({ error: tgErrorToPersian(err) });
    }
  });

  app.post('/api/telegram/restore', async (req, res) => {
    try {
      const cfg = readTelegram();
      if (!cfg?.botToken) {
        return res.status(400).json({
          code: 'TELEGRAM_NOT_CONFIGURED',
          error: 'ابتدا تنظیمات اتصال تلگرام را ذخیره کنید',
        });
      }
      if (!cfg.lastBackupFileId) {
        return res.status(400).json({
          code: 'NO_BACKUP_RECORDED',
          error: 'هنوز پشتیبانی در تلگرام ثبت نشده است؛ اول یک بک‌اپ بگیرید',
        });
      }

      const text = await tgDownloadFile(cfg.botToken, cfg.lastBackupFileId);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return res.status(400).json({
          code: 'INVALID_BACKUP_FILE',
          error: 'فایل بک‌اپ دریافتی از تلگرام JSON معتبر نیست',
        });
      }

      const validated = validateRestoreBody(parsed);
      if ('error' in validated) {
        return res.status(400).json({ code: 'INVALID_BACKUP_FILE', error: validated.error });
      }

      restoreState(validated);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: tgErrorToPersian(err) });
    }
  });

  app.get('/api/backup/download', (req, res) => {
    let raw: string;
    try {
      raw = fs.readFileSync(stateFilePath(), 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    } catch {
      return res.status(500).json({ error: 'فایل دیتابیس خوانا نیست' });
    }
    const fileName = `hub-state-${backupStamp()}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(raw);
  });

  app.post('/api/backup/restore', (req, res) => {
    try {
      const validated = validateRestoreBody(req.body);
      if ('error' in validated) {
        return res.status(400).json({ code: 'INVALID_RESTORE_FILE', error: validated.error });
      }
      restoreState(validated);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'بازیابی دیتابیس ناموفق بود' });
    }
  });

  // Railway GraphQL Proxy endpoint to handle CORS and API queries safely
  app.post('/api/railway/graphql', async (req, res) => {
    try {
      const { token, query, variables } = req.body;
      if (!token) {
        return res.status(400).json({ error: 'Railway API token is required' });
      }

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query, variables }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      console.error('Railway API proxy error:', err);
      return res.status(500).json({ error: err.message || 'Internal proxy error' });
    }
  });


  /** Real domains for one service (service + custom), with Railway ids and ports. */
  async function fetchServiceDomains(
    token: string,
    projectId: string,
    serviceId: string,
    environmentId: string
  ): Promise<any[]> {
    if (!projectId || !serviceId || !environmentId) return [];
    try {
      const query = `
        query GetServiceDomains($projectId: String!, $serviceId: String!, $environmentId: String!) {
          domains(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId) {
            serviceDomains { id domain targetPort environmentId }
            customDomains { id domain targetPort environmentId }
          }
        }
      `;
      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query, variables: { projectId, serviceId, environmentId } }),
      });
      const data = await response.json();
      const d = data.data?.domains;
      const out: any[] = [];
      (d?.serviceDomains || []).forEach((sd: any) => {
        if (!sd?.id || !sd?.domain) return;
        out.push({
          id: sd.id,
          domain: sd.domain,
          targetPort: sd.targetPort ?? null,
          kind: 'service',
          environmentId: sd.environmentId || environmentId,
        });
      });
      (d?.customDomains || []).forEach((cd: any) => {
        if (!cd?.id || !cd?.domain) return;
        out.push({
          id: cd.id,
          domain: cd.domain,
          targetPort: cd.targetPort ?? null,
          kind: 'custom',
          environmentId: cd.environmentId || environmentId,
        });
      });
      return out;
    } catch (e) {
      console.error('fetchServiceDomains failed', e);
      return [];
    }
  }

  /** Maps a Railway deployment node to the hub's ServiceStatus vocabulary. */
  function mapDeploymentStatus(node: any): string {
    if (!node) return 'deploying'; // service created, first deployment not queued yet
    if (node.deploymentStopped) return 'stopped';
    switch (node.status) {
      case 'SUCCESS':
        return 'healthy';
      case 'BUILDING':
      case 'DEPLOYING':
      case 'INITIALIZING':
      case 'QUEUED':
      case 'WAITING':
      case 'NEEDS_APPROVAL':
        return 'deploying';
      case 'CRASHED':
      case 'FAILED':
        return 'crashed';
      case 'SLEEPING':
        return 'sleeping';
      case 'REMOVED':
      case 'REMOVING':
      case 'SKIPPED':
        return 'stopped';
      default:
        return 'deploying';
    }
  }

  /** Newest deployment per service of a project (client-side sort by createdAt,
   *  so we never depend on the connection's edge order). */
  async function fetchLatestDeploymentsByService(
    token: string,
    projectId: string
  ): Promise<Map<string, any>> {
    const map = new Map<string, any>();
    if (!projectId) return map;
    try {
      const query = `
        query GetProjectDeployments($projectId: String!) {
          deployments(first: 100, input: { projectId: $projectId, includeDeleted: true }) {
            edges {
              node {
                id
                status
                statusUpdatedAt
                createdAt
                serviceId
                environmentId
                deploymentStopped
              }
            }
          }
        }
      `;
      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query, variables: { projectId } }),
      });
      const data = await response.json();
      const nodes = (data.data?.deployments?.edges || [])
        .map((e: any) => e?.node)
        .filter((n: any) => n?.id && n?.serviceId)
        .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      for (const node of nodes) {
        if (!map.has(node.serviceId)) map.set(node.serviceId, node);
      }
    } catch (e) {
      console.error('fetchLatestDeploymentsByService failed', e);
    }
    return map;
  }

  /** Newest deployment of ONE service — the target for restart/redeploy/stop. */
  async function fetchLatestServiceDeployment(
    token: string,
    projectId: string,
    serviceId: string,
    environmentId?: string
  ): Promise<any | null> {
    if (!projectId || !serviceId) return null;
    try {
      const query = `
        query GetServiceDeployments($input: DeploymentListInput!, $first: Int) {
          deployments(input: $input, first: $first) {
            edges {
              node {
                id
                status
                statusUpdatedAt
                createdAt
                serviceId
                environmentId
                deploymentStopped
              }
            }
          }
        }
      `;
      const input: any = { projectId, serviceId, includeDeleted: true };
      if (environmentId) input.environmentId = environmentId;
      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query, variables: { input, first: 25 } }),
      });
      const data = await response.json();
      const nodes = (data.data?.deployments?.edges || [])
        .map((e: any) => e?.node)
        .filter((n: any) => n?.id)
        .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      return nodes[0] || null;
    } catch (e) {
      console.error('fetchLatestServiceDeployment failed', e);
      return null;
    }
  }

  /** Fetches all projects. Returns `null` when the Railway API could not be reached,
   *  so callers can distinguish a real empty account from a failed request and
   *  avoid marking live projects as deleted. */
  async function fetchAllProjectsWithDeleted(token: string): Promise<any[] | null> {
    const projectMap = new Map<string, any>();
    const deletedProjectNamesOrIds = new Set<string>();

    try {
      const meQuery = `
        query {
          me {
            id
            workspaces {
              id
            }
          }
        }
      `;
      const meRes = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query: meQuery }),
      });
      const meData = await meRes.json();
      const workspaces = meData.data?.me?.workspaces || [];

      for (const ws of workspaces) {
        if (!ws.id) continue;

        // Method 2: Fetch auditLogs for Project.deleted events
        try {
          const auditQuery = `
            query GetAuditLogs($wsId: String!) {
              auditLogs(first: 50, workspaceId: $wsId) {
                edges {
                  node {
                    eventType
                    createdAt
                    payload
                  }
                }
              }
            }
          `;
          const auditRes = await fetch('https://backboard.railway.app/graphql/v2', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token.trim()}`,
            },
            body: JSON.stringify({ query: auditQuery, variables: { wsId: ws.id } }),
          });
          const auditData = await auditRes.json();
          const auditEdges = auditData.data?.auditLogs?.edges || [];
          auditEdges.forEach((edge: any) => {
            const node = edge.node;
            if (node && node.eventType === 'Project.deleted') {
              if (node.payload) {
                // Match by unique project ID only. Railway payloads look like
                // { id, name }; names are NOT unique (auto-created projects
                // reuse names), so name-based matching falsely marks live
                // projects as deleted.
                if (typeof node.payload === 'string') {
                  deletedProjectNamesOrIds.add(node.payload);
                } else if (node.payload.id || node.payload.projectId) {
                  deletedProjectNamesOrIds.add(node.payload.id || node.payload.projectId);
                }
              }
            }
          });
        } catch (auditErr) {
          console.error('Failed fetching auditLogs', auditErr);
        }

        // Method 1: Query projects with includeDeleted: true
        const q = `
          query GetWorkspaceProjects($wsId: String!) {
            projects(includeDeleted: true, workspaceId: $wsId) {
              edges {
                node {
                  id
                  name
                  description
                  updatedAt
                  deletedAt
                  environments {
                    edges {
                      node {
                        id
                        name
                      }
                    }
                  }
                  services {
                    edges {
                      node {
                        id
                        name
                        icon
                      }
                    }
                  }
                }
              }
            }
          }
        `;
        const res = await fetch('https://backboard.railway.app/graphql/v2', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token.trim()}`,
          },
          body: JSON.stringify({ query: q, variables: { wsId: ws.id } }),
        });
        const data = await res.json();
        const edges = data.data?.projects?.edges || [];
        for (const edge of edges) {
          const pNode = edge.node;
          if (!pNode || !pNode.id || projectMap.has(pNode.id)) continue;

          const isDelByAudit = deletedProjectNamesOrIds.has(pNode.id);
          const isDeleted = !!pNode.deletedAt || isDelByAudit;

          const defaultEnvId = pNode.environments?.edges?.[0]?.node?.id || '';
          // Real deployment state per service (status pill, raw Railway status,
          // and the deployment id restart/redeploy/stop act on).
          const latestDeployments = isDeleted
            ? new Map<string, any>()
            : await fetchLatestDeploymentsByService(token, pNode.id);
          const importedServices: any[] = [];
          if (pNode.services?.edges) {
            for (const sEdge of pNode.services.edges) {
              const sNode = sEdge.node;
              // Fetch real domains (with Railway ids) so the UI can list and
              // delete them — placeholders like `name.up.railway.app` are not
              // real and cannot be deleted.
              const domains = isDeleted
                ? []
                : await fetchServiceDomains(token, pNode.id, sNode.id, defaultEnvId);
              const deployment = latestDeployments.get(sNode.id);
              importedServices.push({
                id: sNode.id,
                name: sNode.name,
                icon: sNode.icon || '',
                templateType: 'custom',
                imageOrRepo: 'railway-hosted',
                status: isDeleted ? 'stopped' : mapDeploymentStatus(deployment),
                latestDeploymentId: deployment?.id || '',
                deploymentStatus: deployment?.status || '',
                deploymentStatusAt: deployment?.statusUpdatedAt || deployment?.createdAt || '',
                deploymentStopped: !!deployment?.deploymentStopped,
                cpuUsage: 0,
                memoryUsage: 0,
                memoryLimit: 512,
                networkIn: 0,
                networkOut: 0,
                uptime: isDeleted
                  ? 'حذف شده'
                  : deployment
                    ? `آخرین استقرار: ${deployment.status}`
                    : 'در انتظار اولین استقرار',
                restartsCount: 0,
                region: 'us-east-1',
                port: domains.find((d: any) => d.targetPort)?.targetPort || 8080,
                healthEndpoint: '/health',
                domains,
                envVars: {},
                createdAt: pNode.updatedAt || new Date().toISOString(),
                updatedAt: pNode.updatedAt || new Date().toISOString(),
              });
            }
          }

          projectMap.set(pNode.id, {
            id: pNode.id,
            name: pNode.name,
            description: pNode.description || (isDeleted ? 'پروژه حذف شده در اکانت ریلوی' : 'پروژه استخراج شده از اکانت ریلوی'),
            environment: 'production',
            defaultEnvironmentId: defaultEnvId,
            services: importedServices,
            createdAt: pNode.updatedAt || new Date().toISOString(),
            updatedAt: pNode.updatedAt || new Date().toISOString(),
            isExternal: true,
            isDeletedOnRailway: isDeleted,
            deletedAt: pNode.deletedAt || (isDeleted ? new Date().toISOString() : undefined),
          });
        }
      }
    } catch (e) {
      console.error('Failed fetching projects with includeDeleted', e);
      return null;
    }
    return Array.from(projectMap.values());
  }

  // Validate Token & Extract Account Balance / Credit Limits Endpoint
  app.post('/api/railway/validate-token', async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ valid: false, error: 'Token is missing' });
      }

      const query = `
        query {
          me {
            id
            name
            email
            username
            avatar
            workspaces {
              id
              name
              plan
              preferredRegion
              subscriptionPlanLimit
              customer {
                creditBalance
                currentUsage
                remainingUsageCreditBalance
                appliedCredits
                state
                isTrialing
                trialDaysRemaining
                hasExhaustedFreePlan
                billingPeriod {
                  start
                  end
                }
                usageLimit {
                  hardLimit
                  softLimit
                  isOverLimit
                }
              }
            }
          }
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query }),
      });

      const data = await response.json();
      if (data.data && data.data.me) {
        const user = data.data.me;
        const workspace = user.workspaces?.[0];
        const customer = workspace?.customer;
        const planName = workspace?.plan || 'FREE';

        // Authoritative per-plan limits from Railway (do not hardcode).
        // Free = 1 project, $5 Trial/Hobby = more; the API reports the real numbers.
        const planLimit = workspace?.subscriptionPlanLimit;
        const projectLimit: number | null =
          typeof planLimit?.projects === 'number' ? planLimit.projects : null;
        const serviceLimitPerProject: number | null =
          typeof planLimit?.project?.services === 'number' ? planLimit.project.services : null;

        const isTrialing = !!customer?.isTrialing;
        const trialDaysRemaining = customer?.trialDaysRemaining ?? null;

        const creditUsed = Number((customer?.currentUsage || 0).toFixed(2));
        const creditRemaining = Number(
          (customer?.remainingUsageCreditBalance !== undefined
            ? customer.remainingUsageCreditBalance
            : (customer?.creditBalance || 0)
          ).toFixed(2)
        );

        let creditLimit = 1.0;
        if (customer?.appliedCredits && customer.appliedCredits > 0) {
          creditLimit = Number(customer.appliedCredits.toFixed(2));
        } else if (customer?.usageLimit?.hardLimit) {
          creditLimit = Number(customer.usageLimit.hardLimit.toFixed(2));
        } else if (creditUsed + creditRemaining > 0) {
          creditLimit = Number((creditUsed + creditRemaining).toFixed(2));
        } else {
          creditLimit = planName === 'FREE' ? 1.00 : 50.00;
        }

        // On a failed fetch, fall back to an empty list here: account creation still
// succeeds and the client syncs projects separately.
        const importedProjects = (await fetchAllProjectsWithDeleted(token)) ?? [];
        const projectsCount = importedProjects.filter(p => !p.isDeletedOnRailway).length;
        const servicesCount = importedProjects.reduce((acc, p) => acc + p.services.length, 0);

        return res.json({
          valid: true,
          user: {
            id: user.id,
            name: user.name || user.username || 'Railway User',
            email: user.email,
            username: user.username,
            avatar: user.avatar,
          },
          extractedInfo: {
            workspaceId: workspace?.id || '',
            preferredRegion: workspace?.preferredRegion ?? null,
            plan: isTrialing
              ? 'Trial'
              : planName === 'FREE' ? 'Free' : planName === 'HOBBY' ? 'Hobby' : 'Pro',
            basePlan: planName,
            isTrialing,
            trialDaysRemaining,
            creditExpiresInDays: computeCreditExpiresInDays(customer),
            billingPeriodEnd: customer?.billingPeriod?.end ?? null,
            projectLimit,
            serviceLimitPerProject,
            creditLimit,
            creditUsed,
            creditRemaining,
            projectsCount,
            servicesCount,
            projects: importedProjects,
          },
        });
      } else {
        return res.json({
          valid: false,
          error: data.errors?.[0]?.message || 'Invalid Railway token or insufficient permissions',
        });
      }
    } catch (err: any) {
      return res.status(500).json({ valid: false, error: err.message || 'Validation request failed' });
    }
  });

  // Account-level default region (workspace.preferredRegion) — applies to NEW
  // services/volumes created under this account. workspaceUpdate returns Boolean!.
  app.post('/api/railway/workspace/region', async (req, res) => {
    try {
      const { token, region, workspaceId } = req.body;
      if (!token || !region) {
        return res.status(400).json({ error: 'token and region are required' });
      }

      // Region codes Railway accepts (from the regions query): iad, sin, pdx, ams, sfo
      const allowed = ['iad', 'sin', 'pdx', 'ams', 'sfo'];
      if (!allowed.includes(String(region))) {
        return res.status(400).json({ error: `Invalid region "${region}". Allowed: ${allowed.join(', ')}` });
      }

      let wsId = workspaceId || '';
      if (!wsId) {
        const meRes = await fetch('https://backboard.railway.app/graphql/v2', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token.trim()}`,
          },
          body: JSON.stringify({ query: 'query { me { workspaces { id } } }' }),
        });
        const meData = await meRes.json();
        wsId = meData?.data?.me?.workspaces?.[0]?.id || '';
      }
      if (!wsId) {
        return res.status(400).json({ error: 'Could not resolve Railway workspaceId' });
      }

      const query = `
        mutation UpdateWorkspace($id: String!, $input: WorkspaceUpdateInput!) {
          workspaceUpdate(id: $id, input: $input)
        }
      `;
      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query, variables: { id: wsId, input: { preferredRegion: region } } }),
      });

      const data = await response.json();
      if (data.errors) return res.status(response.status).json(data);

      return res.json({ ok: data?.data?.workspaceUpdate === true, region, workspaceId: wsId });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to update account region' });
    }
  });

  // Dedicated endpoint to sync all current projects & services from Railway for an account token
  app.post('/api/railway/sync-projects', async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'Token is required' });

      const projectsList = await fetchAllProjectsWithDeleted(token);

      // A failed fetch must not be reported as "no projects" — the client would
      // otherwise mark every live project as deleted on Railway.
      if (projectsList === null) {
        return res.status(502).json({
          error: 'ارتباط با ریلوی برقرار نشد؛ همگامسازی انجام نشد تا وضعیت پروژهها خراب نشود.',
          code: 'RAILWAY_UNREACHABLE',
        });
      }

      // Also refresh the live plan limits so existing accounts pick up plan changes.
      const quota = await fetchPlanLimits(token);

      return res.json({
        projects: projectsList,
        count: projectsList.length,
        projectLimit: quota.projectLimit,
        serviceLimitPerProject: quota.serviceLimitPerProject,
        isTrialing: quota.isTrialing,
        trialDaysRemaining: quota.trialDaysRemaining,
        creditExpiresInDays: quota.creditExpiresInDays,
        billingPeriodEnd: quota.billingPeriodEnd,
        preferredRegion: quota.preferredRegion,
        creditLimit: quota.creditLimit,
        creditUsed: quota.creditUsed,
        creditRemaining: quota.creditRemaining,
        plan: quota.plan,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to sync projects' });
    }
  });

  // Read the account's live plan limits and the real credit usage from Railway.
  async function fetchPlanLimits(token: string): Promise<{
    projectLimit: number | null;
    serviceLimitPerProject: number | null;
    isTrialing: boolean;
    trialDaysRemaining: number | null;
    creditExpiresInDays: number | null;
    billingPeriodEnd: string | null;
    creditLimit: number | null;
    creditUsed: number | null;
    creditRemaining: number | null;
    plan: string | null;
    preferredRegion: string | null;
  }> {
    const query = `
      query {
        me {
          workspaces {
            plan
            preferredRegion
            subscriptionPlanLimit
            customer {
              isTrialing
              trialDaysRemaining
              currentUsage
              remainingUsageCreditBalance
              creditBalance
              appliedCredits
              billingPeriod {
                start
                end
              }
              usageLimit {
                hardLimit
              }
            }
          }
        }
      }
    `;
    try {
      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query }),
      });
      const data = await response.json();
      const ws = data.data?.me?.workspaces?.[0];
      const customer = ws?.customer;
      const rawLimit = ws?.subscriptionPlanLimit?.projects;
      const rawServiceLimit = ws?.subscriptionPlanLimit?.project?.services;

      const creditUsed =
        customer?.currentUsage !== undefined ? Number(customer.currentUsage.toFixed(4)) : null;
      const creditRemaining =
        customer?.remainingUsageCreditBalance !== undefined
          ? Number(customer.remainingUsageCreditBalance.toFixed(4))
          : customer?.creditBalance !== undefined
            ? Number(customer.creditBalance.toFixed(4))
            : null;

      let creditLimit: number | null = null;
      if (customer?.appliedCredits && customer.appliedCredits > 0) {
        creditLimit = Number(customer.appliedCredits.toFixed(2));
      } else if (customer?.usageLimit?.hardLimit) {
        creditLimit = Number(customer.usageLimit.hardLimit.toFixed(2));
      } else if (creditUsed !== null && creditRemaining !== null && creditUsed + creditRemaining > 0) {
        creditLimit = Number((creditUsed + creditRemaining).toFixed(2));
      } else if (ws?.plan === 'FREE') {
        creditLimit = 1.0;
      }

      return {
        projectLimit: typeof rawLimit === 'number' ? rawLimit : null,
        serviceLimitPerProject: typeof rawServiceLimit === 'number' ? rawServiceLimit : null,
        isTrialing: !!customer?.isTrialing,
        trialDaysRemaining: customer?.trialDaysRemaining ?? null,
        creditExpiresInDays: computeCreditExpiresInDays(customer),
        billingPeriodEnd: customer?.billingPeriod?.end ?? null,
        creditLimit,
        creditUsed,
        creditRemaining,
        plan: ws?.plan ?? null,
        preferredRegion: ws?.preferredRegion ?? null,
      };
    } catch (err) {
      console.error('fetchPlanLimits failed', err);
      return {
        projectLimit: null,
        serviceLimitPerProject: null,
        isTrialing: false,
        trialDaysRemaining: null,
        creditExpiresInDays: null,
        billingPeriodEnd: null,
        creditLimit: null,
        creditUsed: null,
        creditRemaining: null,
        plan: null,
        preferredRegion: null,
      };
    }
  }

  // Helper function to resolve real workspaceId, projectId, and defaultEnvironmentId
  async function resolveRailwayTargetIds(token: string, inputProjectId?: string, inputWorkspaceId?: string, skipAutoCreate = false) {
    let resolvedWorkspaceId = inputWorkspaceId || '';
    let resolvedProjectId = inputProjectId || '';
    let resolvedEnvId = '';
    // True when the caller asked for a specific project id that no longer
    // exists on Railway (deleted elsewhere / stale hub state). Deploy endpoints
    // use this to recreate the project instead of failing or redirecting.
    let requestedProjectMissing = false;

    const meQuery = `
      query {
        me {
          id
          workspaces {
            id
            name
            projects {
              edges {
                node {
                  id
                  name
                  environments {
                    edges {
                      node {
                        id
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const meRes = await fetch('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.trim()}`,
      },
      body: JSON.stringify({ query: meQuery }),
    });

    const meData = await meRes.json();
    const ws = meData.data?.me?.workspaces?.[0];
    if (ws) {
      if (!resolvedWorkspaceId) resolvedWorkspaceId = ws.id;

      // Find matching project or use first project
      const projects = ws.projects?.edges || [];
      let targetProjNode = projects.find((p: any) => p.node.id === resolvedProjectId)?.node;

      // Compute BEFORE the first-project fallback below: the caller's exact
      // project id was enumerated against Railway and did not match.
      if (!targetProjNode && resolvedProjectId) requestedProjectMissing = true;

      if (!targetProjNode && projects.length > 0) {
        targetProjNode = projects[0].node;
        resolvedProjectId = targetProjNode.id;
      }

      if (targetProjNode) {
        const envs = targetProjNode.environments?.edges || [];
        if (envs.length > 0) {
          resolvedEnvId = envs[0].node.id;
        }
      }
    }

    // If still no project exists on Railway, create one!
    // skipAutoCreate is set by the project-create endpoint: that flow checks
    // quota and creates the user's project itself, so it must not silently
    // consume the plan's project slot with an auto-created placeholder.
    if (!skipAutoCreate && !resolvedProjectId && resolvedWorkspaceId) {
      const createQuery = `
        mutation CreateProject($input: ProjectCreateInput!) {
          projectCreate(input: $input) {
            id
            environments {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      `;

      const createRes = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query: createQuery,
          variables: {
            input: {
              workspaceId: resolvedWorkspaceId,
              name: 'Hub-Auto-Project',
            },
          },
        }),
      });

      const createData = await createRes.json();
      if (createData.data?.projectCreate) {
        resolvedProjectId = createData.data.projectCreate.id;
        resolvedEnvId = createData.data.projectCreate.environments?.edges?.[0]?.node?.id || '';
      }
    }

    return {
      workspaceId: resolvedWorkspaceId,
      projectId: resolvedProjectId,
      environmentId: resolvedEnvId,
      requestedProjectMissing,
    };
  }

  // Fetch the authoritative per-plan project limit and current live project count.
  // Railway reports the real number for each plan (Free = 1, Trial/Hobby = more),
  // so we never hardcode a limit here.
  async function fetchProjectQuota(token: string, wsId: string): Promise<{
    limit: number | null;
    current: number;
  }> {
    const query = `
      query GetQuota($wsId: String!) {
        workspace(workspaceId: $wsId) {
          subscriptionPlanLimit
        }
        projects(includeDeleted: false, workspaceId: $wsId) {
          edges {
            node { id }
          }
        }
      }
    `;
    try {
      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query, variables: { wsId } }),
      });
      const data = await response.json();
      const rawLimit = data.data?.workspace?.subscriptionPlanLimit?.projects;
      const limit = typeof rawLimit === 'number' ? rawLimit : null;
      const current = (data.data?.projects?.edges || []).length;
      return { limit, current };
    } catch (err) {
      console.error('fetchProjectQuota failed', err);
      return { limit: null, current: 0 };
    }
  }

  // Creates a fresh project for a deploy whose requested project no longer
  // exists on Railway, so the deploy can proceed instead of erroring out.
  // Quota is checked first so the plan's limit surfaces as a readable error.
  async function createReplacementProject(token: string, wsId: string): Promise<
    | { ok: true; projectId: string; environmentId: string }
    | { ok: false; error: string; code: string }
  > {
    if (!wsId) {
      return { ok: false, error: 'Could not resolve Railway workspaceId for token', code: 'WORKSPACE_UNRESOLVED' };
    }

    const quota = await fetchProjectQuota(token, wsId);
    if (quota.limit !== null && quota.current >= quota.limit) {
      return {
        ok: false,
        error: `سقف پروژه این اکانت پر شده است (${quota.current} از ${quota.limit}). برای ساخت پروژه بیشتر باید پلن را ارتقا دهید.`,
        code: 'PROJECT_LIMIT_REACHED',
      };
    }

    try {
      const query = `
        mutation CreateProject($input: ProjectCreateInput!) {
          projectCreate(input: $input) {
            id
            environments {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: {
            input: {
              workspaceId: wsId,
              name: 'Hub-Auto-Project',
              description: 'Created automatically during deploy — the requested project no longer exists',
            },
          },
        }),
      });

      const data = await response.json();
      const created = data.data?.projectCreate;
      if (!created?.id) {
        return {
          ok: false,
          error: data.errors?.[0]?.message || 'ساخت خودکار پروژه روی ریلوی ناموفق بود',
          code: 'PROJECT_CREATE_FAILED',
        };
      }
      return {
        ok: true,
        projectId: created.id,
        environmentId: created.environments?.edges?.[0]?.node?.id || '',
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message || 'ساخت خودکار پروژه روی ریلوی ناموفق بود',
        code: 'PROJECT_CREATE_FAILED',
      };
    }
  }

  // Project Create Proxy
  app.post('/api/railway/project/create', async (req, res) => {
    try {
      const { token, workspaceId, name, description, isPublic } = req.body;
      if (!token) return res.status(400).json({ error: 'Token is required' });

      // Resolve workspaceId if missing (never auto-create here — quota is
      // checked below and the projectCreate mutation handles creation).
      const targets = await resolveRailwayTargetIds(token, undefined, workspaceId, true);
      const wsId = workspaceId || targets.workspaceId;

      if (!wsId) {
        return res.status(400).json({ error: 'Could not resolve Railway workspaceId for token' });
      }

      // Enforce the plan's real project limit before calling Railway.
      const quota = await fetchProjectQuota(token, wsId);
      if (quota.limit !== null && quota.current >= quota.limit) {
        return res.status(403).json({
          error: `سقف پروژه این اکانت پر شده است (${quota.current} از ${quota.limit}). برای ساخت پروژه بیشتر باید پلن را ارتقا دهید.`,
          code: 'PROJECT_LIMIT_REACHED',
          limit: quota.limit,
          current: quota.current,
        });
      }

      const query = `
        mutation CreateProject($input: ProjectCreateInput!) {
          projectCreate(input: $input) {
            id
            name
            description
            createdAt
            environments {
              edges {
                node {
                  id
                  name
                }
              }
            }
          }
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: {
            input: {
              workspaceId: wsId,
              name: name || 'New Railway Project',
              description: description || 'Created from Railway Hub Manager',
              isPublic: !!isPublic,
            },
          },
        }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to create project' });
    }
  });

  // Project Delete Proxy
  app.post('/api/railway/project/delete', async (req, res) => {
    try {
      const { token, projectId } = req.body;
      if (!token || !projectId) return res.status(400).json({ error: 'Token and projectId are required' });

      const query = `
        mutation ProjectDelete($id: String!) {
          projectDelete(id: $id)
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: { id: projectId },
        }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to delete project' });
    }
  });

  // GitHub Repo Deploy Proxy
  app.post('/api/railway/deploy/github', async (req, res) => {
    try {
      const { token, projectId, repo, branch = 'main', environmentId } = req.body;
      if (!token || !repo) return res.status(400).json({ error: 'Token and repo are required' });

      // Railway's GitHubRepoDeployInput only understands bare `owner/repo`,
      // so any pasted URL (…/terminal.git, ssh, www, trailing slash…) must be
      // normalized first — otherwise the deploy silently fails downstream.
      const normalizedRepo = normalizeGitHubRepo(String(repo));
      if (!normalizedRepo) {
        return res.status(400).json({
          error: 'آدرس ریپوی گیت‌هاب معتبر نیست. نمونه درست: https://github.com/owner/repository.git یا owner/repository',
        });
      }

      const targets = await resolveRailwayTargetIds(token, projectId);
      let realProjId = targets.projectId;
      let realEnvId = environmentId || targets.environmentId;

      // The requested project no longer exists on Railway — create a fresh
      // one for this deploy instead of failing or redirecting into another
      // existing project. (Any environmentId from the old project is invalid
      // on the new one, so it is replaced with the new project's environment.)
      if (projectId && targets.requestedProjectMissing) {
        const replacement = await createReplacementProject(token, targets.workspaceId);
        if (!replacement.ok) {
          return res.status(403).json({ error: replacement.error, code: replacement.code });
        }
        realProjId = replacement.projectId;
        realEnvId = replacement.environmentId;
      }

      if (!realProjId) return res.status(400).json({ error: 'Could not resolve real Railway projectId' });

      const query = `
        mutation GitHubDeploy($input: GitHubRepoDeployInput!) {
          githubRepoDeploy(input: $input)
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: {
            input: {
              projectId: realProjId,
              repo: normalizedRepo,
              branch: (typeof branch === 'string' && branch.trim()) || 'main',
              environmentId: realEnvId || undefined,
            },
          },
        }),
      });

      const data = await response.json();
      return res.status(response.status).json({ ...data, resolvedProjectId: realProjId, resolvedEnvironmentId: realEnvId, repo: normalizedRepo });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'GitHub repo deploy failed' });
    }
  });

  // GitHub repo access check — two separate queries because they fail
  // independently:
  // 1. gitHubRepoAccessAvailable — works for PUBLIC repos even when the
  //    connected GitHub App account is suspended (this is why the Railway
  //    dashboard can still deploy public repos).
  // 2. githubRepo — goes through the GitHub App and returns
  //    "Sorry. Your account was suspended" when the App is blocked. That
  //    only costs us the default-branch hint; it must NOT block deploy.
  app.post('/api/railway/github/repo-info', async (req, res) => {
    try {
      const { token, repo } = req.body;
      if (!token || !repo) return res.status(400).json({ error: 'Token and repo are required' });

      const normalizedRepo = normalizeGitHubRepo(String(repo));
      if (!normalizedRepo) {
        return res.status(400).json({ error: 'آدرس ریپوی گیت‌هاب معتبر نیست.' });
      }

      const accessQuery = `
        query GetRepoAccess($fullRepoName: String!) {
          gitHubRepoAccessAvailable(fullRepoName: $fullRepoName) {
            hasAccess
            isPublic
          }
        }
      `;
      const repoQuery = `
        query GetRepo($fullRepoName: String!) {
          githubRepo(fullRepoName: $fullRepoName) {
            fullName
            defaultBranch
            isPrivate
            name
            description
          }
        }
      `;

      const [accessRes, repoRes] = await Promise.all([
        fetch('https://backboard.railway.app/graphql/v2', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token.trim()}`,
          },
          body: JSON.stringify({ query: accessQuery, variables: { fullRepoName: normalizedRepo } }),
        }),
        fetch('https://backboard.railway.app/graphql/v2', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token.trim()}`,
          },
          body: JSON.stringify({ query: repoQuery, variables: { fullRepoName: normalizedRepo } }),
        }),
      ]);

      const accessData = await accessRes.json();
      const repoData = await repoRes.json();

      // Shape kept compatible with the old client: top-level `data.githubRepo`
      // when available, plus explicit access/error fields for the suspended case.
      return res.json({
        repo: normalizedRepo,
        data: {
          githubRepo: repoData?.data?.githubRepo ?? null,
          gitHubRepoAccessAvailable: accessData?.data?.gitHubRepoAccessAvailable ?? null,
        },
        githubRepoAccessAvailable: accessData?.data?.gitHubRepoAccessAvailable ?? null,
        githubRepoError: repoData?.errors?.[0]?.message || null,
        errors: repoData?.errors || accessData?.errors || undefined,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'GitHub repo check failed' });
    }
  });

  // Docker Compose Import Proxy
  app.post('/api/railway/deploy/docker-compose', async (req, res) => {
    try {
      const { token, projectId, environmentId, yaml } = req.body;
      if (!token || !yaml) return res.status(400).json({ error: 'Token and YAML content are required' });

      const targets = await resolveRailwayTargetIds(token, projectId);
      let realProjId = targets.projectId;
      // Older clients sent the literal string 'production' here; always resolve
      // the real environment UUID server-side instead of trusting the input.
      let realEnvId =
        environmentId && environmentId !== 'production' ? environmentId : targets.environmentId;

      // Requested project is gone from Railway → import into a fresh project
      // created for this deploy (the old project's environment doesn't apply).
      if (projectId && targets.requestedProjectMissing) {
        const replacement = await createReplacementProject(token, targets.workspaceId);
        if (!replacement.ok) {
          return res.status(403).json({ error: replacement.error, code: replacement.code });
        }
        realProjId = replacement.projectId;
        realEnvId = replacement.environmentId;
      }

      if (!realProjId || !realEnvId) {
        return res.status(400).json({ error: 'Could not resolve real Railway projectId or environmentId' });
      }

      const query = `
        mutation ImportCompose($projectId: String!, $environmentId: String!, $yaml: String!) {
          dockerComposeImport(projectId: $projectId, environmentId: $environmentId, yaml: $yaml) {
            errors
            patch
          }
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: {
            projectId: realProjId,
            environmentId: realEnvId,
            yaml,
          },
        }),
      });

      const data = await response.json();
      return res.status(response.status).json({ ...data, resolvedProjectId: realProjId, resolvedEnvironmentId: realEnvId });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Docker compose import failed' });
    }
  });

  // Service Create / Docker Image Registry Deploy Proxy
  app.post('/api/railway/deploy/service-create', async (req, res) => {
    try {
      const { token, projectId, environmentId, name, icon, image, variables } = req.body;
      if (!token) return res.status(400).json({ error: 'Token is required' });

      const targets = await resolveRailwayTargetIds(token, projectId);
      let realProjId = targets.projectId;
      let realEnvId = environmentId || targets.environmentId;

      // Requested project is gone from Railway → create a fresh project for
      // this service instead of failing (old environmentId doesn't apply).
      if (projectId && targets.requestedProjectMissing) {
        const replacement = await createReplacementProject(token, targets.workspaceId);
        if (!replacement.ok) {
          return res.status(403).json({ error: replacement.error, code: replacement.code });
        }
        realProjId = replacement.projectId;
        realEnvId = replacement.environmentId;
      }

      if (!realProjId) return res.status(400).json({ error: 'Could not resolve real Railway projectId' });

      const query = `
        mutation CreateService($input: ServiceCreateInput!) {
          serviceCreate(input: $input) {
            id
            name
            createdAt
          }
        }
      `;

      const variablesObj: any = {
        projectId: realProjId,
        environmentId: realEnvId,
        name: name || 'new-service',
        icon: icon || '⚡',
      };

      if (image) {
        variablesObj.source = { image };
      }
      if (variables && Object.keys(variables).length > 0) {
        variablesObj.variables = variables;
      }

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: { input: variablesObj },
        }),
      });

      const data = await response.json();
      return res.status(response.status).json({ ...data, resolvedProjectId: realProjId, resolvedEnvironmentId: realEnvId });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Service creation failed' });
    }
  });

  // Shared resolver for lifecycle mutations: find the service's newest
  // deployment (restart/redeploy/stop all target a deployment, not a service).
  async function resolveDeploymentTarget(req: any, res: any): Promise<any | null> {
    const { token, projectId, serviceId, environmentId } = req.body;
    if (!token || !projectId || !serviceId) {
      res.status(400).json({ error: 'token, projectId and serviceId are required' });
      return null;
    }
    const deployment = await fetchLatestServiceDeployment(token, projectId, serviceId, environmentId);
    if (!deployment) {
      res.status(404).json({
        error: 'هنوز استقراری برای این سرویس روی ریلوی وجود ندارد. ابتدا یک دیپلوی انجام دهید.',
        code: 'NO_DEPLOYMENT',
      });
      return null;
    }
    return deployment;
  }

  // Restart a service's latest deployment (deploymentRestart) — restarts the
  // running container without a rebuild.
  app.post('/api/railway/service/restart', async (req, res) => {
    try {
      const { token } = req.body;
      const deployment = await resolveDeploymentTarget(req, res);
      if (!deployment) return;

      const query = `
        mutation RestartDeployment($id: String!) {
          deploymentRestart(id: $id)
        }
      `;
      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query, variables: { id: deployment.id } }),
      });
      const data = await response.json();
      return res.status(response.status).json({
        ...data,
        deploymentId: deployment.id,
        previousStatus: deployment.status,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Service restart failed' });
    }
  });

  // Redeploy a service's latest deployment (deploymentRedeploy) — queues a NEW
  // deployment from the same source (rebuild / re-pull).
  app.post('/api/railway/service/redeploy', async (req, res) => {
    try {
      const { token } = req.body;
      const deployment = await resolveDeploymentTarget(req, res);
      if (!deployment) return;

      const query = `
        mutation RedeployDeployment($id: String!) {
          deploymentRedeploy(id: $id) {
            id
            status
            createdAt
            serviceId
            environmentId
          }
        }
      `;
      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query, variables: { id: deployment.id } }),
      });
      const data = await response.json();
      return res.status(response.status).json({
        ...data,
        previousDeploymentId: deployment.id,
        previousStatus: deployment.status,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Service redeploy failed' });
    }
  });

  // Stop a service's latest deployment (deploymentStop) — stops the running
  // container; deploymentRestart brings it back.
  app.post('/api/railway/service/stop', async (req, res) => {
    try {
      const { token } = req.body;
      const deployment = await resolveDeploymentTarget(req, res);
      if (!deployment) return;

      const query = `
        mutation StopDeployment($id: String!) {
          deploymentStop(id: $id)
        }
      `;
      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query, variables: { id: deployment.id } }),
      });
      const data = await response.json();
      return res.status(response.status).json({ ...data, deploymentId: deployment.id });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Service stop failed' });
    }
  });

  // Delete a service on Railway (serviceDelete) — removes it for real so the
  // next sync doesn't resurrect it.
  app.post('/api/railway/service/delete', async (req, res) => {
    try {
      const { token, serviceId, environmentId } = req.body;
      if (!token || !serviceId) return res.status(400).json({ error: 'token and serviceId are required' });

      const query = `
        mutation DeleteService($id: String!, $environmentId: String) {
          serviceDelete(id: $id, environmentId: $environmentId)
        }
      `;
      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: { id: serviceId, environmentId: environmentId || null },
        }),
      });
      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Service deletion failed' });
    }
  });

  // 1. Variable Upsert Proxy
  app.post('/api/railway/variables/upsert', async (req, res) => {
    try {
      const { token, projectId, environmentId, serviceId, name, value, skipDeploys = false } = req.body;
      if (!token || !name) return res.status(400).json({ error: 'token and name are required' });

      const targets = await resolveRailwayTargetIds(token, projectId);
      const realProjId = targets.projectId;
      const realEnvId = environmentId || targets.environmentId;

      const query = `
        mutation UpsertVar($input: VariableUpsertInput!) {
          variableUpsert(input: $input)
        }
      `;

      const input: any = {
        projectId: realProjId,
        environmentId: realEnvId,
        name,
        value: value || '',
        skipDeploys: !!skipDeploys,
      };
      if (serviceId) input.serviceId = serviceId;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query, variables: { input } }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Variable upsert failed' });
    }
  });

  // 2. Variable Delete Proxy
  app.post('/api/railway/variables/delete', async (req, res) => {
    try {
      const { token, projectId, environmentId, name } = req.body;
      if (!token || !name) return res.status(400).json({ error: 'token and name are required' });

      const targets = await resolveRailwayTargetIds(token, projectId);
      const realProjId = targets.projectId;
      const realEnvId = environmentId || targets.environmentId;

      const query = `
        mutation DeleteVar($input: VariableDeleteInput!) {
          variableDelete(input: $input)
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: {
            input: {
              projectId: realProjId,
              environmentId: realEnvId,
              name,
            },
          },
        }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Variable delete failed' });
    }
  });

  // 3. Free Subdomain Create Proxy (*.up.railway.app)
  // Railway's ServiceDomainCreateInput has NO projectId field — sending it
  // fails with "Field projectId is not defined". Only environmentId +
  // serviceId (+ optional targetPort) are valid. targetPort matters: Railway
  // defaults to 8080; without the right port the deploy succeeds but the
  // domain returns 502.
  app.post('/api/railway/domain/create-subdomain', async (req, res) => {
    try {
      const { token, projectId, environmentId, serviceId, targetPort = 3000 } = req.body;
      if (!token || !serviceId) return res.status(400).json({ error: 'token and serviceId required' });

      // Resolve the real environment UUID when the client didn't send one.
      // Never fall back to the literal string 'production' — it is not a UUID.
      let realEnvId = environmentId && /^[0-9a-f-]{36}$/i.test(environmentId) ? environmentId : '';
      if (!realEnvId) {
        const targets = await resolveRailwayTargetIds(token, projectId, undefined, true);
        realEnvId = targets.environmentId || '';
        if (!realEnvId) {
          return res.status(400).json({ error: 'Could not resolve Railway environmentId for this project' });
        }
      }

      const query = `
        mutation CreateServiceDomain($input: ServiceDomainCreateInput!) {
          serviceDomainCreate(input: $input) {
            id
            domain
          }
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: {
            input: {
              environmentId: realEnvId,
              serviceId,
              targetPort: Number(targetPort),
            },
          },
        }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Subdomain creation failed' });
    }
  });

  // 3b. Update targetPort on an existing service domain (serviceDomainUpdate).
  // Output is Boolean! — no selection set allowed.
  app.post('/api/railway/domain/update-subdomain-port', async (req, res) => {
    try {
      const { token, projectId, environmentId, serviceId, serviceDomainId, domain, targetPort } = req.body;
      if (!token || !serviceDomainId || !domain) {
        return res.status(400).json({ error: 'token, serviceDomainId and domain are required' });
      }

      let realEnvId = environmentId && /^[0-9a-f-]{36}$/i.test(environmentId) ? environmentId : '';
      if (!realEnvId) {
        const targets = await resolveRailwayTargetIds(token, projectId, undefined, true);
        realEnvId = targets.environmentId || '';
      }
      if (!realEnvId) {
        return res.status(400).json({ error: 'Could not resolve Railway environmentId' });
      }

      const query = `
        mutation UpdateServiceDomain($input: ServiceDomainUpdateInput!) {
          serviceDomainUpdate(input: $input)
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: {
            input: {
              domain,
              environmentId: realEnvId,
              serviceDomainId,
              serviceId,
              targetPort: Number(targetPort),
            },
          },
        }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Subdomain port update failed' });
    }
  });

  // 4. Custom Domain Create Proxy
  app.post('/api/railway/domain/create-custom', async (req, res) => {
    try {
      const { token, projectId, environmentId, serviceId, domain, targetPort = 3000 } = req.body;
      if (!token || !domain || !serviceId) {
        return res.status(400).json({ error: 'token, domain and serviceId are required' });
      }

      // customDomainCreate DOES take projectId + a real environment UUID.
      const targets = await resolveRailwayTargetIds(token, projectId, undefined, true);
      const realProjId = projectId || targets.projectId;
      let realEnvId = environmentId && /^[0-9a-f-]{36}$/i.test(environmentId) ? environmentId : targets.environmentId || '';
      if (!realProjId || !realEnvId) {
        return res.status(400).json({ error: 'Could not resolve Railway projectId/environmentId' });
      }

      const query = `
        mutation CreateCustomDomain($input: CustomDomainCreateInput!) {
          customDomainCreate(input: $input) {
            id
            domain
            status {
              dnsRecords {
                type
                name
                value
              }
            }
          }
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: {
            input: {
              projectId: realProjId,
              environmentId: realEnvId,
              serviceId,
              domain,
              targetPort: Number(targetPort),
            },
          },
        }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Custom domain creation failed' });
    }
  });

  // 4b. Issue TLS certificate for a custom domain after DNS CNAME is set.
  // Output is Boolean! — no selection set.
  app.post('/api/railway/domain/issue-custom-cert', async (req, res) => {
    try {
      const { token, customDomainId } = req.body;
      if (!token || !customDomainId) {
        return res.status(400).json({ error: 'token and customDomainId are required' });
      }

      const query = `
        mutation IssueCustomDomainCertificate($input: CustomDomainIssueCertificateInput!) {
          customDomainIssueCertificate(input: $input)
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: { input: { customDomainId } },
        }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Certificate issuance failed' });
    }
  });

  // List real domains for a service (service + custom) with Railway ids.
  app.post('/api/railway/domains', async (req, res) => {
    try {
      const { token, projectId, serviceId, environmentId } = req.body;
      if (!token || !projectId || !serviceId) {
        return res.status(400).json({ error: 'token, projectId and serviceId are required' });
      }
      let envId = environmentId && /^[0-9a-f-]{36}$/i.test(environmentId) ? environmentId : '';
      if (!envId) {
        const targets = await resolveRailwayTargetIds(token, projectId, undefined, true);
        envId = targets.environmentId || '';
      }
      if (!envId) {
        return res.status(400).json({ error: 'Could not resolve Railway environmentId' });
      }
      const domains = await fetchServiceDomains(token, projectId, serviceId, envId);
      return res.json({ domains, environmentId: envId });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to list domains' });
    }
  });

  // Delete a domain: serviceDomainDelete (id) for *.up.railway.app,
  // customDomainDelete (id) for custom domains. Both return Boolean!.
  app.post('/api/railway/domain/delete', async (req, res) => {
    try {
      const { token, id, kind } = req.body;
      if (!token || !id) return res.status(400).json({ error: 'token and id are required' });

      const isCustom = kind === 'custom';
      const query = isCustom
        ? `mutation DeleteCustomDomain($id: String!) { customDomainDelete(id: $id) }`
        : `mutation DeleteServiceDomain($id: String!) { serviceDomainDelete(id: $id) }`;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query, variables: { id } }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Domain deletion failed' });
    }
  });

  // Deployment status list — used to poll a githubRepoDeploy until
  // SUCCESS / FAILED. Query shape: deployments(first, input: { projectId }).
  app.post('/api/railway/deployments', async (req, res) => {
    try {
      const { token, projectId } = req.body;
      if (!token || !projectId) return res.status(400).json({ error: 'token and projectId are required' });

      const query = `
        query GetDeployments($projectId: String!) {
          deployments(first: 5, input: { projectId: $projectId }) {
            edges {
              node {
                id
                status
                createdAt
              }
            }
          }
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query, variables: { projectId } }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to list deployments' });
    }
  });

  // Build/run logs for a failed deployment. NOTE: deploymentLogs returns a
  // direct array (no `edges` wrapper) — querying edges errors with
  // "Cannot query field edges on type Log".
  app.post('/api/railway/deployment-logs', async (req, res) => {
    try {
      const { token, deploymentId, limit = 50 } = req.body;
      if (!token || !deploymentId) {
        return res.status(400).json({ error: 'token and deploymentId are required' });
      }

      const query = `
        query GetDeploymentLogs($deploymentId: String!, $limit: Int) {
          deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
            timestamp
            message
            severity
          }
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ query, variables: { deploymentId, limit: Number(limit) || 50 } }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to fetch deployment logs' });
    }
  });

  // Real per-service telemetry from Railway's `metrics` query (the same data
  // behind Railway's dashboard charts): CPU/memory/network usage over time.
  const ALLOWED_METRIC_MEASUREMENTS = new Set([
    'CPU_USAGE',
    'CPU_LIMIT',
    'MEMORY_USAGE_GB',
    'MEMORY_LIMIT_GB',
    'NETWORK_RX_GB',
    'NETWORK_TX_GB',
    'DISK_USAGE_GB',
  ]);

  app.post('/api/railway/metrics', async (req, res) => {
    try {
      const { token, measurements, startDate, endDate, serviceId, projectId, environmentId, sampleRateSeconds } =
        req.body;
      if (!token || !Array.isArray(measurements) || measurements.length === 0 || !startDate) {
        return res.status(400).json({ error: 'token, measurements[] and startDate are required' });
      }
      const clean = measurements.filter((m: any) => typeof m === 'string' && ALLOWED_METRIC_MEASUREMENTS.has(m));
      if (clean.length === 0) {
        return res.status(400).json({ error: 'No valid measurements requested' });
      }

      const query = `
        query GetServiceMetrics(
          $measurements: [MetricMeasurement!]!,
          $startDate: DateTime!,
          $endDate: DateTime,
          $serviceId: String,
          $projectId: String,
          $environmentId: String,
          $sampleRateSeconds: Int
        ) {
          metrics(
            measurements: $measurements,
            startDate: $startDate,
            endDate: $endDate,
            serviceId: $serviceId,
            projectId: $projectId,
            environmentId: $environmentId,
            sampleRateSeconds: $sampleRateSeconds
          ) {
            measurement
            values {
              ts
              value
            }
          }
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: {
            measurements: clean,
            startDate,
            endDate: endDate || undefined,
            serviceId: serviceId || undefined,
            projectId: projectId || undefined,
            environmentId: environmentId || undefined,
            sampleRateSeconds: sampleRateSeconds || undefined,
          },
        }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to fetch metrics' });
    }
  });

  // 5. Service Instance Build/Run Update Proxy
  app.post('/api/railway/service/instance-update', async (req, res) => {
    try {
      const { token, serviceId, environmentId = 'production', buildCommand, startCommand, builder, rootDirectory, healthcheckPath, region } = req.body;
      if (!token || !serviceId) return res.status(400).json({ error: 'token and serviceId are required' });

      const query = `
        mutation UpdateInstance($serviceId: String!, $environmentId: String, $input: ServiceInstanceUpdateInput!) {
          serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
        }
      `;

      const input: any = {};
      if (buildCommand) input.buildCommand = buildCommand;
      if (startCommand) input.startCommand = startCommand;
      if (builder) input.builder = builder;
      if (rootDirectory) input.rootDirectory = rootDirectory;
      if (healthcheckPath) input.healthcheckPath = healthcheckPath;
      if (region) input.region = region;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: {
            serviceId,
            environmentId,
            input,
          },
        }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Service instance update failed' });
    }
  });

  // 6. Volume Create Proxy
  app.post('/api/railway/volume/create', async (req, res) => {
    try {
      const { token, projectId, environmentId, serviceId, mountPath = '/data', region = 'us-west1' } = req.body;
      if (!token || !projectId || !serviceId) return res.status(400).json({ error: 'token, projectId, serviceId required' });

      const query = `
        mutation CreateVolume($input: VolumeCreateInput!) {
          volumeCreate(input: $input) {
            id
            name
          }
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: {
            input: {
              projectId,
              environmentId: environmentId || 'production',
              serviceId,
              mountPath,
              region,
            },
          },
        }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Volume creation failed' });
    }
  });

  // 7. Environment Create Proxy (e.g. Staging)
  app.post('/api/railway/environment/create', async (req, res) => {
    try {
      const { token, projectId, name = 'staging', sourceEnvironmentId } = req.body;
      if (!token || !projectId) return res.status(400).json({ error: 'token and projectId required' });

      const query = `
        mutation CreateEnv($input: EnvironmentCreateInput!) {
          environmentCreate(input: $input) {
            id
            name
          }
        }
      `;

      const response = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          query,
          variables: {
            input: {
              projectId,
              name,
              sourceEnvironmentId,
            },
          },
        }),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Environment creation failed' });
    }
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Railway Hub server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Error starting server:', err);
  process.exit(1);
});
