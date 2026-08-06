import { mkdir, readdir, stat, unlink, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { safeResolve, assertSafeName } from '../util/paths.js';
import { errors } from '../errors.js';
import type { ComponentPathResolver, ComponentPaths } from '../downloads/resolver.js';
import {
  type AudioComponentType,
  type AudioBundleInfo,
  type AudioModelManifest,
  inspectAudioBundle,
} from './bundle.js';

// audio.cpp model families ship weights (gguf/safetensors) plus, depending on
// the family, tokenizer/config/vocoder/speaker-embedding files — no archive
// extraction is supported, so only directly-usable file types are allowed.
export const ALLOWED_EXT = new Set(['.gguf', '.safetensors', '.json', '.bin', '.pt', '.txt']);

export type { AudioComponentType, AudioBundleInfo, AudioModelManifest } from './bundle.js';

/**
 * Manages audio model bundles under `config.audioModelsDir` — the flat
 * `<id>/<files...>` layout `audiocpp_server`'s generated config (see
 * src/audio/config-gen.ts) points its per-model `path` directly at. Mirrors
 * `LlmModelManager` structurally; the real difference is `model.json` is
 * required here (family/task), not an optional display-name sidecar.
 */
export class AudioModelManager implements ComponentPathResolver<AudioComponentType> {
  constructor(
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Ensure the audio-models/ root exists. Per-model dirs are created on demand. */
  async init(): Promise<void> {
    await mkdir(this.config.audioModelsDir, { recursive: true });
  }

  /** List every audio model bundle (directory) under audioModelsDir. */
  async list(): Promise<AudioBundleInfo[]> {
    let dirents: { name: string; isDirectory: () => boolean }[];
    try {
      dirents = await readdir(this.config.audioModelsDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const out: AudioBundleInfo[] = [];
    for (const d of dirents) {
      if (d.name.startsWith('.') || !d.isDirectory()) continue;
      try {
        out.push(await inspectAudioBundle(this.config.audioModelsDir, d.name));
      } catch (err) {
        this.log.warn({ model: d.name, err: (err as Error).message }, 'failed to inspect audio bundle');
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Get a single bundle, or null if it does not exist. */
  async get(model: string): Promise<AudioBundleInfo | null> {
    assertSafeName(model);
    const dir = safeResolve(this.config.audioModelsDir, model);
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) return null;
    } catch {
      return null;
    }
    return inspectAudioBundle(this.config.audioModelsDir, model);
  }

  /** Write (or replace) the bundle's model.json sidecar. Required: family + task. */
  async writeManifest(model: string, manifest: AudioModelManifest): Promise<void> {
    assertSafeName(model);
    if (!manifest.family || !manifest.task) {
      throw errors.invalidModel('Audio model.json requires both "family" and "task"');
    }
    const dir = safeResolve(this.config.audioModelsDir, model);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'model.json'), JSON.stringify(manifest, null, 2), 'utf8');
    this.log.info({ model, family: manifest.family, task: manifest.task }, 'wrote audio model.json sidecar');
  }

  /** Create an (empty) bundle directory. */
  async createBundle(model: string): Promise<void> {
    assertSafeName(model);
    await mkdir(safeResolve(this.config.audioModelsDir, model), { recursive: true });
    this.log.info({ model }, 'created audio model bundle');
  }

  /** Derive a download filename from an explicit name or the URL's last segment. */
  fileNameFor(url: string, explicit?: string): string {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw errors.downloadFailed(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw errors.downloadFailed(`Unsupported URL protocol: ${parsed.protocol}`);
    }
    const name = explicit ?? decodeURIComponent(parsed.pathname.split('/').pop() ?? '');
    assertSafeName(name);
    if (name.toLowerCase() === 'model.json') {
      throw errors.downloadFailed('"model.json" is reserved for the bundle manifest, not a download target');
    }
    const ext = extname(name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      throw errors.downloadFailed(
        `Refusing to download file with unsupported extension "${ext}". Allowed: ${[...ALLOWED_EXT].join(', ')}`,
      );
    }
    return name;
  }

  /**
   * Resolve (and create) the on-disk paths for a component download. The
   * layout is flat — `type` doesn't affect nesting, everything lands
   * directly in `<audioModelsDir>/<id>/<name>`.
   */
  async resolveComponentPaths(
    model: string,
    _type: AudioComponentType,
    name: string,
  ): Promise<ComponentPaths> {
    assertSafeName(model);
    assertSafeName(name);
    const dir = safeResolve(this.config.audioModelsDir, model);
    await mkdir(dir, { recursive: true });
    const finalPath = safeResolve(dir, name);
    return {
      dir,
      finalPath,
      tmpPath: `${finalPath}.part`,
      metaPath: `${finalPath}.part.json`,
    };
  }

  /** Delete an entire audio model bundle. */
  async deleteModel(model: string): Promise<void> {
    assertSafeName(model);
    const target = safeResolve(this.config.audioModelsDir, model);
    try {
      if (!(await stat(target)).isDirectory()) throw errors.modelNotFound(model);
    } catch {
      throw errors.modelNotFound(model);
    }
    await rm(target, { recursive: true, force: true });
    this.log.info({ model }, 'audio model deleted');
  }

  /** Delete a single file within a bundle. */
  async deleteComponent(model: string, _type: AudioComponentType, name: string): Promise<void> {
    assertSafeName(model);
    const dir = safeResolve(this.config.audioModelsDir, model);
    const path = safeResolve(dir, name);
    try {
      await unlink(path);
    } catch {
      throw errors.modelNotFound(`${model}/${name}`);
    }
    this.log.info({ model, name }, 'audio component deleted');
  }
}
