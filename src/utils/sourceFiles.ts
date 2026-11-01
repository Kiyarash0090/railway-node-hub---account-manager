/**
 * Turns what the user picked in the browser (a folder or a .zip) into the flat
 * entry list `buildSourceTarball` packages for Railway's /up endpoint.
 *
 * A folder comes in as `File` objects carrying `webkitRelativePath`; a .zip is
 * parsed here because there is no filesystem to shell out to. Only stored and
 * deflated entries are supported — anything else is reported, not guessed at.
 */
import type { SourceEntry } from './sourceBundle';

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

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('مرورگر شما از باز کردن فایل zip پشتیبانی نمی‌کند؛ به‌جای آن پوشه پروژه را انتخاب کنید.');
  }
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface ZipEntryMeta {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  isDirectory: boolean;
  isSymlink: boolean;
}

function findEndOfCentralDirectory(view: DataView): number {
  const maxComment = 0xffff;
  const start = Math.max(0, view.byteLength - maxComment - 22);
  for (let i = view.byteLength - 22; i >= start; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error('فایل zip معتبر نیست (ساختار انتهای فایل پیدا نشد).');
}

/** Resolves the true entry table position, following the Zip64 records when the
 *  classic EOCD fields overflow. */
function locateCentralDirectory(view: DataView, eocd: number): { offset: number; count: number } {
  let count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  if (count === 0xffff || offset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator >= 0 && view.getUint32(locator, true) === 0x07064b50) {
      const zip64Offset = Number(view.getBigUint64(locator + 8, true));
      if (view.getUint32(zip64Offset, true) === 0x06064b50) {
        count = Number(view.getBigUint64(zip64Offset + 32, true));
        offset = Number(view.getBigUint64(zip64Offset + 48, true));
      }
    }
  }
  return { offset, count };
}

function readZip64Extra(view: DataView, start: number, length: number, entry: ZipEntryMeta): void {
  let cursor = start;
  const end = start + length;
  while (cursor + 4 <= end) {
    const id = view.getUint16(cursor, true);
    const size = view.getUint16(cursor + 2, true);
    const dataStart = cursor + 4;
    if (id === 0x0001) {
      let p = dataStart;
      if (entry.uncompressedSize === 0xffffffff && p + 8 <= dataStart + size) {
        entry.uncompressedSize = Number(view.getBigUint64(p, true));
        p += 8;
      }
      if (entry.compressedSize === 0xffffffff && p + 8 <= dataStart + size) {
        entry.compressedSize = Number(view.getBigUint64(p, true));
        p += 8;
      }
      if (entry.localHeaderOffset === 0xffffffff && p + 8 <= dataStart + size) {
        entry.localHeaderOffset = Number(view.getBigUint64(p, true));
      }
      return;
    }
    cursor = dataStart + size;
  }
}

function readCentralDirectory(view: DataView): ZipEntryMeta[] {
  const eocd = findEndOfCentralDirectory(view);
  const { offset, count } = locateCentralDirectory(view, eocd);
  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntryMeta[] = [];
  let cursor = offset;

  for (let i = 0; i < count; i++) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('فایل zip معتبر نیست (جدول فایل‌ها آسیب دیده است).');
    }
    const versionMadeBy = view.getUint16(cursor + 4, true);
    const flags = view.getUint16(cursor + 8, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const externalAttrs = view.getUint32(cursor + 38, true);
    const nameStart = cursor + 46;

    const name = decoder.decode(
      new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset + nameStart, nameLength)
    );
    const unixMode = versionMadeBy >> 8 === 3 ? externalAttrs >>> 16 : 0;

    const entry: ZipEntryMeta = {
      name: name.replace(/\\/g, '/'),
      method: view.getUint16(cursor + 10, true),
      flags,
      crc: view.getUint32(cursor + 16, true),
      compressedSize: view.getUint32(cursor + 20, true),
      uncompressedSize: view.getUint32(cursor + 24, true),
      localHeaderOffset: view.getUint32(cursor + 42, true),
      isDirectory: name.endsWith('/'),
      isSymlink: (unixMode & 0o170000) === 0o120000,
    };
    readZip64Extra(view, nameStart + nameLength, extraLength, entry);
    entries.push(entry);
    cursor = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function readZipData(view: DataView, entry: ZipEntryMeta): Promise<Uint8Array> {
  const local = entry.localHeaderOffset;
  if (local + 30 > view.byteLength || view.getUint32(local, true) !== 0x04034b50) {
    throw new Error(`فایل «${entry.name}» داخل zip سالم نیست.`);
  }
  const nameLength = view.getUint16(local + 26, true);
  const extraLength = view.getUint16(local + 28, true);
  const dataStart = local + 30 + nameLength + extraLength;
  const raw = new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset + dataStart, entry.compressedSize);

  let data: Uint8Array;
  if (entry.method === 0) {
    data = new Uint8Array(raw);
  } else if (entry.method === 8) {
    data = await inflateRaw(raw);
  } else {
    throw new Error(`فایل «${entry.name}» با روش فشرده‌سازی پشتیبانی‌نشده (${entry.method}) ذخیره شده است.`);
  }

  if (entry.method === 0 && crc32(data) !== entry.crc) {
    throw new Error(`فایل «${entry.name}» داخل zip خراب است (checksum ناهمخوان).`);
  }
  return data;
}

/** Parses a .zip into source entries, dropping the common top-level folder. */
export async function readZipArchive(file: File): Promise<SourceEntry[]> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('حجم فایل zip بیش از حد مجاز است.');
  }
  const view = new DataView(await file.arrayBuffer());
  const metas = readCentralDirectory(view);
  const entries: SourceEntry[] = [];

  // A zip's compressed size says nothing about its inflated size, so the
  // declared sizes are checked before anything is expanded.
  const inflatedTotal = metas.reduce(
    (sum, meta) => sum + (meta.isSymlink ? 0 : meta.uncompressedSize),
    0
  );
  if (inflatedTotal > MAX_SOURCE_BYTES) {
    throw new Error('محتوای فایل zip پس از باز شدن بیش از حد مجاز است. پوشه‌های سنگین را حذف و zip را دوباره بسازید.');
  }

  for (const meta of metas) {
    if (meta.isSymlink) continue;
    if (meta.name.startsWith('__MACOSX/') || meta.name.endsWith('.DS_Store')) continue;
    if (meta.flags & 0x0001) {
      throw new Error(`فایل «${meta.name}» رمزگذاری شده است؛ zip بدون رمز بسازید.`);
    }
    entries.push({
      path: meta.name.replace(/^\/+/, '').replace(/\/+$/, ''),
      data: meta.isDirectory ? null : await readZipData(view, meta),
      directory: meta.isDirectory,
    });
  }

  if (entries.length === 0) throw new Error('فایل zip خالی است.');
  return entries;
}

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