import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { access, mkdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, delimiter } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { GenerateParams } from '../schemas/generate.js';
import { buildArgs } from './args.js';
import { parseProgress, type StepProgress } from './progress.js';
import { SdInstaller } from './installer.js';
import { resolveBundle } from '../models/bundle.js';
import { safeResolve } from '../util/paths.js';
import { uniqueOutputName } from '../util/filename.js';
import { spawnEnv } from '../util/spawn-env.js';
import { Semaphore } from '../util/semaphore.js';
import { errors, AppError } from '../errors.js';

export interface GenerateResult {
  outputPath: string;
  outputName: string;
  kind: 'image' | 'video';
  durationMs: number;
  /** Effective parameters used (request values merged with bundle defaults). */
  params: GenerateParams;
}

export interface GenerateOptions {
  params: GenerateParams;
  /** Invoked on each sampling step parsed from process output. */
  onProgress?: (p: StepProgress) => void;
  /** Invoked for every raw log line (stdout + stderr). */
  onLog?: (line: string) => void;
  /** Abort signal to cancel the run. */
  signal?: AbortSignal;
}

/**
 * Wrapper around the stable-diffusion.cpp CLI. Treats the binary as a
 * black box, driven entirely through argv + parsed stdout/stderr.
 */
export class SdWrapper extends EventEmitter {
  // sd-cli is spawned per-request (not a supervised persistent process like
  // llama-server/audiocpp_server), so nothing else tracks these — without
  // this, a process killed by a dev-server restart (tsx watch, SIGTERM)
  // mid-generation is silently orphaned: it keeps running (and holding the
  // model in memory) while the new server process spawns a fresh one for
  // the next request. killAll() (called from the shutdown handler) is what
  // actually terminates them.
  private readonly activeChildren = new Set<ChildProcess>();

  // The hard bound on how many sd-cli processes exist at once.
  //
  // It lives here rather than in JobManager because this wrapper is the only
  // thing that actually spawns them, and there are two ways in: the async
  // /v1/jobs queue (which has its own admission limit) and the synchronous
  // POST /v1/generate (which had none). Limiting only the queue left the
  // synchronous route free to start as many model loads as it received
  // requests — three concurrent segment images was enough to exhaust memory
  // and have the OS kill the server mid-run.
  private readonly slots: Semaphore;

  constructor(
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
  ) {
    super();
    this.slots = new Semaphore(config.maxConcurrentJobs);
  }

  /**
   * How many sd-cli processes are alive right now, and how many callers are
   * waiting for a slot. This is the memory-critical number — each running
   * process holds a full model — so it is worth being able to observe.
   */
  get stats(): { running: number; queued: number } {
    return { running: this.activeChildren.size, queued: this.slots.queued };
  }

  /** Kill every in-flight sd-cli process. Called on server shutdown. */
  killAll(): void {
    for (const child of this.activeChildren) {
      child.kill('SIGKILL');
    }
  }

