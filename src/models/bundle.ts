import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { assertSafeName, safeResolve } from '../util/paths.js';
import { errors } from '../errors.js';

/**
 * Per-model "bundle" layout.
 *
 * Each model lives in its own directory under models/, carrying its own
 * components in sub-directories:
 *
 *   models/
 *     z-image-turbo/
 *       model.json          (optional manifest — overrides auto-detection)
 *       checkpoint/         the diffusion model / full checkpoint
 *         z_image_turbo-Q2_K.gguf
 *       vae/                optional standalone VAE
 *         z_image_vae.safetensors
 *       clip/               optional text encoder(s): clip_l/clip_g/t5xxl/llm/clip_vision
 *         qwen3-4b.gguf
 *
 * A single model file dropped directly in models/ (e.g. models/sdxl.gguf) is
 * also accepted and treated as a full checkpoint.
 */

export const SUBDIRS = {
  checkpoint: 'checkpoint',
  vae: 'vae',
  clip: 'clip',
} as const;

export type ComponentType = keyof typeof SUBDIRS; // checkpoint | vae | clip

/** Roles within the clip/ directory that map to specific sd-cli flags. */
export type ClipRole = 'clip_l' | 'clip_g' | 'clip_vision' | 't5xxl' | 'llm';

/** How the checkpoint is loaded by sd-cli. */
export type LoadMode = 'model' | 'diffusion-model';

export interface ModelManifest {
  /** Friendly display name. */
  name?: string;
  /** Force the load flag; otherwise auto-detected. */
  load?: 'auto' | LoadMode;
  /** Explicit component filenames (relative to their sub-directory). */
  components?: {
    checkpoint?: string;
    vae?: string;
  } & Partial<Record<ClipRole, string>>;
  /** Default generation parameters applied when a request omits them. */
  defaults?: {
    steps?: number;
    cfg_scale?: number;
    width?: number;
    height?: number;
    sampler?: string;
    negative_prompt?: string;
  };
}

export interface ResolvedBundle {
  id: string;
  dir: string;
  displayName: string;
  loadMode: LoadMode;
  checkpointPath: string;
  weights: Partial<Record<ClipRole | 'vae', string>>;
  defaults: NonNullable<ModelManifest['defaults']>;
}

export interface ComponentFile {
  name: string;
  size: number;
  role?: ClipRole; // only for clip components
}

export interface BundleInfo {
  id: string;
  name: string;
  loadMode: LoadMode;
  checkpoint: ComponentFile | null;
  vae: ComponentFile | null;
  clip: ComponentFile[];
  size: number;
  modified: string;
  /** Whether the bundle has at least a checkpoint and can be generated with. */
  ready: boolean;
}

async function readManifest(dir: string): Promise<ModelManifest | null> {
  try {
    const raw = await readFile(join(dir, 'model.json'), 'utf8');
    return JSON.parse(raw) as ModelManifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw errors.invalidModel(`Invalid model.json in bundle: ${(err as Error).message}`);
  }
}

async function listFiles(dir: string): Promise<{ name: string; size: number }[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: { name: string; size: number }[] = [];
  for (const name of entries) {
    if (name.startsWith('.') || name === 'model.json') continue;
    try {
      const s = await stat(join(dir, name));
      if (s.isFile()) out.push({ name, size: s.size });
    } catch {
      // skip
    }
  }
  return out;
}

/** Heuristically map a clip/ filename to its text-encoder role. */
export function detectClipRole(filename: string): ClipRole | null {
  const n = filename.toLowerCase();
  if (/clip[_-]?vision|clip_vit/.test(n)) return 'clip_vision';
  if (/clip[_-]?l\b|clip[_-]?l[._-]|clip_l/.test(n)) return 'clip_l';
  if (/clip[_-]?g\b|clip[_-]?g[._-]|clip_g/.test(n)) return 'clip_g';
  if (/t5xxl|t5[_-]?xxl|\bt5\b/.test(n)) return 't5xxl';
  if (/qwen|mistral|gemma|llama|\bllm\b|umt5/.test(n)) return 'llm';
  return null;
}

function pickLargest(files: { name: string; size: number }[]): { name: string; size: number } | null {
  if (files.length === 0) return null;
  return [...files].sort((a, b) => b.size - a.size)[0];
}

/**
 * Inspect a bundle directory and return its components (for listing). Does not
 * throw on a missing checkpoint — that is reflected via `ready: false`.
 */
