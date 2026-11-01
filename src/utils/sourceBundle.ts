/**
 * Browser-side source bundling for Railway's local-source deploy.
 *
 * `railway up` builds a gzipped tar of the project and POSTs it to backboard's
 * private /up endpoint — there is no GraphQL mutation that accepts uploaded
 * source. This reproduces that tarball (ustar entries named `./<relative
 * path>`, `.git` and `node_modules` skipped, `.railwayignore`/`.gitignore`
 * honored) so the app can deploy local code with no GitHub repo.
 */

export interface SourceEntry {
  /** Path relative to the project root, forward slashes, no leading `./`. */
  path: string;
  /** null for directory entries. */
  data: Uint8Array | null;
  directory: boolean;
}

/** Path components the Railway CLI always drops, whatever the ignore files say. */
const ALWAYS_SKIPPED = new Set(['.git', 'node_modules']);

const BLOCK = 512;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '۰ بایت';
  const units = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const label = value.toLocaleString('fa-IR', {
    maximumFractionDigits: unit > 0 && value < 10 ? 1 : 0,
  });
  return `${label} ${units[unit]}`;
}

/** Drops the single shared top-level folder that zipping a project produces,
 *  so the archive root is the project itself (Railway expects package.json
 *  etc. at the root). */
export function stripCommonRoot(entries: SourceEntry[]): SourceEntry[] {
  if (entries.length === 0) return entries;
  const roots = new Set(entries.map((e) => e.path.split('/')[0]));
  if (roots.size !== 1) return entries;
  const root = [...roots][0];
  // A root-level file means the archive genuinely has files at its root.
  if (entries.some((e) => e.path === root)) return entries;
  return entries.map((e) => ({ ...e, path: e.path.slice(root.length + 1) })).filter((e) => e.path);
}

/** Converts ignore-file text into the pattern list the matcher understands. */
export function parseIgnoreFile(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * A pragmatic subset of gitignore matching: comments, `!` negation, a leading
 * `/` for root-anchored patterns, a trailing `/` for directories, and `*` /
 * `**` / `?` globs. Used to keep locally-ignored secrets (.env, dist/) out of
 * the uploaded tarball, exactly as `railway up` does.
 */
export class IgnoreMatcher {
  private rules: { re: RegExp; dirOnly: boolean; negated: boolean }[] = [];

  constructor(patterns: string[]) {
    for (const raw of patterns) {
      const line = raw.replace(/\r$/, '');
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const negated = line.startsWith('!');
      const body = negated ? line.slice(1) : line;
      if (!body.trim()) continue;
      this.rules.push({ ...globToRegExp(body), negated });
    }
  }

  ignores(relPath: string, isDirectory: boolean): boolean {
    const parts = relPath.split('/');
    let ignored = false;
    // An ignored directory also hides everything beneath it, so each ancestor
    // is tested as a directory too.
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');
      const asDirectory = i < parts.length || isDirectory;
      const verdict = this.matchOne(prefix, asDirectory);
      if (verdict !== null) ignored = verdict;
    }
    return ignored;
  }

  private matchOne(path: string, isDirectory: boolean): boolean | null {
    let result: boolean | null = null;
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDirectory) continue;
      if (rule.re.test(path)) result = !rule.negated;
    }
    return result;
  }
}

