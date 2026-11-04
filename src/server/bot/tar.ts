/** Minimal tar.gz reader — extracts file entries from a .tar.gz buffer without
 *  any native dependency. Only supports regular files (no symlinks/dirs).
 *  Used to inspect uploaded source archives for env files before deploy. */

import zlib from 'node:zlib';

export interface TarEntry {
  name: string;
  data: Buffer;
}

export function extractTarGz(gzipped: Buffer): TarEntry[] {
  const tar = zlib.gunzipSync(gzipped);
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    // End-of-archive marker: two consecutive zero blocks
    if (header.every((b) => b === 0)) break;

    const nameRaw = header.subarray(0, 100);
    const nameEnd = nameRaw.indexOf(0);
    const name = nameRaw.subarray(0, nameEnd === -1 ? 100 : nameEnd).toString('utf8').trim();

    // Size is octal ASCII in bytes 124..135
    const sizeStr = header.subarray(124, 136).toString('ascii').replace(/\0/g, '').trim();
    const size = parseInt(sizeStr, 8) || 0;

    // Type flag at byte 156: '0' or '\0' = regular file
    const typeFlag = header[156];
    const isFile = typeFlag === 0x30 || typeFlag === 0x00;

    offset += 512; // skip header

    if (isFile && size > 0 && offset + size <= tar.length) {
      entries.push({ name, data: Buffer.from(tar.subarray(offset, offset + size)) });
    }

    // Advance past data + padding to 512-byte boundary
    offset += Math.ceil(size / 512) * 512;
  }

  return entries;
}