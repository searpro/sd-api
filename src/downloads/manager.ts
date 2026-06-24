import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import { stat, rename, unlink, writeFile, readFile } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { ModelManager, type ComponentType } from '../models/manager.js';
import { errors, AppError } from '../errors.js';
import { hfAuthHeaders, isHuggingFaceUrl, gatedHint } from '../util/hf-auth.js';

export type DownloadStatus = 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';

export interface DownloadTask {
  id: string;
  model: string;
  type: ComponentType;
  name: string;
  url: string;
  status: DownloadStatus;
  /** Bytes written to disk so far (includes any resumed prefix). */
  received: number;
  /** Total expected size in bytes, or null if the server didn't report it. */
  total: number | null;
  /** True when this run resumed from an existing partial. */
  resumed: boolean;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface SidecarMeta {
  url: string;
  total: number | null;
  model: string;
  type: ComponentType;
  name: string;
}

const PROGRESS_INTERVAL_MS = 400;

/**
 * Background download manager for model components.
 *
 * - Runs downloads off the request path (concurrency-limited queue).
 * - Reports byte-level progress.
 * - Resumes interrupted downloads via HTTP Range requests against the existing
 *   `.part` file. A `.part.json` sidecar stores the source URL + total so a
 *   download can be resumed even after a server restart.
 */
export class DownloadManager {
  private readonly tasks = new Map<string, DownloadTask>();
  private readonly emitters = new Map<string, EventEmitter>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly byKey = new Map<string, string>(); // model/type/name -> task id
  private readonly waiting: string[] = [];
  private active = 0;

  constructor(
    private readonly config: Config,
    private readonly models: ModelManager,
    private readonly log: FastifyBaseLogger,
  ) {}

  private key(model: string, type: ComponentType, name: string): string {
    return `${model}/${type}/${name}`;
  }

  /** Enqueue a download (or return the existing active task for the same file). */
  enqueue(input: { model: string; type: ComponentType; url: string; name?: string }): DownloadTask {
    const name = ModelManager.fileNameFor(input.url, input.name);
    const key = this.key(input.model, input.type, name);

    const existingId = this.byKey.get(key);
    if (existingId) {
      const existing = this.tasks.get(existingId);
      if (existing && (existing.status === 'queued' || existing.status === 'downloading')) {
        return existing;
      }
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const task: DownloadTask = {
      id,
      model: input.model,
      type: input.type,
      name,
      url: input.url,
      status: 'queued',
      received: 0,
      total: null,
      resumed: false,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    this.emitters.set(id, new EventEmitter());
    this.byKey.set(key, id);
    this.waiting.push(id);
    this.log.info({ id, model: input.model, type: input.type, name }, 'download queued');
    this.pump();
    return task;
  }

  /** Retry a failed/cancelled task (resumes from its existing .part). */
  retry(id: string): DownloadTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (task.status === 'downloading' || task.status === 'queued') return task;
    return this.enqueue({ model: task.model, type: task.type, url: task.url, name: task.name });
  }

  list(model?: string): DownloadTask[] {
    const all = [...this.tasks.values()];
    const filtered = model ? all.filter((t) => t.model === model) : all;
    return filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): DownloadTask | undefined {
    return this.tasks.get(id);
  }

  /** Cancel a running/queued download. The .part file is kept for resuming. */
  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status === 'queued') {
      const idx = this.waiting.indexOf(id);
      if (idx >= 0) this.waiting.splice(idx, 1);
      this.settle(task, 'cancelled');
      return true;
    }
    if (task.status === 'downloading') {
      this.controllers.get(id)?.abort();
      return true;
    }
    return false;
  }

