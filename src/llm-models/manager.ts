import { mkdir, readdir, stat, unlink, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { safeResolve, assertSafeName } from '../util/paths.js';
import { errors } from '../errors.js';
import type { ComponentPathResolver, ComponentPaths } from '../downloads/resolver.js';
import {
  type LlmComponentType,
  type LlmBundleInfo,
  type LlmModelManifest,
  inspectLlmBundle,
} from './bundle.js';

export const ALLOWED_EXT = new Set(['.gguf']);

export type { LlmComponentType, LlmBundleInfo } from './bundle.js';

/**
 * Manages LLM model bundles under `config.llmModelsDir` — the flat
 * `<id>/<weights>.gguf` (+ optional `mmproj-*.gguf`) layout `llama-server
 * --models-dir` expects directly. Mirrors `ModelManager` (image models) but
 * without the checkpoint/vae/clip sub-directory split, since LLM serving has
 * no equivalent component fan-out.
 */
export class LlmModelManager implements ComponentPathResolver<LlmComponentType> {
  constructor(
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Ensure the llm-models/ root exists. Per-model dirs are created on demand. */
  async init(): Promise<void> {
    await mkdir(this.config.llmModelsDir, { recursive: true });
  }

  /** List every LLM model bundle (directory) under llmModelsDir. */
  async list(): Promise<LlmBundleInfo[]> {
    let dirents: { name: string; isDirectory: () => boolean }[];
    try {
      dirents = await readdir(this.config.llmModelsDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const out: LlmBundleInfo[] = [];
    for (const d of dirents) {
      if (d.name.startsWith('.') || !d.isDirectory()) continue;
      try {
        out.push(await inspectLlmBundle(this.config.llmModelsDir, d.name));
      } catch (err) {
        this.log.warn({ model: d.name, err: (err as Error).message }, 'failed to inspect LLM bundle');
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Get a single bundle, or null if it does not exist. */
  async get(model: string): Promise<LlmBundleInfo | null> {
    assertSafeName(model);
    const dir = safeResolve(this.config.llmModelsDir, model);
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) return null;
    } catch {
      return null;
    }
    return inspectLlmBundle(this.config.llmModelsDir, model);
  }

  /** Write (or replace) the bundle's model.json sidecar. */
  async writeManifest(model: string, manifest: LlmModelManifest): Promise<void> {
    assertSafeName(model);
    const dir = safeResolve(this.config.llmModelsDir, model);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'model.json'), JSON.stringify(manifest, null, 2), 'utf8');
    this.log.info({ model }, 'wrote LLM model.json sidecar');
  }

  /** Create an (empty) bundle directory. */
  async createBundle(model: string): Promise<void> {
    assertSafeName(model);
    await mkdir(safeResolve(this.config.llmModelsDir, model), { recursive: true });
    this.log.info({ model }, 'created LLM model bundle');
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
   * directly in `<llmModelsDir>/<id>/<name>`.
   */
  async resolveComponentPaths(
    model: string,
    _type: LlmComponentType,
    name: string,
  ): Promise<ComponentPaths> {
    assertSafeName(model);
    assertSafeName(name);
    const dir = safeResolve(this.config.llmModelsDir, model);
    await mkdir(dir, { recursive: true });
    const finalPath = safeResolve(dir, name);
    return {
      dir,
      finalPath,
      tmpPath: `${finalPath}.part`,
      metaPath: `${finalPath}.part.json`,
    };
  }

  /** Delete an entire LLM model bundle. */
  async deleteModel(model: string): Promise<void> {
    assertSafeName(model);
    const target = safeResolve(this.config.llmModelsDir, model);
    try {
      if (!(await stat(target)).isDirectory()) throw errors.modelNotFound(model);
    } catch {
      throw errors.modelNotFound(model);
    }
    await rm(target, { recursive: true, force: true });
    this.log.info({ model }, 'LLM model deleted');
  }

  /** Delete a single file within a bundle. */
  async deleteComponent(model: string, _type: LlmComponentType, name: string): Promise<void> {
    assertSafeName(model);
    const dir = safeResolve(this.config.llmModelsDir, model);
    const path = safeResolve(dir, name);
    try {
      await unlink(path);
    } catch {
      throw errors.modelNotFound(`${model}/${name}`);
    }
    this.log.info({ model, name }, 'LLM component deleted');
  }
}
