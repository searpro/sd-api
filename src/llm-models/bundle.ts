import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSafeName, safeResolve } from '../util/paths.js';
import { errors } from '../errors.js';

/**
 * Per-model layout for LLM serving, flat (unlike the SD side's
 * checkpoint/vae/clip sub-directories) because that's what `llama-server
 * --models-dir` expects directly — no copy step between "downloaded" and
 * "servable":
 *
 *   <llmModelsDir>/
 *     qwen3-4b/
 *       model.json          (optional sidecar — display name only)
 *       qwen3-4b-Q4_K_M.gguf
 *       mmproj-f16.gguf     (optional vision projector)
 */

export type LlmComponentType = 'gguf' | 'mmproj';

export interface LlmModelManifest {
  /** Friendly display name. */
  name?: string;
}

export interface LlmComponentFile {
  name: string;
  size: number;
}

export interface LlmPartialFile {
  type: LlmComponentType;
  /** Final filename (without the .part suffix). */
  name: string;
  received: number;
  total: number | null;
}

export interface LlmBundleInfo {
  id: string;
  name: string;
  /** Main GGUF weights file. */
  weights: LlmComponentFile | null;
  /** Vision projector, if this is a VLM. */
  mmproj: LlmComponentFile | null;
  size: number;
  modified: string;
  /** Whether the bundle has weights and can be served. */
  ready: boolean;
  partials: LlmPartialFile[];
}

async function readManifest(dir: string): Promise<LlmModelManifest | null> {
  try {
    const raw = await readFile(join(dir, 'model.json'), 'utf8');
    return JSON.parse(raw) as LlmModelManifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw errors.invalidModel(`Invalid model.json in LLM bundle: ${(err as Error).message}`);
  }
}

/** A file whose name starts with "mmproj" is a vision projector, per llama.cpp convention. */
export function isMmproj(filename: string): boolean {
  return /^mmproj/i.test(filename);
}

async function listGgufFiles(dir: string): Promise<{ name: string; size: number }[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: { name: string; size: number }[] = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.gguf')) continue;
    try {
      const s = await stat(join(dir, name));
      if (s.isFile()) out.push({ name, size: s.size });
    } catch {
      // skip
    }
  }
  return out;
}

async function listPartials(dir: string): Promise<LlmPartialFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: LlmPartialFile[] = [];
  for (const name of entries) {
    if (!name.endsWith('.gguf.part')) continue;
    try {
      const s = await stat(join(dir, name));
      if (!s.isFile()) continue;
      let total: number | null = null;
      try {
        const meta = JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8'));
        total = typeof meta.total === 'number' ? meta.total : null;
      } catch {
        // no sidecar
      }
      const finalName = name.slice(0, -'.part'.length);
      out.push({
        type: isMmproj(finalName) ? 'mmproj' : 'gguf',
        name: finalName,
        received: s.size,
        total,
      });
    } catch {
      // skip
    }
  }
  return out;
}

function pickLargest(files: { name: string; size: number }[]): { name: string; size: number } | null {
  if (files.length === 0) return null;
  return [...files].sort((a, b) => b.size - a.size)[0];
}

/** Inspect an LLM bundle directory. Does not throw on missing weights (`ready: false` instead). */
export async function inspectLlmBundle(llmModelsDir: string, id: string): Promise<LlmBundleInfo> {
  assertSafeName(id);
  const dir = safeResolve(llmModelsDir, id);
  const manifest = await readManifest(dir);

  const files = await listGgufFiles(dir);
  const mmprojFiles = files.filter((f) => isMmproj(f.name));
  const weightFiles = files.filter((f) => !isMmproj(f.name));
  const partials = await listPartials(dir);

  const weights = pickLargest(weightFiles);
  const mmproj = pickLargest(mmprojFiles);
  const size = files.reduce((a, f) => a + f.size, 0);

  let modified = new Date(0).toISOString();
  try {
    modified = (await stat(dir)).mtime.toISOString();
  } catch {
    /* ignore */
  }

  return {
    id,
    name: manifest?.name ?? id,
    weights,
    mmproj,
    size,
    modified,
    ready: weights !== null,
    partials,
  };
}
