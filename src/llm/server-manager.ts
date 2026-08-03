import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, delimiter } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { buildLlamaServerArgs } from './args.js';
import { LlamaInstaller } from './installer.js';
import { spawnEnv } from '../util/spawn-env.js';
import { errors } from '../errors.js';

export type LlamaServerStatus = 'stopped' | 'starting' | 'ready' | 'unhealthy' | 'failed';

const HEALTH_POLL_INTERVAL_MS = 300;
const STOP_GRACE_MS = 5000;

/**
 * Supervises a single, long-running `llama-server` process (router mode — no
 * `-m`, models are discovered from `--models-dir` and requests route by the
 * `"model"` field). Unlike SdWrapper (which spawns sd-cli fresh per request
 * and waits for it to exit), this process is started once and stays up across
 * many HTTP requests; src/routes/llm.ts reverse-proxies to it.
 */
export class LlamaServerManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private _status: LlamaServerStatus = 'stopped';
  private _lastError: string | undefined;
  private stderrTail: string[] = [];
  private stopping = false;
  private startPromise: Promise<void> | null = null;

  constructor(
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
  ) {
    super();
  }

  get status(): LlamaServerStatus {
    return this._status;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.config.llmPort}`;
  }

  get lastError(): string | undefined {
    return this._lastError;
  }

  isReady(): boolean {
    return this._status === 'ready';
  }

  /** True if the configured binary exists and is executable (path or on PATH). */
  async isBinaryAvailable(): Promise<boolean> {
    const bin = this.config.llmBinaryPath;
    if (bin.includes('/') || bin.includes('\\')) {
      try {
        await access(resolve(bin), constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }
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
   * Ensure a usable binary exists. If none is found and auto-install is
   * enabled, download the matching llama.cpp release and point the config at
   * it. Throws LLM_BINARY_NOT_FOUND when unavailable and auto-install is off
   * or fails. Mirrors SdWrapper.ensureBinary().
   */
  async ensureBinary(signal?: AbortSignal): Promise<void> {
    if (await this.isBinaryAvailable()) {
      this.log.info({ binary: this.config.llmBinaryPath }, 'llama-server binary found');
      return;
    }

    if (!this.config.llmAutoInstall) {
      throw errors.llmBinaryNotFound(this.config.llmBinaryPath);
    }

    this.log.warn(
      { binary: this.config.llmBinaryPath, accel: this.config.llmAccel, tag: this.config.llmReleaseTag },
      'llama-server binary not found — downloading a prebuilt release',
    );
    const installer = new LlamaInstaller(
      {
        installDir: this.config.llmInstallDir,
        releaseTag: this.config.llmReleaseTag,
        accel: this.config.llmAccel,
      },
      this.log,
    );
    const result = await installer.install(signal);
    this.config.llmBinaryPath = result.binaryPath;
    this.log.info(
      { binaryPath: result.binaryPath, tag: result.tag, asset: result.asset },
      'llama.cpp ready',
    );
  }

  /** Start the server if not already starting/ready (idempotent, coalesces concurrent callers). */
  async ensureRunning(signal?: AbortSignal): Promise<void> {
    if (this._status === 'ready') return;
    return this.start(signal);
  }

  /**
   * Spawn llama-server and wait for it to become healthy. Coalesces
   * concurrent callers into a single spawn: the `startPromise` guard below is
   * checked and set synchronously (before any `await`), so two calls made
   * back-to-back (e.g. via Promise.all) both observe the same in-flight
   * promise rather than racing to spawn twice — note `_status` alone isn't a
   * safe guard here, since `doStart()` doesn't flip it to 'starting' until
   * after its first `await`, leaving a window where a status-only check
   * would miss an already-in-flight start.
   */
  async start(signal?: AbortSignal): Promise<void> {
    if (this.startPromise) return this.startPromise;
    const promise = this.doStart(signal);
    this.startPromise = promise;
    try {
      await promise;
    } finally {
      this.startPromise = null;
    }
  }

  private async doStart(signal?: AbortSignal): Promise<void> {
    await mkdir(this.config.llmModelsDir, { recursive: true });

    this._status = 'starting';
    this._lastError = undefined;
    this.stderrTail = [];
    this.stopping = false;

    const args = buildLlamaServerArgs(this.config);
    this.log.info({ bin: this.config.llmBinaryPath, args }, 'spawning llama-server');

    const child = spawn(this.config.llmBinaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv(this.config.llmBinaryPath),
    });
    this.child = child;

    const handleLine = (line: string) => {
      if (!line) return;
      this.log.debug({ line }, 'llama-server');
      this.stderrTail.push(line);
      if (this.stderrTail.length > 50) this.stderrTail.shift();
    };
    createInterface({ input: child.stdout }).on('line', handleLine);
    createInterface({ input: child.stderr }).on('line', handleLine);

    child.on('exit', (code, sig) => this.handleExit(code, sig));
    child.on('error', (err) => {
      const e = err as NodeJS.ErrnoException;
      this._status = 'failed';
      this._lastError =
        e.code === 'ENOENT'
          ? `llama-server binary not found: ${this.config.llmBinaryPath}`
          : `Failed to start llama-server: ${e.message}`;
      this.log.error({ err: this._lastError }, 'llama-server spawn error');
    });

    try {
      await this.waitForHealth(this.config.llmStartupTimeoutMs, signal);
      this._status = 'ready';
      this.log.info({ baseUrl: this.baseUrl }, 'llama-server ready');
    } catch (err) {
      this._status = 'failed';
      this._lastError = (err as Error).message;
      child.kill('SIGKILL');
      this.child = null;
      throw errors.llmStartupFailed(this._lastError);
    }
  }

  private async waitForHealth(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (signal?.aborted) throw new Error('Startup aborted');
      if (this._status === 'failed') {
        throw new Error(
          `llama-server exited before becoming healthy${this._lastError ? `: ${this._lastError}` : ''}` +
            (this.stderrTail.length ? ` (${this.stderrTail.slice(-5).join(' | ')})` : ''),
        );
      }
      try {
        const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) return;
      } catch {
        // not up yet, keep polling
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out after ${timeoutMs}ms waiting for llama-server /health` +
            (this.stderrTail.length ? ` (${this.stderrTail.slice(-5).join(' | ')})` : ''),
        );
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
    }
  }

  private handleExit(code: number | null, signal: string | null): void {
    this.child = null;
    if (this.stopping) {
      this._status = 'stopped';
      this.log.info({ code, signal }, 'llama-server stopped');
      return;
    }
    // Unexpected exit (crash, or exited while we were still waiting for /health).
    this._status = 'failed';
    this._lastError = `llama-server exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
    this.log.warn({ code, signal, tail: this.stderrTail.slice(-10) }, 'llama-server exited unexpectedly');
  }

  /** Stop the server (SIGTERM, then SIGKILL after a grace period). No-op if not running. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) {
      this._status = 'stopped';
      return;
    }
    this.stopping = true;
    await new Promise<void>((resolvePromise) => {
      const onExit = () => {
        clearTimeout(killTimer);
        resolvePromise();
      };
      child.once('exit', onExit);
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, STOP_GRACE_MS);
    });
  }
}
