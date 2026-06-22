import { mkdir, readdir, stat, unlink, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { safeResolve, assertSafeName } from '../util/paths.js';
import { errors } from '../errors.js';
import {
  SUBDIRS,
  type ComponentType,
  type BundleInfo,
  type ModelManifest,
  inspectBundle,
} from './bundle.js';

export const ALLOWED_EXT = new Set(['.gguf', '.safetensors', '.ckpt', '.pt', '.bin']);

export type { ComponentType, BundleInfo } from './bundle.js';

/** Resolved on-disk paths for a model component download. */
export interface ComponentPaths {
  dir: string;
  finalPath: string;
  /** Partial-download file (resume target). */
  tmpPath: string;
  /** Sidecar JSON holding resume metadata (url, total). */
  metaPath: string;
}

export class ModelManager {
  constructor(
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Ensure the models/ root exists. Per-model bundle dirs are created on demand. */
  async init(): Promise<void> {
    await mkdir(this.config.modelsDir, { recursive: true });
  }

  /** List every model bundle (directory) and single-file model in models/. */
  async list(): Promise<BundleInfo[]> {
    let entries: { name: string; isDirectory: boolean; size: number; mtime: string }[];
    try {
      const dirents = await readdir(this.config.modelsDir, { withFileTypes: true });
      entries = [];
      for (const d of dirents) {
        if (d.name.startsWith('.')) continue;
        try {
          const s = await stat(join(this.config.modelsDir, d.name));
          entries.push({
            name: d.name,
            isDirectory: s.isDirectory(),
            size: s.size,
            mtime: s.mtime.toISOString(),
          });
        } catch {
          // skip
        }
      }
    } catch {
      return [];
    }

    const out: BundleInfo[] = [];
    for (const e of entries) {
      if (e.isDirectory) {
        try {
          out.push(await inspectBundle(this.config.modelsDir, e.name));
        } catch (err) {
          this.log.warn({ model: e.name, err: (err as Error).message }, 'failed to inspect bundle');
        }
      } else {
        // A single model file at the root is treated as a full checkpoint.
        out.push({
          id: e.name,
          name: e.name,
          loadMode: 'model',
          checkpoint: { name: e.name, size: e.size },
          vae: null,
          clip: [],
          size: e.size,
          modified: e.mtime,
          ready: true,
          partials: [],
        });
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Get a single bundle, or null if it does not exist. */
  async get(model: string): Promise<BundleInfo | null> {
    assertSafeName(model);
    const dir = safeResolve(this.config.modelsDir, model);
    try {
      const s = await stat(dir);
      if (s.isDirectory()) return await inspectBundle(this.config.modelsDir, model);
      return {
        id: model,
        name: model,
        loadMode: 'model',
        checkpoint: { name: model, size: s.size },
        vae: null,
        clip: [],
        size: s.size,
        modified: s.mtime.toISOString(),
        ready: true,
        partials: [],
      };
    } catch {
      return null;
    }
  }

  /** Write (or replace) the bundle's model.json manifest. */
  async writeManifest(model: string, manifest: ModelManifest): Promise<void> {
    assertSafeName(model);
    const dir = safeResolve(this.config.modelsDir, model);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'model.json'), JSON.stringify(manifest, null, 2), 'utf8');
    this.log.info({ model }, 'wrote model.json manifest');
  }

  /** Create an (empty) bundle directory with its component sub-directories. */
  async createBundle(model: string): Promise<void> {
    assertSafeName(model);
    const dir = safeResolve(this.config.modelsDir, model);
    for (const sub of Object.values(SUBDIRS)) {
      await mkdir(join(dir, sub), { recursive: true });
    }
    this.log.info({ model }, 'created model bundle');
  }

  private componentDir(model: string, type: ComponentType): string {
    assertSafeName(model);
    const dir = safeResolve(this.config.modelsDir, model);
    return join(dir, SUBDIRS[type]);
  }

  /** Derive a download filename from an explicit name or the URL's last segment. */
  static fileNameFor(url: string, explicit?: string): string {
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
    const ext = extname(name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      throw errors.downloadFailed(
        `Refusing to download file with unsupported extension "${ext}". Allowed: ${[...ALLOWED_EXT].join(', ')}`,
      );
    }
    return name;
  }

  /** Resolve (and create) the on-disk paths for a component download. */
  async resolveComponentPaths(
    model: string,
    type: ComponentType,
    name: string,
  ): Promise<ComponentPaths> {
    assertSafeName(model);
    assertSafeName(name);
    const dir = this.componentDir(model, type);
    await mkdir(dir, { recursive: true });
    const finalPath = safeResolve(dir, name);
    return {
      dir,
      finalPath,
      tmpPath: `${finalPath}.part`,
      metaPath: `${finalPath}.part.json`,
    };
  }

  /** Delete an entire model bundle (or a single-file model). */
  async deleteModel(model: string): Promise<void> {
    assertSafeName(model);
    const target = safeResolve(this.config.modelsDir, model);
    let isDir = false;
    try {
      isDir = (await stat(target)).isDirectory();
    } catch {
      throw errors.modelNotFound(model);
    }
    if (isDir) await rm(target, { recursive: true, force: true });
    else await unlink(target);
    this.log.info({ model }, 'model deleted');
  }

  /** Delete a single component file within a bundle. */
  async deleteComponent(model: string, type: ComponentType, name: string): Promise<void> {
    assertSafeName(model);
    const path = safeResolve(this.componentDir(model, type), name);
    try {
      await unlink(path);
    } catch {
      throw errors.modelNotFound(`${model}/${SUBDIRS[type]}/${name}`);
    }
    this.log.info({ model, type, name }, 'component deleted');
  }
}
