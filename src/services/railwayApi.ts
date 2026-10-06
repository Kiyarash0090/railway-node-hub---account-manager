/**
 * Railway API integration helper
 * Connects to the server-side proxy which interfaces with Railway's GraphQL API
 */
import { apiFetch as fetch } from './authApi';

export interface ValidateTokenResponse {
  valid: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    username?: string;
    avatar?: string;
    projects?: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          description?: string;
          updatedAt: string;
          services?: {
            edges: Array<{
              node: {
                id: string;
                name: string;
              };
            }>;
          };
        };
      }>;
    };
  };
  extractedInfo?: {
    workspaceId?: string;
    plan: 'Pro' | 'Hobby' | 'Free' | 'Trial';
    basePlan?: string;
    isTrialing?: boolean;
    trialDaysRemaining?: number | null;
    creditExpiresInDays?: number | null;
    billingPeriodEnd?: string | null;
    preferredRegion?: string | null;
    projectLimit?: number | null;
    serviceLimitPerProject?: number | null;
    creditLimit: number;
    creditUsed: number;
    creditRemaining: number;
    projectsCount: number;
    servicesCount: number;
    projects?: any[];
  };
  error?: string;
}

export async function validateRailwayToken(token: string): Promise<ValidateTokenResponse> {
  try {
    const res = await fetch('/api/railway/validate-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.trim() }),
    });
    return await res.json();
  } catch (err: any) {
    return {
      valid: false,
      error: err.message || 'Network error communicating with Railway validation service',
    };
  }
}

export async function syncRailwayProjects(token: string): Promise<{
  projects?: any[];
  count?: number;
  error?: string;
  projectLimit?: number | null;
  serviceLimitPerProject?: number | null;
  isTrialing?: boolean;
  trialDaysRemaining?: number | null;
  creditExpiresInDays?: number | null;
  billingPeriodEnd?: string | null;
  preferredRegion?: string | null;
  creditLimit?: number | null;
  creditUsed?: number | null;
  creditRemaining?: number | null;
  plan?: string | null;
  httpStatus?: number;
}> {
  try {
    const res = await fetch('/api/railway/sync-projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.trim() }),
    });
    const data = await res.json();
    data.httpStatus = res.status;
    return data;
  } catch (err: any) {
    return { error: err.message || 'Failed to sync projects from Railway' };
  }
}

export async function executeRailwayGraphQL(token: string, query: string, variables = {}) {
  try {
    const res = await fetch('/api/railway/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.trim(), query, variables }),
    });
    return await res.json();
  } catch (err: any) {
    return {
      errors: [{ message: err.message || 'GraphQL execution failed' }],
    };
  }
}

export async function createRailwayProject(token: string, name: string, description?: string) {
  try {
    const res = await fetch('/api/railway/project/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, name, description }),
    });
    const data = await res.json();
    // Preserve the HTTP status and our own limit-reached error code so callers can react
    data.httpStatus = res.status;
    return data;
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Project creation failed' }] };
  }
}

export async function deleteRailwayProject(token: string, projectId: string) {
  try {
    const res = await fetch('/api/railway/project/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, projectId }),
    });
    const data = await res.json();
    // GraphQL errors come back as { errors: [...] }; server/network failures
    // come back as { error: "..." } — normalize both so callers can rely on
    // a single check and never mistake a failed delete for success.
    if (Array.isArray(data?.errors) && data.errors.length > 0) return data;
    if (!res.ok || data?.error) {
      return { errors: [{ message: data?.error || `Railway delete request failed (HTTP ${res.status})` }] };
    }
    return data;
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Project deletion failed' }] };
  }
}

export async function deployGitHubRepoRailway(params: {
  token: string;
  projectId: string;
  repo: string;
  branch?: string;
  environmentId?: string;
}) {
  try {
    const res = await fetch('/api/railway/deploy/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'GitHub repo deploy failed' }] };
  }
}

/** Checks Railway's access to a GitHub repo and returns its real default branch. */
export async function getGitHubRepoInfo(params: { token: string; repo: string }) {
  try {
    const res = await fetch('/api/railway/github/repo-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'GitHub repo check failed' }] };
  }
}

export async function deployDockerComposeRailway(params: {
  token: string;
  projectId: string;
  environmentId?: string;
  yaml: string;
}) {
  try {
    const res = await fetch('/api/railway/deploy/docker-compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Docker compose import failed' }] };
  }
}

export async function createServiceRailway(params: {
  token: string;
  projectId: string;
  name: string;
  icon?: string;
  image?: string;
  variables?: Record<string, string>;
}) {
  try {
    const res = await fetch('/api/railway/deploy/service-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Service creation failed' }] };
  }
}