export async function inspectBundle(modelsDir: string, id: string): Promise<BundleInfo> {
  assertSafeName(id);
  const dir = safeResolve(modelsDir, id);
  const manifest = await readManifest(dir);

  const ckptFiles = await listFiles(join(dir, SUBDIRS.checkpoint));
  const vaeFiles = await listFiles(join(dir, SUBDIRS.vae));
  const clipFiles = await listFiles(join(dir, SUBDIRS.clip));

  const checkpoint = pickFile(ckptFiles, manifest?.components?.checkpoint);
  const vae = pickFile(vaeFiles, manifest?.components?.vae);
  const clip: ComponentFile[] = clipFiles.map((f) => ({
    ...f,
    role: manifestRoleFor(manifest, f.name) ?? detectClipRole(f.name) ?? undefined,
  }));

  const allFiles = [...ckptFiles, ...vaeFiles, ...clipFiles];
  const size = allFiles.reduce((a, f) => a + f.size, 0);
  let modified = new Date(0).toISOString();
  try {
    modified = (await stat(dir)).mtime.toISOString();
  } catch {
    /* ignore */
  }

  return {
    id,
    name: manifest?.name ?? id,
    loadMode: resolveLoadMode(manifest, vae !== null, clip.length > 0),
    checkpoint: checkpoint ? { name: checkpoint.name, size: checkpoint.size } : null,
    vae: vae ? { name: vae.name, size: vae.size } : null,
    clip,
    size,
    modified,
    ready: checkpoint !== null,
  };
}

function pickFile(
  files: { name: string; size: number }[],
  explicit?: string,
): { name: string; size: number } | null {
  if (explicit) return files.find((f) => f.name === explicit) ?? null;
  if (files.length <= 1) return files[0] ?? null;
  return pickLargest(files);
}

function manifestRoleFor(manifest: ModelManifest | null, filename: string): ClipRole | null {
  const comps = manifest?.components;
  if (!comps) return null;
  for (const role of ['clip_l', 'clip_g', 'clip_vision', 't5xxl', 'llm'] as ClipRole[]) {
    if (comps[role] === filename) return role;
  }
  return null;
}

function resolveLoadMode(
  manifest: ModelManifest | null,
  hasVae: boolean,
  hasClip: boolean,
): LoadMode {
  const m = manifest?.load;
  if (m === 'model' || m === 'diffusion-model') return m;
  // Auto: presence of standalone components implies a split (diffusion-only) model.
  return hasVae || hasClip ? 'diffusion-model' : 'model';
}

/**
 * Resolve a bundle for generation. Throws if the checkpoint is missing.
 * Accepts either a directory bundle or a single model file in models/.
 */
export async function resolveBundle(modelsDir: string, id: string): Promise<ResolvedBundle> {
  assertSafeName(id);
  const target = safeResolve(modelsDir, id);

  let info: { isDir: boolean };
  try {
    const s = await stat(target);
    info = { isDir: s.isDirectory() };
  } catch {
    throw errors.modelNotFound(id);
  }

  // Single-file full model: models/<id> is a file.
  if (!info.isDir) {
    return {
      id,
      dir: modelsDir,
      displayName: id,
      loadMode: 'model',
      checkpointPath: target,
      weights: {},
      defaults: {},
    };
  }

  const dir = target;
  const manifest = await readManifest(dir);

  const ckptFiles = await listFiles(join(dir, SUBDIRS.checkpoint));
  const vaeFiles = await listFiles(join(dir, SUBDIRS.vae));
  const clipFiles = await listFiles(join(dir, SUBDIRS.clip));

  const checkpoint = pickFile(ckptFiles, manifest?.components?.checkpoint);
  if (!checkpoint) {
    throw errors.invalidModel(
      `Model "${id}" has no checkpoint file in ${SUBDIRS.checkpoint}/`,
    );
  }
  const vae = pickFile(vaeFiles, manifest?.components?.vae);

  const weights: Partial<Record<ClipRole | 'vae', string>> = {};
  if (vae) weights.vae = resolve(dir, SUBDIRS.vae, vae.name);
  for (const f of clipFiles) {
    const role = manifestRoleFor(manifest, f.name) ?? detectClipRole(f.name);
    if (!role) continue; // unmapped clip file; manifest needed to use it
    if (!weights[role]) weights[role] = resolve(dir, SUBDIRS.clip, f.name);
  }

  return {
    id,
    dir,
    displayName: manifest?.name ?? id,
    loadMode: resolveLoadMode(manifest, vae !== null, clipFiles.length > 0),
    checkpointPath: resolve(dir, SUBDIRS.checkpoint, checkpoint.name),
    weights,
    defaults: manifest?.defaults ?? {},
  };
}
