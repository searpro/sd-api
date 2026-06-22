import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { access, mkdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, extname, join, delimiter, dirname } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { GenerateParams } from '../schemas/generate.js';
import { buildArgs } from './args.js';
import { parseProgress, type StepProgress } from './progress.js';
import { SdInstaller } from './installer.js';
import { safeResolve } from '../util/paths.js';
import { uniqueImageName } from '../util/filename.js';
import { errors, AppError } from '../errors.js';

export interface GenerateResult {
  imagePath: string;
  imageName: string;
  durationMs: number;
  seed?: number;
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
  constructor(
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
  ) {
    super();
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

  /** Resolve a checkpoint model name to an absolute, validated path. */
  async resolveModel(name: string): Promise<string> {
    const dir = resolve(this.config.modelsDir, 'checkpoints');
    const path = safeResolve(dir, name);
    if (extname(name).toLowerCase() !== '.gguf') {
      // Allow non-gguf single-file checkpoints too, but warn on unknown ext.
      this.log.debug({ name }, 'model extension is not .gguf');
    }
    try {
      await access(path, constants.R_OK);
    } catch {
      throw errors.modelNotFound(name);
    }
    return path;
  }

  /** Resolve an optional weight file (vae/clip) within its subdirectory. */
  private async resolveWeight(subdir: string, name: string): Promise<string> {
    const dir = resolve(this.config.modelsDir, subdir);
    const path = safeResolve(dir, name);
    try {
      await access(path, constants.R_OK);
    } catch {
      throw errors.missingWeights(`Missing ${subdir} weight: ${name}`);
    }
    return path;
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const { params, onProgress, onLog, signal } = opts;

    await mkdir(this.config.outputsDir, { recursive: true });
    const modelPath = await this.resolveModel(params.model);

    const weights: Record<string, string> = {};
    if (params.vae) weights.vae = await this.resolveWeight('vae', params.vae);
    if (params.clip_l) weights.clip_l = await this.resolveWeight('clip', params.clip_l);
    if (params.clip_g) weights.clip_g = await this.resolveWeight('clip', params.clip_g);
    if (params.t5xxl) weights.t5xxl = await this.resolveWeight('clip', params.t5xxl);

    const imageName = uniqueImageName('png');
    const outputPath = safeResolve(this.config.outputsDir, imageName);

    const args = buildArgs({ params, modelPath, outputPath, weights });
    return this.run(args, outputPath, imageName, { onProgress, onLog, signal });
  }

  /**
   * Build the child environment, adding the binary's own directory to the
   * dynamic-library search path. Prebuilt releases ship the CLI next to its
   * shared library (e.g. libstable-diffusion.so) but their RUNPATH points at
   * the build machine, so we must help the loader find the sibling lib.
   */
  private spawnEnv(binaryPath: string): NodeJS.ProcessEnv {
    if (!binaryPath.includes('/') && !binaryPath.includes('\\')) {
      // Bare command resolved via PATH — assume libs are already discoverable.
      return process.env;
    }
    const binDir = dirname(resolve(binaryPath));
    const env = { ...process.env };
    const prepend = (key: string) => {
      env[key] = env[key] ? `${binDir}${delimiter}${env[key]}` : binDir;
    };
    if (process.platform === 'darwin') {
      prepend('DYLD_LIBRARY_PATH');
      prepend('DYLD_FALLBACK_LIBRARY_PATH');
    } else if (process.platform === 'win32') {
      prepend('PATH'); // Windows resolves DLLs from PATH (and the exe dir).
    } else {
      prepend('LD_LIBRARY_PATH');
    }
    return env;
  }

  private run(
    args: string[],
    outputPath: string,
    imageName: string,
    cb: Pick<GenerateOptions, 'onProgress' | 'onLog' | 'signal'>,
  ): Promise<GenerateResult> {
    const { sdBinaryPath, jobTimeoutMs } = this.config;
    const started = Date.now();
    this.log.info({ bin: sdBinaryPath, args }, 'spawning stable-diffusion.cpp');

    return new Promise<GenerateResult>((resolvePromise, reject) => {
      const child = spawn(sdBinaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.spawnEnv(sdBinaryPath),
      });

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
                errors.generationFailed('Process exited 0 but no output image was produced', {
                  stderr: stderrTail.slice(-10),
                }),
              );
            }
          } catch {
            return finish(
              errors.generationFailed('Process exited 0 but output image is missing', {
                stderr: stderrTail.slice(-10),
              }),
            );
          }
          finish(null, { imagePath: outputPath, imageName, durationMs: Date.now() - started });
        } else {
          finish(
            errors.generationFailed(
              `stable-diffusion.cpp exited with code ${code ?? 'null'}${sig ? ` (signal ${sig})` : ''}`,
              { exitCode: code, signal: sig, stderr: stderrTail.slice(-10) },
            ),
          );
        }
      });
    });
  }
}
