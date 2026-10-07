import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Express, NextFunction, Request, Response } from 'express';

const SESSION_COOKIE = 'hub_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Credentials {
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

interface Session {
  username: string;
  expiresAt: number;
}

interface TokenPayload {
  u: string;
  exp: number;
  rnd: string;
}

const sessions = new Map<string, Session>();
const revokedTokens = new Set<string>();

export function authFilePath(): string {
  return process.env.AUTH_FILE_PATH || path.resolve(process.cwd(), 'data', 'auth.json');
}

function readCredentials(): Credentials | null {
  try {
    const raw = fs.readFileSync(authFilePath(), 'utf8');
    const data = JSON.parse(raw);
    if (data?.username && data?.passwordHash && data?.salt) return data as Credentials;
    return null;
  } catch {
    return null;
  }
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password: string, cred: Credentials): boolean {
  const hash = hashPassword(password, cred.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(cred.passwordHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function getSecretKey(): string {
  const cred = readCredentials();
  if (cred) {
    return `${cred.username}:${cred.passwordHash}:${cred.salt}`;
  }
  return 'railway-hub-default-fallback-session-secret-key-salt';
}

function createSignedToken(username: string): string {
  const payload: TokenPayload = {
    u: username,
    exp: Date.now() + SESSION_TTL_MS,
    rnd: randomBytes(16).toString('hex'),
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', getSecretKey()).update(payloadStr).digest('base64url');
  return `${payloadStr}.${signature}`;
}

export function revokeToken(token: string): void {
  revokedTokens.add(token);
  if (revokedTokens.size > 2000) {
    revokedTokens.clear();
  }
}

export function verifySessionToken(token: string): string | null {
  if (!token || typeof token !== 'string') return null;
  if (revokedTokens.has(token)) return null;

  // 1. Try HMAC signed token
  const dotIndex = token.indexOf('.');
  if (dotIndex > 0) {
    const payloadB64 = token.slice(0, dotIndex);
    const signature = token.slice(dotIndex + 1);
    try {
      const expectedSignature = createHmac('sha256', getSecretKey()).update(payloadB64).digest('base64url');
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expectedSignature);
      if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
        const payload: TokenPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        if (payload && payload.u && typeof payload.exp === 'number') {
          if (payload.exp > Date.now()) {
            return payload.u;
          }
        }
      }
    } catch {
      // invalid payload JSON or format
    }
  }

  // 2. Fallback to in-memory sessions map
  const session = sessions.get(token);
  if (session) {
    if (session.expiresAt > Date.now()) {
      return session.username;
    } else {
      sessions.delete(token);
    }
  }

  return null;
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function extractAuthToken(req: Request): string | null {
  // Authorization header: "Bearer <token>"
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === 'string') {
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
      return parts[1].trim();
    }
  }

  // Custom headers
  const xHub = req.headers['x-hub-token'];
  if (typeof xHub === 'string' && xHub.trim()) {
    return xHub.trim();
  }
  const xSession = req.headers['x-session-token'];
  if (typeof xSession === 'string' && xSession.trim()) {
    return xSession.trim();
  }

  // Cookie fallback
  const cookieToken = parseCookies(req)[SESSION_COOKIE];
  if (cookieToken && cookieToken.trim()) {
    return cookieToken.trim();
  }

  return null;
}

export function getSessionUser(req: Request): string | null {
  const token = extractAuthToken(req);
  if (!token) return null;
  return verifySessionToken(token);
}

function sessionCookie(token: string, maxAgeSec: number, req?: Request): string {
  const isHttps = req ? (req.secure || req.headers['x-forwarded-proto'] === 'https') : true;
  if (isHttps) {
    return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=None; Secure; Partitioned; Path=/; Max-Age=${maxAgeSec}`;
  }
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
}

function startSession(res: Response, username: string, req?: Request): string {
  const token = createSignedToken(username);
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
  res.setHeader('Set-Cookie', sessionCookie(token, Math.floor(SESSION_TTL_MS / 1000), req));
  return token;
}

function clearSession(req: Request, res: Response): void {
  const token = extractAuthToken(req);
  if (token) {
    sessions.delete(token);
    revokeToken(token);
  }
  const isHttps = req ? (req.secure || req.headers['x-forwarded-proto'] === 'https') : true;
  const secureAttrs = isHttps ? '; SameSite=None; Secure; Partitioned' : '; SameSite=Lax';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly${secureAttrs}; Path=/; Max-Age=0`);
}

export function mountAuthRoutes(app: Express): void {
  app.get('/api/auth/status', (req, res) => {
    const cred = readCredentials();
    const setupRequired = cred === null;
    const user = getSessionUser(req);
    const authenticated = user !== null;
    res.json({
      setupRequired,
      authenticated,
      username: user || undefined,
    });
  });

  app.post('/api/auth/setup', (req, res) => {
    if (readCredentials()) {
      return res.status(409).json({ error: 'Setup already completed' });
    }

    const { username, password } = req.body || {};
    if (typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const salt = randomBytes(16).toString('hex');
    const cred: Credentials = {
      username: username.trim(),
      passwordHash: hashPassword(password, salt),
      salt,
      createdAt: new Date().toISOString(),
    };

    const file = authFilePath();
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // wx: fail if file already exists (race protection between check and write)
      fs.writeFileSync(file, JSON.stringify(cred, null, 2), { mode: 0o600, flag: 'wx' });
    } catch (err: any) {
      if (err?.code === 'EEXIST') {
        return res.status(409).json({ error: 'Setup already completed' });
      }
      return res.status(500).json({ error: err.message || 'Failed to save credentials' });
    }

    const token = startSession(res, cred.username, req);
    res.json({ success: true, username: cred.username, token });
  });

  app.post('/api/auth/login', (req, res) => {
    const cred = readCredentials();
    if (!cred) {
      return res.status(400).json({ error: 'Setup required' });
    }

    const { username, password } = req.body || {};
    const usernameOk = typeof username === 'string' && username.trim() === cred.username;
    const passwordOk = typeof password === 'string' && verifyPassword(password, cred);
    if (!usernameOk || !passwordOk) {
      return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
    }

    const token = startSession(res, cred.username, req);
    res.json({ success: true, username: cred.username, token });
  });

  // Authenticated Change Password Endpoint
  app.post('/api/auth/change-password', (req, res) => {
    const user = getSessionUser(req);
    if (!user) {
      return res.status(401).json({ error: 'برای تغییر رمز عبور ابتدا باید وارد حساب کاربری شوید' });
    }

    const cred = readCredentials();
    if (!cred) {
      return res.status(400).json({ error: 'حسابی تعریف نشده است' });
    }

    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, cred)) {
      return res.status(400).json({ error: 'رمز عبور فعلی اشتباه است' });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: 'رمز عبور جدید باید حداقل ۶ کاراکتر باشد' });
    }

    const salt = randomBytes(16).toString('hex');
    const updatedCred: Credentials = {
      username: cred.username,
      passwordHash: hashPassword(newPassword, salt),
      salt,
      createdAt: cred.createdAt,
    };

    const file = authFilePath();
    try {
      fs.writeFileSync(file, JSON.stringify(updatedCred, null, 2), { mode: 0o600 });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'ذخیره رمز عبور جدید با خطا مواجه شد' });
    }

    // Revoke old session token and issue a fresh signed token
    const oldToken = extractAuthToken(req);
    if (oldToken) revokeToken(oldToken);

    const token = startSession(res, updatedCred.username, req);
    res.json({ success: true, message: 'رمز عبور با موفقیت بروزرسانی شد', token });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSession(req, res);
    res.json({ success: true });
  });
}

export function authGuard(req: Request, res: Response, next: NextFunction): void {
  const fullPath = req.originalUrl?.split('?')[0] || req.path;
  if (
    fullPath === '/health' ||
    fullPath === '/api/health' ||
    fullPath.startsWith('/auth/') ||
    fullPath.startsWith('/api/auth/')
  ) {
    next();
    return;
  }
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  (req as any).user = user;
  next();
}
