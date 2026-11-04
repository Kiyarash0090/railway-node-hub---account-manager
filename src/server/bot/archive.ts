/** Converts an uploaded .zip into the gzipped tarball Railway's /up endpoint
 *  accepts, so the bot's source-upload flow can take either format. */

import zlib from 'node:zlib';
import { readZipEntries } from '../../utils/zipArchive';

const BLOCK = 512;
/** Matches the web client's limit — the /up endpoint rejects larger archives. */
export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;

const ALWAYS_SKIPPED = new Set(['.git', 'node_modules']);

function writeString(buf: Buffer, offset: number, length: number, value: string): void {
  Buffer.from(value, 'utf8').copy(buf, offset, 0, length);
}

function writeOctal(buf: Buffer, offset: number, length: number, value: number): void {
  const digits = Math.max(0, Math.floor(value))
    .toString(8)
    .padStart(length - 1, '0')
    .slice(-(length - 1));
  buf.write(digits, offset, 'ascii');
  buf[offset + length - 1] = 0;
}

/** ustar splits paths longer than 100 bytes between a prefix and a name. */
function splitLongPath(fullPath: string): { name: string; prefix: string } {
  if (Buffer.byteLength(fullPath) <= 100) return { name: fullPath, prefix: '' };

  const parts = fullPath.split('/');
  let name = '';
  while (parts.length > 1) {
    const candidate = name ? `${parts[parts.length - 1]}/${name}` : parts[parts.length - 1];
    if (Buffer.byteLength(candidate) > 100) break;
    name = candidate;
    parts.pop();
  }
  const prefix = parts.join('/');
  if (!name || Buffer.byteLength(prefix) > 155) {
    throw new Error(`مسیر «${fullPath}» برای فرمت tar بیش از حد بلند است.`);
  }
  return { name, prefix };
}

function makeHeader(fullName: string, size: number, isDirectory: boolean): Buffer {
  const header = Buffer.alloc(BLOCK);
  const { name, prefix } = splitLongPath(fullName);

  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, isDirectory ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
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
  writeString(header, 148, 6, sum.toString(8).padStart(6, '0').slice(-6));
  header[154] = 0;
  header[155] = 0x20;

  return header;
}

/** Drops the single shared top-level folder that zipping a project produces, so
 *  the archive root is the project itself (package.json etc. at the root). */
function stripCommonRoot<T extends { path: string; directory: boolean }>(entries: T[]): T[] {
  if (entries.length === 0) return entries;
  const roots = new Set(entries.map((e) => e.path.split('/')[0]));
  if (roots.size !== 1) return entries;
  const root = [...roots][0];
  if (entries.some((e) => e.path === root)) return entries;
  return entries
    .map((e) => ({ ...e, path: e.path.slice(root.length + 1) }))
    .filter((e) => e.path);
}

/** Reads a .zip into a gzipped ustar tarball with `./`-prefixed entries. */
export async function zipToTarGz(bytes: Buffer): Promise<Buffer> {
  const parsed = await readZipEntries(bytes, MAX_ARCHIVE_BYTES);

  const kept = stripCommonRoot(
    parsed
      .map((entry) => ({ ...entry, path: entry.path.replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '') }))
      .filter((entry) => entry.path)
  ).filter((entry) => !entry.path.split('/').some((part) => ALWAYS_SKIPPED.has(part)));

  if (!kept.some((entry) => !entry.directory)) {
    throw new Error('فایل zip هیچ فایلی ندارد (فقط پوشه‌های خالی).');
  }

  // Extractors may not create intermediate folders on their own, so every
  // parent directory gets an explicit entry.
  const directories = new Set<string>();
  for (const entry of kept) {
    const parts = entry.path.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
    if (entry.directory) directories.add(entry.path);
  }

  const ordered = [
    ...[...directories].sort().map((path) => ({ path, data: null as Uint8Array | null, directory: true })),
    ...kept
      .filter((entry) => !entry.directory && entry.data)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((entry) => ({ path: entry.path, data: entry.data as Uint8Array | null, directory: false })),
  ];

  const chunks: Buffer[] = [];
  for (const entry of ordered) {
    const name = entry.directory ? `./${entry.path}/` : `./${entry.path}`;
    const size = entry.data ? entry.data.length : 0;
    chunks.push(makeHeader(name, size, entry.directory));
    if (entry.data && size > 0) {
      chunks.push(Buffer.from(entry.data));
      const padding = Math.ceil(size / BLOCK) * BLOCK - size;
      if (padding > 0) chunks.push(Buffer.alloc(padding));
    }
  }
  // Two zero blocks mark the end of the archive.
  chunks.push(Buffer.alloc(BLOCK * 2));

  return zlib.gzipSync(Buffer.concat(chunks));
}
