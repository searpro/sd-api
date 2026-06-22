import { mkdir, readdir, stat, unlink, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { safeResolve, assertSafeName } from '../util/paths.js';
import { errors } from '../errors.js';

export type ModelType = 'checkpoint' | 'vae' | 'clip';

const TYPE_DIR: Record<ModelType, string> = {
  checkpoint: 'checkpoints',
  vae: 'vae',
  clip: 'clip',
};

const ALLOWED_EXT = new Set(['.gguf', '.safetensors', '.ckpt', '.pt', '.bin']);

export interface ModelInfo {
  name: string;
  type: ModelType;
  size: number;
  modified: string;
}

export class ModelManager {
  constructor(
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Ensure the models/{checkpoints,vae,clip} tree exists. */
  async init(): Promise<void> {
    for (const dir of Object.values(TYPE_DIR)) {
      await mkdir(resolve(this.config.modelsDir, dir), { recursive: true });
    }
  }

  private dirFor(type: ModelType): string {
    return resolve(this.config.modelsDir, TYPE_DIR[type]);
  }

  async list(): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    for (const type of Object.keys(TYPE_DIR) as ModelType[]) {
      const dir = this.dirFor(type);
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (name.startsWith('.')) continue;
        try {
          const s = await stat(resolve(dir, name));
          if (!s.isFile()) continue;
          out.push({ name, type, size: s.size, modified: s.mtime.toISOString() });
        } catch {
          // Skip unreadable entries.
        }
      }
    }
    return out;
  }

  /** Find a model by name across all type directories. */
  async find(name: string): Promise<ModelInfo | null> {
    assertSafeName(name);
    for (const type of Object.keys(TYPE_DIR) as ModelType[]) {
      const path = safeResolve(this.dirFor(type), name);
      try {
        const s = await stat(path);
        if (s.isFile()) {
          return { name, type, size: s.size, modified: s.mtime.toISOString() };
        }
      } catch {
        // not here
      }
    }
    return null;
  }

  /**
   * Stream a model download to disk (Phase 3). Downloads to a temp file and
   * renames on success so partial downloads never look like valid models.
   */
  async download(input: {
    url: string;
    type: ModelType;
    name?: string;
    signal?: AbortSignal;
  }): Promise<ModelInfo> {
    const { url, type, signal } = input;
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

    const dir = this.dirFor(type);
    await mkdir(dir, { recursive: true });
    const finalPath = safeResolve(dir, name);
    const tmpPath = `${finalPath}.part`;

    this.log.info({ url, type, name }, 'starting model download');
    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) {
      throw errors.downloadFailed(`Download failed: HTTP ${res.status} ${res.statusText}`);
    }

    try {
      await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tmpPath));
      await rename(tmpPath, finalPath);
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      throw errors.downloadFailed(`Download interrupted: ${(err as Error).message}`);
    }

    const s = await stat(finalPath);
    this.log.info({ name, size: s.size }, 'model download complete');
    return { name, type, size: s.size, modified: s.mtime.toISOString() };
  }

  /** Safely delete a model by name (Phase 3, no directory traversal). */
  async delete(name: string): Promise<void> {
    const info = await this.find(name);
    if (!info) throw errors.modelNotFound(name);
    const path = safeResolve(this.dirFor(info.type), name);
    await unlink(path);
    this.log.info({ name, type: info.type }, 'model deleted');
  }
}
