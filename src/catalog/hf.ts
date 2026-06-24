import type { Format } from './types.js';
import { hfAuthHeaders, gatedHint } from '../util/hf-auth.js';

/**
 * Minimal HuggingFace Hub client for listing the weight files of a repo and
 * resolving direct download URLs. Used to populate the "select quantization"
 * options in the model catalog.
 */

const HF = 'https://huggingface.co';

export interface RepoFile {
  /** Path within the repo, e.g. "split_files/diffusion_models/model-Q4_K.gguf". */
  path: string;
  size: number;
}

export interface CatalogFile {
  filename: string;
  path: string;
  url: string;
  size: number;
  format: Format;
  /** Quantization / precision token parsed from the filename, if any. */
  quant: string | null;
}

const WEIGHT_EXT: Record<Format, string> = { safetensors: '.safetensors', gguf: '.gguf' };

/** Build a direct-download URL for a file in a repo. */
export function resolveUrl(repo: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${HF}/${repo}/resolve/main/${encoded}?download=true`;
}

const QUANT_RE =
  /(?<![a-z0-9])(bf16|fp16|fp8(?:_e4m3fn|_scaled)?|f16|f32|q\d+_k_[sml]|q\d+_k|q\d+_[0-9])(?![a-z0-9])/i;

/** Parse the quantization / precision token out of a weight filename. */
export function parseQuant(filename: string): string | null {
  const m = QUANT_RE.exec(filename);
  return m ? m[1].toUpperCase() : null;
}

interface HfTreeEntry {
  type: 'file' | 'directory';
  path: string;
  size?: number;
  lfs?: { size?: number };
}

interface Cached {
  time: number;
  files: RepoFile[];
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, Cached>();

/** Clear the in-memory file-listing cache (used in tests). */
export function clearHfCache(): void {
  cache.clear();
}

/**
 * List files in a repo (optionally within a sub-path), following the HF API's
 * cursor pagination. Results are cached for a few minutes.
 */
export async function listRepoFiles(
  repo: string,
  subPath = '',
  signal?: AbortSignal,
): Promise<RepoFile[]> {
  const key = `${repo}::${subPath}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < CACHE_TTL_MS) return hit.files;

  const base = `${HF}/api/models/${repo}/tree/main${subPath ? `/${subPath}` : ''}`;
  const headers: Record<string, string> = { 'User-Agent': 'sd-api', ...hfAuthHeaders() };

  const files: RepoFile[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const url = new URL(base);
    url.searchParams.set('recursive', 'false');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url, { headers, signal });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `${repo}: ${gatedHint(res.status, `${HF}/${repo}`)}`,
        );
      }
      throw new Error(`HuggingFace API ${res.status} ${res.statusText} for ${repo}/${subPath}`);
    }
    const entries = (await res.json()) as HfTreeEntry[];
    for (const e of entries) {
      if (e.type === 'file') files.push({ path: e.path, size: e.lfs?.size ?? e.size ?? 0 });
    }

    cursor = parseNextCursor(res.headers.get('link'));
    if (!cursor) break;
  }

  cache.set(key, { time: Date.now(), files });
  return files;
}

/** Extract the `cursor` value from a `Link: <…?cursor=X>; rel="next"` header. */
function parseNextCursor(link: string | null): string | undefined {
  if (!link) return undefined;
  const next = link.split(',').find((p) => /rel="next"/.test(p));
  if (!next) return undefined;
  const m = /[?&]cursor=([^&>]+)/.exec(next);
  return m ? decodeURIComponent(m[1]) : undefined;
}

/**
 * List the selectable weight files for a component source: the files in the
 * repo/path of the requested format, optionally filtered by a substring,
 * annotated with their parsed quantization.
 */
export async function listComponentFiles(
  source: { repo: string; path?: string; match?: string },
  format: Format,
  signal?: AbortSignal,
): Promise<CatalogFile[]> {
  const files = await listRepoFiles(source.repo, source.path ?? '', signal);
  const ext = WEIGHT_EXT[format];
  const match = source.match?.toLowerCase();

  return files
    .filter((f) => {
      const lower = f.path.toLowerCase();
      if (!lower.endsWith(ext)) return false;
      if (match && !lower.includes(match)) return false;
      return true;
    })
    .map((f) => {
      const filename = f.path.split('/').pop() ?? f.path;
      return {
        filename,
        path: f.path,
        url: resolveUrl(source.repo, f.path),
        size: f.size,
        format,
        quant: parseQuant(filename),
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}