/** Restarts the latest deployment of a service (deploymentRestart). */
export async function restartRailwayService(params: {
  token: string;
  projectId: string;
  serviceId: string;
  environmentId?: string;
}) {
  try {
    const res = await fetch('/api/railway/service/restart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    data.httpStatus = res.status;
    return data;
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Service restart failed' }] };
  }
}

/** Queues a new deployment from the same source (deploymentRedeploy). */
export async function redeployRailwayService(params: {
  token: string;
  projectId: string;
  serviceId: string;
  environmentId?: string;
}) {
  try {
    const res = await fetch('/api/railway/service/redeploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    data.httpStatus = res.status;
    return data;
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Service redeploy failed' }] };
  }
}

/** Stops the latest deployment of a service (deploymentStop). */
export async function stopRailwayService(params: {
  token: string;
  projectId: string;
  serviceId: string;
  environmentId?: string;
}) {
  try {
    const res = await fetch('/api/railway/service/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    data.httpStatus = res.status;
    return data;
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Service stop failed' }] };
  }
}

/** Deletes a service on Railway for real (serviceDelete). */
export async function deleteRailwayService(params: {
  token: string;
  serviceId: string;
  environmentId?: string;
}) {
  try {
    const res = await fetch('/api/railway/service/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    data.httpStatus = res.status;
    return data;
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Service deletion failed' }] };
  }
}

export async function upsertRailwayVariable(params: {
  token: string;
  projectId: string;
  environmentId?: string;
  serviceId?: string;
  name: string;
  value: string;
  skipDeploys?: boolean;
}) {
  try {
    const res = await fetch('/api/railway/variables/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Variable upsert failed' }] };
  }
}

export async function deleteRailwayVariable(params: {
  token: string;
  projectId: string;
  environmentId?: string;
  name: string;
}) {
  try {
    const res = await fetch('/api/railway/variables/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Variable delete failed' }] };
  }
}

export async function createRailwaySubdomain(params: {
  token: string;
  projectId: string;
  environmentId?: string;
  serviceId: string;
  targetPort?: number;
}) {
  try {
    const res = await fetch('/api/railway/domain/create-subdomain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Subdomain creation failed' }] };
  }
}

export async function createRailwayCustomDomain(params: {
  token: string;
  projectId: string;
  environmentId?: string;
  serviceId: string;
  domain: string;
  targetPort?: number;
}) {
  try {
    const res = await fetch('/api/railway/domain/create-custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Custom domain creation failed' }] };
  }
}

/** Sets the ACCOUNT-level default region (workspace.preferredRegion).
 *  Applies to new services/volumes — not existing ones. */
export async function setRailwayRegion(params: {
  token: string;
  region: string;
  workspaceId?: string;
}) {
  try {
    const res = await fetch('/api/railway/workspace/region', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Failed to update account region' }] };
  }
}

/** Lists real domains (service + custom) for a Railway service. */
export async function getRailwayServiceDomains(params: {
  token: string;
  projectId: string;
  serviceId: string;
  environmentId?: string;
}) {
  try {
    const res = await fetch('/api/railway/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Failed to list domains' }] };
  }
}

/** Deletes a domain on Railway: kind 'service' → serviceDomainDelete, 'custom' → customDomainDelete. */
export async function deleteRailwayDomain(params: {
  token: string;
  id: string;
  kind: 'service' | 'custom';
}) {
  try {
    const res = await fetch('/api/railway/domain/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Domain deletion failed' }] };
  }
}

/** Real service telemetry (CPU/memory/network) from Railway's metrics query. */
export async function getRailwayServiceMetrics(params: {
  token: string;
  measurements: string[];
  startDate: string;
  endDate?: string;
  serviceId?: string;
  projectId?: string;
  environmentId?: string;
  sampleRateSeconds?: number;
}) {
  try {
    const res = await fetch('/api/railway/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Failed to fetch metrics' }] };
  }
}

/** Lists recent deployments for a project — used to poll githubRepoDeploy. */
export async function getRailwayDeployments(params: { token: string; projectId: string }) {
  try {
    const res = await fetch('/api/railway/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Failed to list deployments' }] };
  }
}

/** Build/run logs for a deployment (direct array — no edges). */
export async function getRailwayDeploymentLogs(params: {
  token: string;
  deploymentId: string;
  limit?: number;
}) {
  try {
    const res = await fetch('/api/railway/deployment-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Failed to fetch deployment logs' }] };
  }
}

/** Fixes targetPort on an existing *.up.railway.app domain (serviceDomainUpdate). */
export async function updateRailwaySubdomainPort(params: {
  token: string;
  projectId?: string;
  environmentId?: string;
  serviceId: string;
  serviceDomainId: string;
  domain: string;
  targetPort: number;
}) {
  try {
    const res = await fetch('/api/railway/domain/update-subdomain-port', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Subdomain port update failed' }] };
  }
}

/** Issues the TLS certificate for a custom domain after DNS is pointed at Railway. */
export async function issueRailwayCustomDomainCert(params: {
  token: string;
  customDomainId: string;
}) {
  try {
    const res = await fetch('/api/railway/domain/issue-custom-cert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Certificate issuance failed' }] };
  }
}

export async function updateRailwayServiceInstance(params: {
  token: string;
  serviceId: string;
  environmentId?: string;
  buildCommand?: string;
  startCommand?: string;
  builder?: string;
  rootDirectory?: string;
  healthcheckPath?: string;
  region?: string;
}) {
  try {
    const res = await fetch('/api/railway/service/instance-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Service instance update failed' }] };
  }
}

export async function createRailwayVolume(params: {
  token: string;
  projectId: string;
  environmentId?: string;
  serviceId: string;
  mountPath?: string;
  region?: string;
}) {
  try {
    const res = await fetch('/api/railway/volume/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Volume creation failed' }] };
  }
}

export async function createRailwayEnvironment(params: {
  token: string;
  projectId: string;
  name: string;
  sourceEnvironmentId?: string;
}) {
  try {
    const res = await fetch('/api/railway/environment/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { errors: [{ message: err.message || 'Environment creation failed' }] };
  }
}