function globToRegExp(pattern: string): { re: RegExp; dirOnly: boolean } {
  let body = pattern.trim();
  let dirOnly = false;
  if (body.endsWith('/')) {
    dirOnly = true;
    body = body.slice(0, -1);
  }
  // gitignore: a slash anywhere but the end anchors the pattern to the root.
  const anchored = body.startsWith('/') || body.includes('/');
  if (body.startsWith('/')) body = body.slice(1);

  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '*') {
      if (body[i + 1] === '*') {
        i++;
        if (body[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      out += '\\' + ch;
    } else {
      out += ch;
    }
  }

  return { re: new RegExp(`^${anchored ? '' : '(?:.*/)?'}${out}$`), dirOnly };
}

function writeString(buf: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = new TextEncoder().encode(value);
  buf.set(bytes.subarray(0, Math.min(bytes.length, length)), offset);
}

function writeOctal(buf: Uint8Array, offset: number, length: number, value: number): void {
  const digits = Math.max(0, Math.floor(value))
    .toString(8)
    .padStart(length - 1, '0')
    .slice(-(length - 1));
  for (let i = 0; i < digits.length; i++) buf[offset + i] = digits.charCodeAt(i);
  buf[offset + length - 1] = 0;
}

/** ustar splits long paths between a 155-byte prefix and a 100-byte name. */
function splitLongPath(fullPath: string): { name: string; prefix: string } {
  const encoder = new TextEncoder();
  if (encoder.encode(fullPath).length <= 100) return { name: fullPath, prefix: '' };

  const parts = fullPath.split('/');
  let name = '';
  while (parts.length > 1) {
    const candidate = name ? `${parts[parts.length - 1]}/${name}` : parts[parts.length - 1];
    if (encoder.encode(candidate).length > 100) break;
    name = candidate;
    parts.pop();
  }
  const prefix = parts.join('/');
  if (!name || encoder.encode(prefix).length > 155) {
    throw new Error(`مسیر «${fullPath}» برای فرمت tar بیش از حد بلند است.`);
  }
  return { name, prefix };
}

function makeHeader(fullName: string, size: number, mtime: number, isDirectory: boolean): Uint8Array {
  const header = new Uint8Array(BLOCK);
  const { name, prefix } = splitLongPath(fullName);

  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, isDirectory ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, mtime);
  header.fill(0x20, 148, 156);
  header[156] = isDirectory ? 0x35 : 0x30;
  writeString(header, 257, 6, 'ustar\0');
  header[263] = 0x30;
  header[264] = 0x30;
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  writeString(header, 345, 155, prefix);

  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += header[i];
  const checksum = sum.toString(8).padStart(6, '0').slice(-6);
  for (let i = 0; i < 6; i++) header[148 + i] = checksum.charCodeAt(i);
  header[154] = 0;
  header[155] = 0x20;

  return header;
}

function gzipBytes(bytes: Uint8Array): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('مرورگر شما از فشرده‌سازی gzip پشتیبانی نمی‌کند؛ از Chrome، Edge یا Firefox جدید استفاده کنید.');
  }
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export interface BundledSource {
  blob: Blob;
  fileCount: number;
  /** Uncompressed size of the file contents. */
  sourceBytes: number;
  skippedCount: number;
}

/**
 * Builds the gzipped tarball Railway's /up endpoint accepts: entries named
 * `./<path>`, no `.git`/`node_modules`, and locally-ignored files dropped.
 */
export async function buildSourceTarball(
  entries: SourceEntry[],
  ignorePatterns: string[] = []
): Promise<BundledSource> {
  const matcher = new IgnoreMatcher(ignorePatterns);
  let skippedCount = 0;

  // Zip entries may carry a directory's trailing slash; tar names get one
  // added back for directories, so leaving it would produce `./src//`.
  const normalized = entries.map((entry) => ({
    ...entry,
    path: entry.path.replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, ''),
  }));

  const kept = normalized.filter((entry) => {
    const parts = entry.path.split('/');
    const alwaysSkipped = parts.some((part) => ALWAYS_SKIPPED.has(part));
    if (alwaysSkipped || matcher.ignores(entry.path, entry.directory)) {
      skippedCount++;
      return false;
    }
    return true;
  });

  // Every parent directory of a kept file needs its own entry, otherwise
  // extractors may not create intermediate folders.
  const directories = new Set<string>();
  for (const entry of kept) {
    const parts = entry.path.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
    if (entry.directory) directories.add(entry.path);
  }

  const ordered: { path: string; data: Uint8Array | null; directory: boolean }[] = [
    ...[...directories].sort().map((path) => ({ path, data: null, directory: true })),
    ...kept
      .filter((entry) => !entry.directory)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((entry) => ({ path: entry.path, data: entry.data, directory: false })),
  ];

  const totalSize = ordered.reduce(
    (sum, entry) => sum + BLOCK + (entry.data ? Math.ceil(entry.data.length / BLOCK) * BLOCK : 0),
    0
  );
  const tar = new Uint8Array(totalSize + BLOCK * 2);
  const mtime = Math.floor(Date.now() / 1000);
  let offset = 0;
  let sourceBytes = 0;

  for (const entry of ordered) {
    const name = entry.directory ? `./${entry.path}/` : `./${entry.path}`;
    const size = entry.data ? entry.data.length : 0;
    tar.set(makeHeader(name, size, mtime, entry.directory), offset);
    offset += BLOCK;
    if (entry.data) {
      tar.set(entry.data, offset);
      offset += Math.ceil(size / BLOCK) * BLOCK;
      sourceBytes += size;
    }
  }

  return {
    blob: await gzipBytes(tar),
    fileCount: ordered.filter((entry) => !entry.directory).length,
    sourceBytes,
    skippedCount,
  };
}
