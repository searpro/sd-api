/**
 * HuggingFace authentication (Phase 1: token from the environment).
 *
 * Gated/private models require a HuggingFace access token. The token is read
 * from `HF_TOKEN` (or `HUGGING_FACE_HUB_TOKEN`) and attached as a Bearer header
 * on HuggingFace requests (catalog file listing + model downloads).
 *
 * An in-memory override (`setHfToken`) exists so a future phase can let the UI
 * set the token at runtime (e.g. via an OAuth flow) without an env var — see
 * docs/ARCHITECTURE.md "HuggingFace auth". Phase 1 does not expose a setter.
 */

const HF_BASE = 'https://huggingface.co';

let override: string | null = null;

/** Set/clear an in-memory token (future OAuth/runtime phase). */
export function setHfToken(token: string | null): void {
  override = token && token.trim() ? token.trim() : null;
  clearWhoamiCache();
}

function envToken(): string | undefined {
  const t = process.env.HF_TOKEN ?? process.env.HUGGING_FACE_HUB_TOKEN;
  return t && t.trim() ? t.trim() : undefined;
}

export function getHfToken(): string | undefined {
  return override ?? envToken();
}

export type HfTokenSource = 'override' | 'env' | 'none';

export function hfTokenSource(): HfTokenSource {
  if (override) return 'override';
  return envToken() ? 'env' : 'none';
}

/** A non-reversible hint for display, e.g. "hf_…a1b2". Never returns the token. */
export function maskToken(token: string): string {
  if (token.length <= 8) return '••••';
  return `${token.slice(0, 3)}…${token.slice(-4)}`;
}

export function isHuggingFaceUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('huggingface.co');
  } catch {
    return false;
  }
}

/**
 * Authorization header for HuggingFace. When `targetUrl` is given the header is
 * only attached for HuggingFace hosts (so a redirect to a CDN, or a non-HF
 * mirror, never leaks the token).
 */
export function hfAuthHeaders(targetUrl?: string): Record<string, string> {
  const token = getHfToken();
  if (!token) return {};
  if (targetUrl && !isHuggingFaceUrl(targetUrl)) return {};
  return { Authorization: `Bearer ${token}` };
}

export interface HfUser {
  name: string;
  fullname?: string;
}

let whoamiCache: { at: number; user: HfUser } | null = null;
const WHOAMI_TTL_MS = 60_000;

export function clearWhoamiCache(): void {
  whoamiCache = null;
}

/**
 * Validate the configured token against the HuggingFace API and return the
 * account it belongs to. Returns null when no token is configured. Throws on an
 * invalid token or a network/HTTP error (callers should surface the message).
 */
export async function hfWhoami(signal?: AbortSignal): Promise<HfUser | null> {
  const token = getHfToken();
  if (!token) return null;
  if (whoamiCache && Date.now() - whoamiCache.at < WHOAMI_TTL_MS) return whoamiCache.user;

  const res = await fetch(`${HF_BASE}/api/whoami-v2`, {
    headers: { 'User-Agent': 'sd-api', Authorization: `Bearer ${token}` },
    signal,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('Invalid or expired HuggingFace token');
  }
  if (!res.ok) {
    throw new Error(`HuggingFace whoami failed: HTTP ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { name?: string; fullname?: string };
  if (!data.name) throw new Error('Unexpected whoami response');
  const user: HfUser = { name: data.name, fullname: data.fullname };
  whoamiCache = { at: Date.now(), user };
  return user;
}

/**
 * Build an actionable message for a gated/unauthorized HuggingFace response.
 * `repoUrl` is the model page the user should visit to accept the license.
 */
export function gatedHint(status: number, repoUrl?: string): string {
  const auth = hfTokenSource() === 'none';
  const base =
    status === 401
      ? auth
        ? 'access denied (HTTP 401) — this model is likely gated/private. Set HF_TOKEN with an account that has access'
        : 'access denied (HTTP 401) — the HF_TOKEN is missing access or is invalid'
      : 'access forbidden (HTTP 403) — this model is gated; accept its license on HuggingFace';
  const accept = repoUrl ? ` and accept the license at ${repoUrl}` : '';
  return `${base}${accept}.`;
}
