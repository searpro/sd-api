import { mkdir, readdir, stat, unlink, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { safeResolve, assertSafeName } from '../util/paths.js';
import { errors } from '../errors.js';
import { SUBDIRS, type ComponentType, type BundleInfo, inspectBundle } from './bundle.js';

const ALLOWED_EXT = new Set(['.gguf', '.safetensors', '.ckpt', '.pt', '.bin']);

export type { ComponentType, BundleInfo } from './bundle.js';

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
      };
    } catch {
      return null;
    }
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

  /**
   * Stream a component download into models/<model>/<type>/ (Phase 3).
   * Downloads to a temp file and renames on success so partial downloads never
   * look like valid components.
   */
  async download(input: {
    model: string;
    type: ComponentType;
    url: string;
    name?: string;
    signal?: AbortSignal;
  }): Promise<BundleInfo> {
    const { model, type, url, signal } = input;
    assertSafeName(model);

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw errors.downloadFailed(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw errors.downloadFailed(`Unsupported URL protocol: ${parsed.protocol}`);
    }

    const name = input.name ?? decodeURIComponent(parsed.pathname.split('/').pop() ?? '');
    assertSafeName(name);
    const ext = extname(name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      throw errors.downloadFailed(
        `Refusing to download file with unsupported extension "${ext}". Allowed: ${[...ALLOWED_EXT].join(', ')}`,
      );
    }

    const dir = this.componentDir(model, type);
    await mkdir(dir, { recursive: true });
    const finalPath = safeResolve(dir, name);
    const tmpPath = `${finalPath}.part`;

    this.log.info({ url, model, type, name }, 'starting model download');
    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) {
      throw errors.downloadFailed(`Download failed: HTTP ${res.status} ${res.statusText}`);
    }

    try {
      await pipeline(
        Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(tmpPath),
      );
      await rename(tmpPath, finalPath);
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      throw errors.downloadFailed(`Download interrupted: ${(err as Error).message}`);
    }

    const s = await stat(finalPath);
    this.log.info({ model, type, name, size: s.size }, 'model download complete');
    return (await this.get(model))!;
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
