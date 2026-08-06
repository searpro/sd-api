import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, delimiter } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { buildAudioServerArgs } from './args.js';
import { writeAudioServerConfig } from './config-gen.js';
import { AudioInstaller } from './installer.js';
import { spawnEnv } from '../util/spawn-env.js';
import { errors } from '../errors.js';

export type AudioServerStatus = 'stopped' | 'starting' | 'ready' | 'unhealthy' | 'failed';

const HEALTH_POLL_INTERVAL_MS = 300;
const STOP_GRACE_MS = 5000;
// Coalesces restarts triggered by multiple near-simultaneous component
// downloads for the same model into one restart.
const RESTART_DEBOUNCE_MS = 3000;

/**
 * Supervises a single, long-running `audiocpp_server` process. Structurally
 * mirrors LlamaServerManager (src/llm/server-manager.ts) almost exactly —
 * spawn once, health-poll, stay up across many requests, reverse-proxied by
 * src/routes/audio.ts — with one real difference: audiocpp_server has no
 * directory-scan equivalent to `--models-dir`. It loads an explicit JSON
 * registry via --config, so every (re)start first regenerates that file from
 * whatever audio model bundles + model.json manifests currently exist (see
 * config-gen.ts) — the same trigger point LlamaServerManager uses
 * scheduleRestart() for, just with an extra write step first.
 */
