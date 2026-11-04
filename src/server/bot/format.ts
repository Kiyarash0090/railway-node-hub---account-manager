/** Persian formatting helpers for the Telegram bot. */

export function faNum(n: number | string): string {
  const s = typeof n === 'number' ? n.toLocaleString('en-US') : String(n);
  return s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

export function faDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

export function faCredit(used: number, limit: number): string {
  const remaining = Math.max(0, limit - used);
  const pct = limit > 0 ? Math.round((remaining / limit) * 100) : 0;
  return `${faNum(remaining.toFixed(2))}$ از ${faNum(limit.toFixed(2))}$ (${faNum(pct)}٪)`;
}

export function statusEmoji(status?: string): string {
  switch (status) {
    case 'healthy':
    case 'SUCCESS':
      return '✅';
    case 'deploying':
    case 'BUILDING':
    case 'DEPLOYING':
      return '🔄';
    case 'crashed':
    case 'FAILED':
    case 'CRASHED':
      return '❌';
    case 'stopped':
    case 'REMOVED':
      return '⏹';
    case 'sleeping':
    case 'SLEEPING':
      return '💤';
    default:
      return '❔';
  }
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/** Split a long message into chunks that fit Telegram's 4000-char text limit. */
export function splitMessage(text: string, limit = 4000): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + limit, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end);
      if (nl > start + 100) end = nl + 1;
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

export function maskSecret(value: string): string {
  if (value.length <= 4) return '****';
  return value.slice(0, 2) + '*'.repeat(Math.min(value.length - 4, 8)) + value.slice(-2);
}