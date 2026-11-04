/**
 * Minimal .zip reader shared by the browser bundler and the server bot.
 *
 * Only stored (0) and deflated (8) entries are supported; anything else is
 * reported rather than guessed at. Runs on plain `Uint8Array` and the
 * `DecompressionStream` global, so it works in a browser and in Node alike.
 */

export interface ZipSourceEntry {
  /** Path relative to the archive root, forward slashes, no leading slash. */
  path: string;
  /** null for directory entries. */
  data: Uint8Array | null;
  directory: boolean;
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
    throw new Error('محیط اجرا از باز کردن فایل zip پشتیبانی نمی‌کند.');
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

/**
 * Parses a .zip held in memory into source entries.
 * `maxUncompressedBytes` caps the inflated total, since a zip's compressed size
 * says nothing about how much a malicious archive could expand to.
 */
export async function readZipEntries(
  bytes: Uint8Array,
  maxUncompressedBytes: number
): Promise<ZipSourceEntry[]> {
  const view = new DataView(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
  const metas = readCentralDirectory(view);

  const inflatedTotal = metas.reduce(
    (sum, meta) => sum + (meta.isSymlink ? 0 : meta.uncompressedSize),
    0
  );
  if (inflatedTotal > maxUncompressedBytes) {
    throw new Error('محتوای فایل zip پس از باز شدن بیش از حد مجاز است. پوشه‌های سنگین را حذف و zip را دوباره بسازید.');
  }

  const entries: ZipSourceEntry[] = [];
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
