export type AccountStatus = 'active' | 'rate_limited' | 'error' | 'suspended';
export type ServiceStatus = 'healthy' | 'deploying' | 'crashed' | 'stopped' | 'sleeping';
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  serviceId?: string;
  serviceName: string;
}

export interface MetricDataPoint {
  time: string;
  cpu: number; // in % (0 - 100)
  memory: number; // in MB
  networkIn: number; // in KB/s
  networkOut: number; // in KB/s
  requests: number; // req/sec
}

/** A domain attached to a Railway service — carries the Railway id so the
 *  UI can delete it (serviceDomainDelete / customDomainDelete). */
export interface RailwayServiceDomain {
  id: string;
  domain: string;
  targetPort?: number | null;
  kind: 'service' | 'custom';
  environmentId?: string;
}

/** Display label for a domain entry (handles legacy plain-string entries). */
export function domainLabel(d: RailwayServiceDomain | string): string {
  return typeof d === 'string' ? d : d.domain;
}

export interface RailwayService {
  id: string;
  projectId: string;
  accountId: string;
  name: string;
  icon: string;
  templateType: 'nodejs' | 'python' | 'telegram-bot' | 'nextjs' | 'postgres' | 'redis' | 'docker' | 'custom';
  imageOrRepo: string;
  status: ServiceStatus;
  cpuUsage: number; // percentage e.g. 14.5
  memoryUsage: number; // MB e.g. 180
  memoryLimit: number; // MB e.g. 512
  networkIn: number; // MB total
  networkOut: number; // MB total
  uptime: string;
  restartsCount: number;
  region: string;
  port: number;
  healthEndpoint: string;
  domains: RailwayServiceDomain[];
  envVars: Record<string, string>;
  /** Latest Railway deployment — source of the real status shown on cards and
   *  the target of restart/redeploy/stop. Filled by project sync. */
  latestDeploymentId?: string;
  deploymentStatus?: string;
  deploymentStatusAt?: string;
  deploymentStopped?: boolean;
  createdAt: string;
  updatedAt: string;
  historyMetrics: MetricDataPoint[];
}

export interface RailwayProject {
  id: string;
  accountId: string;
  name: string;
  description?: string;
  environment: 'production' | 'staging' | 'development';
  defaultEnvironmentId?: string;
  isExternal?: boolean;
  isDeletedOnRailway?: boolean;
  services: RailwayService[];
  createdAt: string;
  updatedAt: string;
}

export interface RailwayAccount {
  id: string;
  name: string;
  email: string;
  token: string; // Bearer token
  workspaceId?: string;
  color: string; // Hex or tailwind color
  plan: 'Free' | 'Hobby' | 'Pro' | 'Trial' | 'Enterprise';
  currency: string; // '$'
  creditLimit: number; // e.g. 5.00
  creditUsed: number; // e.g. 3.42
  creditRemaining: number; // e.g. 1.58
  hourlyBurnRate: number; // e.g. 0.008
  status: AccountStatus;
  lastChecked: string;
  // Budget Guard / Auto-Shutdown Settings
  autoShutdownEnabled: boolean;
  autoShutdownThreshold: number; // e.g. $0.50 (if remaining < this, shutdown)
  isShutdownTriggered: boolean;
  shutdownTriggeredAt?: string;
  projects: RailwayProject[];
  isRealVerified?: boolean;
  // Plan limits reported live by Railway (Free = 1 project, Trial/Hobby = more)
  projectLimit?: number | null;
  serviceLimitPerProject?: number | null;
  isTrialing?: boolean;
  trialDaysRemaining?: number | null;
  /** Days until the usage-credit window ends (trial end, else billingPeriod.end). */
  creditExpiresInDays?: number | null;
  /** ISO date when the current Railway billing/credit period ends. */
  billingPeriodEnd?: string | null;
  /** Account-level default region (workspace.preferredRegion) for NEW deploys. */
  preferredRegion?: string | null;
  /** User-defined labels on the account (filter/search in AccountsManager). */
  tags?: string[];
}

/** Valid Railway workspace region codes → display labels. */
export const RAILWAY_REGIONS: { code: string; label: string }[] = [
  { code: 'iad', label: 'US East (Virginia)' },
  { code: 'pdx', label: 'US West (Oregon)' },
  { code: 'sfo', label: 'US West (California)' },
  { code: 'ams', label: 'EU West (Amsterdam)' },
  { code: 'sin', label: 'Asia (Singapore)' },
];

export function regionLabel(code?: string | null): string {
  if (!code) return 'نامشخص';
  return RAILWAY_REGIONS.find((r) => r.code === code)?.label || code;
}

/** Human label for credit expiry, or null when unknown. */
export function creditExpiryLabel(days?: number | null): string | null {
  if (typeof days !== 'number' || Number.isNaN(days) || days < 0) return null;
  if (days === 0) return 'امروز منقضی می‌شود';
  if (days === 1) return '۱ روز تا انقضا';
  return `${days} روز تا انقضا`;
}

/** Short date label (e.g. "۴ نوامبر") for billing-period reset, or null. */
export function creditResetLabel(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'long' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Telegram bot connection + last-backup metadata, stored under the top-level
 *  `telegram` key of the hub state file. */
export interface TelegramConfig {
  botToken: string;
  chatId: string;
  lastBackupAt?: string | null;
  lastBackupFileId?: string | null;
  lastBackupFileName?: string | null;
  lastBackupMessageId?: number | null;
}

export interface AlertNotification {
  id: string;
  timestamp: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  accountId: string;
  accountName: string;
  serviceName?: string;
}
