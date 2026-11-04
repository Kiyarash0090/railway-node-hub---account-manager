/** Per-chat session state for the Telegram bot.
 *
 *  Keeps:
 *  - callback_data ref table (short id → real Railway id + params)
 *  - awaiting-text state machine (token, repo, var name/value, ...)
 *  - last screen for /cancel and back navigation
 *
 *  All in-memory; restarts reset conversations but not persisted config. */

export interface CallbackRef {
  kind: string;
  id?: string;
  accountId?: string;
  projectId?: string;
  serviceId?: string;
  environmentId?: string;
  deploymentId?: string;
  volumeId?: string;
  domainId?: string;
  domainKind?: 'service' | 'custom';
  page?: number;
  extra?: Record<string, string>;
}

export interface AwaitingInput {
  kind:
    | 'account-token'
    | 'project-name'
    | 'env-name'
    | 'service-name'
    | 'github-repo'
    | 'github-branch'
    | 'image-name'
    | 'compose-file'
    | 'source-tar'
    | 'var-name'
    | 'var-value'
    | 'domain-custom'
    | 'domain-port'
    | 'volume-mount'
    | 'setting-build'
    | 'setting-start'
    | 'setting-root'
    | 'setting-health'
    | 'setting-builder'
    | 'setting-admin-add'
    | 'setting-monitor-interval'
    | 'setting-credit-threshold'
    | 'backup-json';
  payload?: Record<string, string>;
  messageId?: number;
}

/** Which project / service the chat is currently looking at — lets paged
 *  screens (project services, service detail) stay scoped without encoding
 *  long ids into callback_data. */
export interface ViewContext {
  projectId?: string;
  serviceRef?: { accountId: string; projectId: string; serviceId: string; environmentId?: string };
}

export interface ChatSession {
  refs: Map<string, CallbackRef>;
  refSeq: number;
  awaiting: AwaitingInput | null;
  lastScreen?: string;
  confirmPending?: {
    action: string;
    params: Record<string, string>;
    expiresAt: number;
    messageId?: number;
  };
  selectedAccountId?: string;
  view?: ViewContext;
}

const sessions = new Map<number, ChatSession>();
const MAX_REFS = 500;

export function getSession(chatId: number): ChatSession {
  let s = sessions.get(chatId);
  if (!s) {
    s = { refs: new Map(), refSeq: 0, awaiting: null };
    sessions.set(chatId, s);
  }
  return s;
}

export function setSelectedAccount(chatId: number, accountId: string | null): void {
  const s = getSession(chatId);
  s.selectedAccountId = accountId || undefined;
  // Switching account invalidates any project/service the chat was looking at.
  s.view = undefined;
}

export function getSelectedAccount(chatId: number): string | undefined {
  return sessions.get(chatId)?.selectedAccountId;
}

export function clearSelectedAccount(chatId: number): void {
  const s = getSession(chatId);
  if (s) {
    s.selectedAccountId = undefined;
    s.view = undefined;
  }
}

export function setViewProject(chatId: number, projectId: string | null): void {
  const s = getSession(chatId);
  s.view = projectId ? { projectId } : undefined;
}

export function setViewService(
  chatId: number,
  ref: ViewContext['serviceRef'] | null
): void {
  const s = getSession(chatId);
  if (!ref) {
    s.view = s.view?.projectId ? { projectId: s.view.projectId } : undefined;
    return;
  }
  s.view = { projectId: ref.projectId, serviceRef: ref };
}

export function getViewProject(chatId: number): string | undefined {
  return sessions.get(chatId)?.view?.projectId;
}

export function getViewService(chatId: number): ViewContext['serviceRef'] | undefined {
  return sessions.get(chatId)?.view?.serviceRef;
}

export function registerRef(chatId: number, ref: CallbackRef): string {
  const s = getSession(chatId);
  if (s.refs.size >= MAX_REFS) {
    const first = s.refs.keys().next().value;
    if (first !== undefined) s.refs.delete(first);
  }
  const key = `${ref.kind[0]}:${++s.refSeq}`;
  s.refs.set(key, ref);
  return key;
}

export function resolveRef(chatId: number, key: string): CallbackRef | null {
  const s = sessions.get(chatId);
  return s?.refs.get(key) || null;
}

export function setAwaiting(chatId: number, awaiting: AwaitingInput | null): void {
  const s = getSession(chatId);
  s.awaiting = awaiting;
}

export function getAwaiting(chatId: number): AwaitingInput | null {
  return sessions.get(chatId)?.awaiting || null;
}

export function setConfirmPending(
  chatId: number,
  pending: ChatSession['confirmPending'] | null
): void {
  const s = getSession(chatId);
  s.confirmPending = pending || undefined;
}

export function getConfirmPending(chatId: number): ChatSession['confirmPending'] | null {
  const p = sessions.get(chatId)?.confirmPending;
  if (!p) return null;
  if (Date.now() > p.expiresAt) {
    sessions.get(chatId)!.confirmPending = undefined;
    return null;
  }
  return p;
}

export function setLastScreen(chatId: number, screen: string): void {
  getSession(chatId).lastScreen = screen;
}

export function getLastScreen(chatId: number): string | undefined {
  return sessions.get(chatId)?.lastScreen;
}