  /** True if the configured binary exists and is executable (path or on PATH). */
  async isBinaryAvailable(): Promise<boolean> {
    const bin = this.config.sdBinaryPath;
    if (bin.includes('/') || bin.includes('\\')) {
      try {
        await access(resolve(bin), constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }
    // Bare command name: search PATH.
    const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (const dir of pathDirs) {
      for (const ext of exts) {
        try {
          await access(join(dir, bin + ext), constants.X_OK);
          return true;
        } catch {
          // keep looking
        }
      }
    }
    return false;
  }

  /**
   * Ensure a usable binary exists. If none is found and auto-install is enabled,
   * download the matching stable-diffusion.cpp release and point the config at it.
   * Throws BINARY_NOT_FOUND when unavailable and auto-install is off or fails.
   */
  async ensureBinary(signal?: AbortSignal): Promise<void> {
    if (await this.isBinaryAvailable()) {
      this.log.info({ binary: this.config.sdBinaryPath }, 'stable-diffusion.cpp binary found');
      return;
    }

    if (!this.config.autoInstall) {
      throw errors.binaryNotFound(this.config.sdBinaryPath);
    }

    this.log.warn(
      { binary: this.config.sdBinaryPath, accel: this.config.accel, tag: this.config.releaseTag },
      'stable-diffusion.cpp binary not found — downloading a prebuilt release',
    );
    const installer = new SdInstaller(
      {
        installDir: this.config.installDir,
        releaseTag: this.config.releaseTag,
        accel: this.config.accel,
      },
      this.log,
    );
    const result = await installer.install(signal);
    // Repoint config at the freshly installed binary for this process.
    this.config.sdBinaryPath = result.binaryPath;
    this.log.info(
      { binaryPath: result.binaryPath, tag: result.tag, asset: result.asset },
      'stable-diffusion.cpp ready',
    );
  }

  /** Resolve an uploaded input image name to a validated absolute path. */
  private async resolveInput(name: string): Promise<string> {
    const path = safeResolve(this.config.inputsDir, name);
    try {
      await access(path, constants.R_OK);
    } catch {
      throw errors.inputNotFound(name);
    }
    return path;
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const { params, onProgress, onLog, signal } = opts;

    await mkdir(this.config.outputsDir, { recursive: true });

    // Resolve the model bundle: checkpoint + auto-wired vae / text encoders.
    const bundle = await resolveBundle(this.config.modelsDir, params.model);

    // Merge manifest defaults under the explicit request params.
    const effective: GenerateParams = {
      prompt: params.prompt,
      model: params.model,
      negative_prompt: params.negative_prompt ?? bundle.defaults.negative_prompt,
      steps: params.steps ?? bundle.defaults.steps,
      cfg_scale: params.cfg_scale ?? bundle.defaults.cfg_scale,
      width: params.width ?? bundle.defaults.width,
      height: params.height ?? bundle.defaults.height,
      seed: params.seed,
      sampler: params.sampler ?? (bundle.defaults.sampler as GenerateParams['sampler']),
      init_image: params.init_image,
      strength: params.strength,
      mask: params.mask,
      ref_images: params.ref_images,
      increase_ref_index: params.increase_ref_index,
      img_cfg_scale: params.img_cfg_scale,
      video_frames: params.video_frames ?? bundle.defaults.video_frames,
      flow_shift: params.flow_shift ?? bundle.defaults.flow_shift,
    };

    // Resolve uploaded input images (img2img / edit / Wan I2V's conditioning
    // image, which reuses the same init_image field and -i flag).
    const images = {
      init: params.init_image ? await this.resolveInput(params.init_image) : undefined,
      mask: params.mask ? await this.resolveInput(params.mask) : undefined,
      refs: params.ref_images
        ? await Promise.all(params.ref_images.map((r) => this.resolveInput(r)))
        : undefined,
    };

    // sd-cli's single-file video output only supports .avi, .webm, or animated
    // .webp (confirmed via --help — NOT .mp4, which it silently writes as
    // "<path>.avi" instead of failing). .webm is the one that's actually
    // playable in a browser <video> tag (.avi/MJPEG mostly isn't).
    const outputName = uniqueOutputName(bundle.mode === 'video' ? 'webm' : 'png');
    const outputPath = safeResolve(this.config.outputsDir, outputName);

    const args = buildArgs({ params: effective, bundle, outputPath, images });
    this.log.info(
      {
        model: bundle.id,
        loadMode: bundle.loadMode,
        mode: bundle.mode,
        weights: Object.keys(bundle.weights),
        refs: images.refs?.length ?? 0,
        init: Boolean(images.init),
      },
      'resolved model bundle',
    );
    const timeoutMs = bundle.mode === 'video' ? this.config.videoJobTimeoutMs : this.config.jobTimeoutMs;

    // Everything above is cheap bookkeeping and can happen concurrently. Only
    // the spawn itself is gated, so callers queue for the expensive resource
    // and not for path resolution.
    if (this.slots.inUse >= this.config.maxConcurrentJobs) {
      this.log.info(
        { model: bundle.id, inUse: this.slots.inUse, queued: this.slots.queued },
        'generation slots busy, waiting for a free slot',
      );
    }
    return this.slots.run(
      () =>
        this.run(args, outputPath, outputName, bundle.mode, effective, timeoutMs, {
          onProgress,
          onLog,
          signal,
        }),
      signal,
    );
  }

  private run(
    args: string[],
    outputPath: string,
    outputName: string,
    kind: 'image' | 'video',
    params: GenerateParams,
    jobTimeoutMs: number,
    cb: Pick<GenerateOptions, 'onProgress' | 'onLog' | 'signal'>,
  ): Promise<GenerateResult> {
    const { sdBinaryPath } = this.config;
    const started = Date.now();
    this.log.info({ bin: sdBinaryPath, args }, 'spawning stable-diffusion.cpp');

    return new Promise<GenerateResult>((resolvePromise, reject) => {
      const child = spawn(sdBinaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: spawnEnv(sdBinaryPath),
      });
      this.activeChildren.add(child);

      let settled = false;
      const stderrTail: string[] = [];

      const timer = setTimeout(() => {
        if (settled) return;
        this.log.warn({ jobTimeoutMs }, 'generation timed out, killing process');
        child.kill('SIGKILL');
        finish(errors.processTimeout(jobTimeoutMs));
      }, jobTimeoutMs);

      const onAbort = () => {
        if (settled) return;
        child.kill('SIGKILL');
        finish(new AppError('GENERATION_FAILED', 'Generation cancelled', 499));
      };
      cb.signal?.addEventListener('abort', onAbort, { once: true });

      const finish = (err: Error | null, result?: GenerateResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cb.signal?.removeEventListener('abort', onAbort);
        this.activeChildren.delete(child);
        if (err) reject(err);
        else resolvePromise(result!);
      };

      const handleLine = (line: string) => {
        if (!line) return;
        cb.onLog?.(line);
        this.log.debug({ line }, 'sd');
        const p = parseProgress(line);
        if (p) cb.onProgress?.(p);
      };

      const rlOut = createInterface({ input: child.stdout });
      const rlErr = createInterface({ input: child.stderr });
      rlOut.on('line', handleLine);
      rlErr.on('line', (line) => {
        stderrTail.push(line);
        if (stderrTail.length > 50) stderrTail.shift();
        handleLine(line);
      });

      child.on('error', (err) => {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'ENOENT') {
          finish(errors.binaryNotFound(sdBinaryPath));
        } else {
          finish(errors.generationFailed(`Failed to start process: ${e.message}`));
        }
      });

      child.on('close', async (code, sig) => {
        if (settled) return;
        if (code === 0) {
          try {
            const s = await stat(outputPath);
            if (!s.isFile() || s.size === 0) {
              return finish(
                errors.generationFailed(`Process exited 0 but no output ${kind} was produced`, {
                  stderr: stderrTail.slice(-10),
                }),
              );
            }
          } catch {
            return finish(
              errors.generationFailed(`Process exited 0 but output ${kind} is missing`, {
                stderr: stderrTail.slice(-10),
              }),
            );
          }
          finish(null, { outputPath, outputName, kind, durationMs: Date.now() - started, params });
        } else {
          const reason = extractFailureReason(stderrTail);
          finish(
            errors.generationFailed(
              `stable-diffusion.cpp exited with code ${code ?? 'null'}${sig ? ` (signal ${sig})` : ''}` +
                (reason ? `: ${reason}` : ''),
              { exitCode: code, signal: sig, stderr: stderrTail.slice(-15) },
            ),
          );
        }
      });
    });
  }
}

/** Pull the most informative line(s) out of the process's stderr tail. */
function extractFailureReason(stderr: string[]): string | null {
  const meaningful = stderr.filter((l) => /error|fail|fatal|cannot|unable|missing|not found|unsupported|assert/i.test(l));
  const picked = (meaningful.length > 0 ? meaningful : stderr).slice(-3);
  const joined = picked.join(' | ').trim();
  return joined.length > 0 ? joined.slice(0, 500) : null;
}