export class AudioServerManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private _status: AudioServerStatus = 'stopped';
  private _lastError: string | undefined;
  private stderrTail: string[] = [];
  private stopping = false;
  private startPromise: Promise<void> | null = null;
  private restartTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
  ) {
    super();
  }

  get status(): AudioServerStatus {
    return this._status;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.config.audioPort}`;
  }

  get lastError(): string | undefined {
    return this._lastError;
  }

  isReady(): boolean {
    return this._status === 'ready';
  }

  /** True if the configured binary exists and is executable (path or on PATH). */
  async isBinaryAvailable(): Promise<boolean> {
    const bin = this.config.audioBinaryPath;
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
   * enabled, download the matching audio.cpp release and point the config at
   * it. Throws AUDIO_BINARY_NOT_FOUND when unavailable and auto-install is
   * off or fails. Mirrors LlamaServerManager.ensureBinary(); note audio.cpp
   * currently only publishes Windows prebuilt releases, so auto-install will
   * fail on Linux/macOS until upstream ships assets for those platforms —
   * see AudioInstaller for the manual-build guidance surfaced in that case.
   */
  async ensureBinary(signal?: AbortSignal): Promise<void> {
    if (await this.isBinaryAvailable()) {
      this.log.info({ binary: this.config.audioBinaryPath }, 'audiocpp_server binary found');
      return;
    }

    if (!this.config.audioAutoInstall) {
      throw errors.audioBinaryNotFound(this.config.audioBinaryPath);
    }

    this.log.warn(
      {
        binary: this.config.audioBinaryPath,
        accel: this.config.audioAccel,
        tag: this.config.audioReleaseTag,
        releasesRepo: this.config.audioReleasesRepo,
      },
      'audiocpp_server binary not found — attempting to download a prebuilt release',
    );
    const installer = new AudioInstaller(
      {
        installDir: this.config.audioInstallDir,
        releaseTag: this.config.audioReleaseTag,
        accel: this.config.audioAccel,
        releasesRepo: this.config.audioReleasesRepo,
      },
      this.log,
    );
    const result = await installer.install(signal);
    this.config.audioBinaryPath = result.binaryPath;
    this.log.info(
      { binaryPath: result.binaryPath, tag: result.tag, asset: result.asset },
      'audio.cpp ready',
    );
  }

  /** Start the server if not already starting/ready (idempotent, coalesces concurrent callers). */
  async ensureRunning(signal?: AbortSignal): Promise<void> {
    if (this._status === 'ready') return;
    return this.start(signal);
  }

  /**
   * Stop then start audiocpp_server, regenerating its --config file first so
   * models added (downloaded) since the last start become servable — it only
   * reads its model registry at startup, never live.
   */
  async restart(signal?: AbortSignal): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    await this.stop();
    await this.start(signal);
  }

  /**
   * Debounced restart: call after an audio model download completes so the
   * server picks it up without a manual process restart. Multiple calls
   * within the debounce window collapse into a single restart. Non-throwing
   * — failures are logged, since this runs off the request path.
   */
  scheduleRestart(delayMs = RESTART_DEBOUNCE_MS): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.restart().catch((err) => {
        this.log.warn(
          { err: (err as Error).message },
          'auto-restart of audiocpp_server failed after model download',
        );
      });
    }, delayMs);
    this.restartTimer.unref();
  }

  /**
   * Spawn audiocpp_server and wait for it to become healthy. Coalesces
   * concurrent callers into a single spawn — see LlamaServerManager.start()
   * for why the startPromise guard must be checked/set synchronously.
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
    await mkdir(this.config.audioModelsDir, { recursive: true });

    this._status = 'starting';
    this._lastError = undefined;
    this.stderrTail = [];
    this.stopping = false;

    const { path: configPath, modelIds } = await writeAudioServerConfig(this.config, this.log);

    // Confirmed against the real binary: audiocpp_server exits immediately
    // with "server config requires a non-empty models array" if none are
    // registered — unlike llama-server, which is happy to start with zero
    // GGUF files and just serves nothing until one appears. Skip the
    // spawn/health-poll cycle entirely rather than treating a fresh install
    // (no audio models yet) as a startup failure; ensureRunning()/start()
    // resolve normally, status stays 'stopped', and the next scheduleRestart()
    // after a model is installed retries with a non-empty config.
    if (modelIds.length === 0) {
      this._status = 'stopped';
      this.log.info(
        'no audio models registered (need a bundle with a valid model.json) — skipping audiocpp_server start',
      );
      return;
    }

    const args = buildAudioServerArgs(configPath);
    this.log.info({ bin: this.config.audioBinaryPath, args }, 'spawning audiocpp_server');

    const child = spawn(this.config.audioBinaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv(this.config.audioBinaryPath),
    });
    this.child = child;

    const handleLine = (line: string) => {
      if (!line) return;
      this.log.debug({ line }, 'audio-server');
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
          ? `audiocpp_server binary not found: ${this.config.audioBinaryPath}`
          : `Failed to start audiocpp_server: ${e.message}`;
      this.log.error({ err: this._lastError }, 'audiocpp_server spawn error');
    });

    try {
      await this.waitForHealth(this.config.audioStartupTimeoutMs, signal);
      this._status = 'ready';
      this.log.info({ baseUrl: this.baseUrl }, 'audiocpp_server ready');
    } catch (err) {
      this._status = 'failed';
      this._lastError = (err as Error).message;
      child.kill('SIGKILL');
      this.child = null;
      throw errors.audioStartupFailed(this._lastError);
    }
  }

  private async waitForHealth(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (signal?.aborted) throw new Error('Startup aborted');
      if (this._status === 'failed') {
        throw new Error(
          `audiocpp_server exited before becoming healthy${this._lastError ? `: ${this._lastError}` : ''}` +
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
          `Timed out after ${timeoutMs}ms waiting for audiocpp_server /health` +
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
      this.log.info({ code, signal }, 'audiocpp_server stopped');
      return;
    }
    // Unexpected exit (crash, or exited while we were still waiting for /health).
    this._status = 'failed';
    this._lastError = `audiocpp_server exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
    this.log.warn({ code, signal, tail: this.stderrTail.slice(-10) }, 'audiocpp_server exited unexpectedly');
  }

  /** Stop the server (SIGTERM, then SIGKILL after a grace period). No-op if not running. */
  async stop(): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
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
