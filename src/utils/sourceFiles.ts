/**
 * Turns what the user picked in the browser (a folder or a .zip) into the flat
 * entry list `buildSourceTarball` packages for Railway's /up endpoint.
 *
 * A folder comes in as `File` objects carrying `webkitRelativePath`; a .zip is
 * parsed here because there is no filesystem to shell out to. Only stored and
 * deflated entries are supported — anything else is reported, not guessed at.
 */
import type { SourceEntry } from './sourceBundle';
import { readZipEntries } from './zipArchive';

export type { SourceEntry };

/** The server forwards raw bytes with a 250MB cap, so anything near it must be
 *  refused early rather than read into memory and then rejected. */
export const MAX_SOURCE_BYTES = 200 * 1024 * 1024;

/** Files whose contents normally hold local secrets, surfaced as a warning. */
const SENSITIVE_NAMES = /^(\.env(\..+)?|\.npmrc|\.netrc|id_(rsa|ed25519)|.*\.pem|.*\.p12)$/i;

/**
 * Variables Railway injects into every service itself ("added by Railway" in
 * the dashboard). They are read-only for us: writing them back either fails or
 * duplicates what Railway already manages, so they are never shown, counted or
 * sent.
 */
export function isRailwayManagedVariable(key: string): boolean {
  return /^RAILWAY_/i.test(key.trim());
}

/** Drops Railway's own variables from a variable map. */
export function withoutRailwayVariables(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (!isRailwayManagedVariable(key)) out[key] = value;
  }
  return out;
}

export function isSensitiveFile(path: string): boolean {
  return SENSITIVE_NAMES.test(path.split('/').pop() || '');
}

/** Path components the bundler always drops — never worth reading into memory. */
const NEVER_UPLOADED = new Set(['.git', 'node_modules']);

/** Reads a folder picked with `<input webkitdirectory>`. */
export async function readDirectoryFiles(files: FileList | File[]): Promise<SourceEntry[]> {
  const list = Array.from(files);
  const entries: SourceEntry[] = [];
  let total = 0;

  for (const file of list) {
    const relPath = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (file.name === '.DS_Store') continue;
    // Skipped here, not just in the bundler: a project with dependencies
    // installed is mostly node_modules, and reading it would blow the limit
    // (and the tab's memory) for files that would be dropped anyway.
    if (relPath.split('/').some((part) => NEVER_UPLOADED.has(part))) continue;
    total += file.size;
    if (total > MAX_SOURCE_BYTES) {
      throw new Error(
        `حجم سورس انتخابی (${Math.round(total / 1024 / 1024)} مگابایت) بیش از حد مجاز است. پوشه‌های سنگین مثل dist یا build را قبل از انتخاب حذف کنید.`
      );
    }
    entries.push({
      path: relPath,
      data: new Uint8Array(await file.arrayBuffer()),
      directory: false,
    });
  }

  // The ignore files are read from the selection itself, so the folder's own
  // .gitignore / .railwayignore protect the upload without extra input.
  return entries;
}

/** Extracts the ignore files' contents from an entry list. */
export function collectIgnorePatterns(entries: SourceEntry[]): string[] {
  const patterns: string[] = [];
  for (const entry of entries) {
    const name = entry.path.split('/').pop() || '';
    if ((name === '.gitignore' || name === '.railwayignore') && entry.data) {
      patterns.push(...new TextDecoder().decode(entry.data).split(/\r?\n/));
    }
  }
  return patterns;
}

/**
 * Reads the picked `.env` files into Railway variables.
 *
 * Supports what dotenv files actually contain in the wild: `KEY=value`,
 * `export KEY=value`, `#` comments, single/double quotes (with `\n` escapes in
 * double quotes), and multi-line quoted values. Keys already set by the user
 * are left alone — an explicit edit always wins over the file.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    line = line.trim().replace(/^export\s+/, '');

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();

    // A quoted value may continue onto following lines.
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      let body = value.slice(1);
      while (!body.includes(quote) && i + 1 < lines.length) {
        body += '\n' + lines[++i];
      }
      const end = body.indexOf(quote);
      value = end >= 0 ? body.slice(0, end) : body;
      if (quote === '"') {
        value = value
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"');
      }
      out[key] = value;
      continue;
    }

    // Unquoted: drop an inline comment that follows whitespace.
    const hash = value.search(/\s#/);
    if (hash >= 0) value = value.slice(0, hash).trim();
    out[key] = value;
  }

  return out;
}

/** Picks the `.env` file belonging to the selected source and parses it. */
export function extractEnvFromEntries(entries: SourceEntry[]): {
  vars: Record<string, string>;
  fileName: string | null;
} {
  const candidates = entries.filter((e) => {
    if (e.directory || !e.data) return false;
    const parts = e.path.split('/');
    const name = parts[parts.length - 1];
    // `.env` at the project root wins; `.env.example` holds placeholders only.
    return /^\.env(\.[A-Za-z0-9_-]+)?$/.test(name);
  });
  if (candidates.length === 0) return { vars: {}, fileName: null };

  const rootEnv = candidates.find((e) => e.path === '.env');
  const chosen = rootEnv || candidates[0];
  return {
    // A .env can also carry RAILWAY_* keys; those belong to Railway.
    vars: withoutRailwayVariables(parseDotEnv(new TextDecoder().decode(chosen.data as Uint8Array))),
    fileName: chosen.path,
  };
}

/** Parses a .zip into source entries, dropping the common top-level folder. */
export async function readZipArchive(file: File): Promise<SourceEntry[]> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('حجم فایل zip بیش از حد مجاز است.');
  }
  return readZipEntries(new Uint8Array(await file.arrayBuffer()), MAX_SOURCE_BYTES);
}

export { parseDockerfile, findAndParseDockerfile, type DockerfileConfig } from './dockerfileParser';

/** Reads any supported selection into source entries. */
export async function readSourceSelection(selection: {
  kind: 'directory' | 'zip';
  files?: FileList | File[];
  zip?: File;
}): Promise<SourceEntry[]> {
  if (selection.kind === 'zip') {
    if (!selection.zip) throw new Error('فایل zip انتخاب نشده است.');
    return readZipArchive(selection.zip);
  }
  if (!selection.files || selection.files.length === 0) {
    throw new Error('پوشه‌ای انتخاب نشده است.');
  }
  return readDirectoryFiles(selection.files);
}