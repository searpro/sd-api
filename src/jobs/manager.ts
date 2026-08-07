import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { SdWrapper } from '../sd/wrapper.js';
import type { GenerateParams } from '../schemas/generate.js';
import { AppError } from '../errors.js';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface Job {
  id: string;
  status: JobStatus;
  progress: number; // 0..1
  step?: number;
  totalSteps?: number;
  params: GenerateParams;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: {
    image_path?: string;
    image_url?: string;
    video_path?: string;
    video_url?: string;
    metadata: Record<string, unknown>;
  };
  error?: { code: string; message: string };
}

/** Per-job event channel used by the SSE stream (Phase 5). */
export interface JobEvents {
  progress: { step: number; total: number; progress: number };
  log: { line: string };
  completed: Job;
  failed: Job;
}

/**
 * In-memory async job system (Phase 4) with a concurrency-limited queue.
 * State transitions: queued -> running -> completed | failed.
 */
export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly emitters = new Map<string, EventEmitter>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly waiting: string[] = [];
  private active = 0;

  constructor(
    private readonly config: Config,
    private readonly sd: SdWrapper,
    private readonly log: FastifyBaseLogger,
  ) {}

  create(params: GenerateParams): Job {
    const id = randomUUID();
    const job: Job = {
      id,
      status: 'queued',
      progress: 0,
      params,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(id, job);
    this.emitters.set(id, new EventEmitter());
    this.waiting.push(id);
    this.log.info({ jobId: id }, 'job queued');
    this.pump();
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Subscribe to a job's event stream. Returns an unsubscribe function. */
  subscribe(id: string, listener: (event: keyof JobEvents, data: unknown) => void): () => void {
    const emitter = this.emitters.get(id);
    if (!emitter) return () => {};
    const onProgress = (d: unknown) => listener('progress', d);
    const onLog = (d: unknown) => listener('log', d);
    const onCompleted = (d: unknown) => listener('completed', d);
    const onFailed = (d: unknown) => listener('failed', d);
    emitter.on('progress', onProgress);
    emitter.on('log', onLog);
    emitter.on('completed', onCompleted);
    emitter.on('failed', onFailed);
    return () => {
      emitter.off('progress', onProgress);
      emitter.off('log', onLog);
      emitter.off('completed', onCompleted);
      emitter.off('failed', onFailed);
    };
  }

  /** Cancel a queued or running job. */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === 'queued') {
      const idx = this.waiting.indexOf(id);
      if (idx >= 0) this.waiting.splice(idx, 1);
      this.fail(job, new AppError('GENERATION_FAILED', 'Job cancelled', 499));
      return true;
    }
    if (job.status === 'running') {
      this.controllers.get(id)?.abort();
      return true;
    }
    return false;
  }

  private pump(): void {
    while (this.active < this.config.maxConcurrentJobs && this.waiting.length > 0) {
      const id = this.waiting.shift()!;
      const job = this.jobs.get(id);
      if (!job || job.status !== 'queued') continue;
      void this.runJob(job);
    }
  }

  private async runJob(job: Job): Promise<void> {
    this.active++;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    const emitter = this.emitters.get(job.id)!;
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    this.log.info({ jobId: job.id }, 'job running');

    try {
      const result = await this.sd.generate({
        params: job.params,
        signal: controller.signal,
        onProgress: (p) => {
          job.progress = p.progress;
          job.step = p.step;
          job.totalSteps = p.total;
          emitter.emit('progress', p);
        },
        onLog: (line) => emitter.emit('log', { line }),
      });

      job.status = 'completed';
      job.progress = 1;
      job.finishedAt = new Date().toISOString();
      const outputUrl = `/v1/outputs/${result.outputName}`;
      job.result = {
        ...(result.kind === 'video'
          ? { video_path: result.outputPath, video_url: outputUrl }
          : { image_path: result.outputPath, image_url: outputUrl }),
        metadata: {
          kind: result.kind,
          prompt: result.params.prompt,
          model: result.params.model,
          steps: result.params.steps,
          cfg_scale: result.params.cfg_scale,
          width: result.params.width,
          height: result.params.height,
          seed: result.params.seed,
          sampler: result.params.sampler,
          video_frames: result.params.video_frames,
          flow_shift: result.params.flow_shift,
          duration_ms: result.durationMs,
        },
      };
      emitter.emit('completed', job);
      this.log.info({ jobId: job.id }, 'job completed');
    } catch (err) {
      this.fail(job, err);
    } finally {
      this.controllers.delete(job.id);
      this.active--;
      this.pump();
    }
  }

  private fail(job: Job, err: unknown): void {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    const appErr =
      err instanceof AppError ? err : new AppError('GENERATION_FAILED', (err as Error).message, 500);
    job.error = { code: appErr.code, message: appErr.message };
    this.emitters.get(job.id)?.emit('failed', job);
    this.log.warn({ jobId: job.id, err: job.error }, 'job failed');
  }
}