  /** Remove a task record; optionally discard the partial file on disk. */
  async remove(id: string, discardPartial: boolean): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status === 'downloading') this.controllers.get(id)?.abort();
    if (discardPartial) {
      const p = await this.models.resolveComponentPaths(task.model, task.type, task.name);
      await unlink(p.tmpPath).catch(() => {});
      await unlink(p.metaPath).catch(() => {});
    }
    this.tasks.delete(id);
    this.emitters.delete(id);
    this.byKey.delete(this.key(task.model, task.type, task.name));
    return true;
  }

  subscribe(id: string, listener: (event: string, data: unknown) => void): () => void {
    const emitter = this.emitters.get(id);
    if (!emitter) return () => {};
    const onProgress = (d: unknown) => listener('progress', d);
    const onDone = (d: unknown) => listener('done', d);
    emitter.on('progress', onProgress);
    emitter.on('done', onDone);
    return () => {
      emitter.off('progress', onProgress);
      emitter.off('done', onDone);
    };
  }

  private pump(): void {
    while (this.active < this.config.maxConcurrentDownloads && this.waiting.length > 0) {
      const id = this.waiting.shift()!;
      const task = this.tasks.get(id);
      if (!task || task.status !== 'queued') continue;
      void this.run(task);
    }
  }

  private touch(task: DownloadTask): void {
    task.updatedAt = new Date().toISOString();
  }

  private settle(task: DownloadTask, status: DownloadStatus, error?: string): void {
    task.status = status;
    if (error) task.error = error;
    this.touch(task);
    this.emitters.get(task.id)?.emit('done', { ...task });
  }

  private async run(task: DownloadTask): Promise<void> {
    this.active++;
    task.status = 'downloading';
    this.touch(task);
    const controller = new AbortController();
    this.controllers.set(task.id, controller);

    try {
      await this.download(task, controller.signal);
      task.status = 'completed';
      if (task.total != null) task.received = task.total;
      this.settle(task, 'completed');
      this.log.info({ id: task.id, name: task.name }, 'download complete');
    } catch (err) {
      if (controller.signal.aborted) {
        this.settle(task, 'cancelled', 'Download cancelled');
      } else {
        const msg = err instanceof AppError ? err.message : (err as Error).message;
        this.settle(task, 'failed', msg);
        this.log.warn({ id: task.id, err: msg }, 'download failed');
      }
    } finally {
      this.controllers.delete(task.id);
      this.active--;
      this.pump();
    }
  }

  private async download(task: DownloadTask, signal: AbortSignal): Promise<void> {
    const paths = await this.models.resolveComponentPaths(task.model, task.type, task.name);

    // How much is already on disk?
    let offset = 0;
    try {
      offset = (await stat(paths.tmpPath)).size;
    } catch {
      offset = 0;
    }

    const headers: Record<string, string> = { 'User-Agent': 'sd-api', ...hfAuthHeaders(task.url) };
    if (offset > 0) headers.Range = `bytes=${offset}-`;

    const res = await fetch(task.url, { headers, signal, redirect: 'follow' });

    let append = false;
    let total: number | null = null;

    if (res.status === 416 && offset > 0) {
      // Range not satisfiable: the .part already holds the whole file.
      await rename(paths.tmpPath, paths.finalPath);
      await unlink(paths.metaPath).catch(() => {});
      task.total = offset;
      task.received = offset;
      return;
    }
    if (offset > 0 && res.status === 206) {
      append = true;
      task.resumed = true;
      task.received = offset;
      total = parseContentRangeTotal(res.headers.get('content-range'));
    } else if (res.ok) {
      // 200: server ignored Range (or fresh download) -> start over.
      append = false;
      offset = 0;
      task.received = 0;
      const cl = res.headers.get('content-length');
      total = cl ? Number(cl) : null;
    } else if ((res.status === 401 || res.status === 403) && isHuggingFaceUrl(task.url)) {
      throw errors.downloadFailed(gatedHint(res.status));
    } else {
      throw errors.downloadFailed(`HTTP ${res.status} ${res.statusText}`);
    }
    if (!res.body) throw errors.downloadFailed('Empty response body');

    task.total = total;
    this.touch(task);

    // Persist resume metadata.
    const meta: SidecarMeta = {
      url: task.url,
      total,
      model: task.model,
      type: task.type,
      name: task.name,
    };
    await writeFile(paths.metaPath, JSON.stringify(meta), 'utf8').catch(() => {});

    // Stream to disk, counting bytes and emitting throttled progress.
    let lastEmit = 0;
    const emitter = this.emitters.get(task.id);
    const counter = new Transform({
      transform: (chunk: Buffer, _enc, cb) => {
        task.received += chunk.length;
        const now = Date.now();
        if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
          lastEmit = now;
          this.touch(task);
          emitter?.emit('progress', { ...task });
        }
        cb(null, chunk);
      },
    });

    const ws = createWriteStream(paths.tmpPath, { flags: append ? 'a' : 'w' });
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      counter,
      ws,
      { signal },
    );

    // Success: promote the .part to the final file and drop the sidecar.
    await rename(paths.tmpPath, paths.finalPath);
    await unlink(paths.metaPath).catch(() => {});
  }

  /** Resume a partial download discovered on disk (uses its sidecar URL). */
  async resumePartial(model: string, type: ComponentType, name: string): Promise<DownloadTask> {
    const paths = await this.models.resolveComponentPaths(model, type, name);
    let url: string;
    try {
      const meta = JSON.parse(await readFile(paths.metaPath, 'utf8')) as SidecarMeta;
      url = meta.url;
    } catch {
      throw errors.downloadFailed(
        `Cannot resume "${name}": missing resume metadata. Re-download it instead.`,
      );
    }
    return this.enqueue({ model, type, url, name });
  }
}

function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const m = /\/(\d+)\s*$/.exec(header);
  return m ? Number(m[1]) : null;
}
