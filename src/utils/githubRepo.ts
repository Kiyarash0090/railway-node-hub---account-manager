/**
 * Normalizes any GitHub reference the user pastes into the canonical
 * `owner/repo` form that Railway's GitHubRepoDeployInput requires.
 *
 * Accepts: plain `owner/repo`, https/http URLs (with or without www, .git,
 * trailing slash, query/hash), `git@github.com:owner/repo.git` SSH form and
 * `ssh://git@github.com/owner/repo`.
 *
 * Returns null when the input cannot be interpreted as a GitHub repository.
 */
export function normalizeGitHubRepo(raw: string): string | null {
  let repo = (raw || '').trim();
  if (!repo) return null;

  const sshMatch = repo.match(/^(?:ssh:\/\/)?git@github\.com[:/]+(.+)$/i);
  if (sshMatch) {
    repo = sshMatch[1];
  } else {
    // Strip scheme + optional www + host, so only the path remains.
    repo = repo.replace(/^[a-z][a-z0-9+.-]*:\/\/(?:www\.)?github\.com\//i, '');
    repo = repo.replace(/^(?:www\.)?github\.com\//i, '');
    repo = repo.replace(/^github\.com[:/]/i, '');
  }

  // Drop anything after the repo path (anchors, query strings).
  repo = repo.split(/[?#]/)[0];
  // `.git` suffix is only for cloning; the API wants the bare name.
  repo = repo.replace(/\.git$/i, '');
  repo = repo.replace(/^\/+|\/+$/g, '');

  const parts = repo.split('/').filter(Boolean);
  if (parts.length !== 2) return null;

  const normalized = `${parts[0]}/${parts[1]}`;
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized) ? normalized : null;
}

/** Extracts a human-readable message from a Railway proxy/GraphQL response, if any. */
export function extractApiError(res: any, fallback: string): string | null {
  if (!res || typeof res !== 'object') return null;
  if (Array.isArray(res.errors) && res.errors.length > 0) {
    return res.errors[0]?.message || fallback;
  }
  if (res.error) return String(res.error);
  return null;
}
