import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Configuration system (Phase 7).
 *
 * Resolution order (later wins):
 *   1. config/default.json
 *   2. config/local.json (optional, git-ignored)
 *   3. Environment variables (SD_* prefix) — including a `.env` file in the
 *      project root, loaded via `dotenv/config` at the top of src/index.ts.
 *      A real shell/CI-exported variable always wins over `.env` (dotenv
 *      never overrides an already-set variable).
 */

const configFileSchema = z
  .object({
    sd_binary_path: z.string(),
    models_dir: z.string(),
    outputs_dir: z.string(),
    inputs_dir: z.string(),
    host: z.string(),
    port: z.number().int().positive(),
    max_concurrent_jobs: z.number().int().positive(),
    max_concurrent_downloads: z.number().int().positive(),
    job_timeout_ms: z.number().int().positive(),
    video_job_timeout_ms: z.number().int().positive(),
    max_image_dim: z.number().int().positive(),
    log_level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
    auto_install: z.boolean(),
    install_dir: z.string(),
    release_tag: z.string(),
    accel: z.enum(['cpu', 'vulkan', 'cuda', 'rocm']),
    llm_binary_path: z.string(),
    llm_auto_install: z.boolean(),
    llm_install_dir: z.string(),
    llm_release_tag: z.string(),
    llm_accel: z.enum(['cpu', 'vulkan', 'cuda', 'rocm']),
    llm_models_dir: z.string(),
    llm_port: z.number().int().positive(),
    llm_ctx_size: z.number().int().positive(),
    llm_gpu_layers: z.number().int().min(-1),
    llm_jinja: z.boolean(),
    llm_startup_timeout_ms: z.number().int().positive(),
    llm_request_timeout_ms: z.number().int().min(0),
    audio_binary_path: z.string(),
    audio_auto_install: z.boolean(),
    audio_install_dir: z.string(),
    audio_releases_repo: z.string(),
    audio_release_tag: z.string(),
    audio_accel: z.enum(['cpu', 'vulkan', 'cuda', 'rocm']),
    audio_models_dir: z.string(),
    audio_port: z.number().int().positive(),
    audio_startup_timeout_ms: z.number().int().positive(),
    audio_request_timeout_ms: z.number().int().min(0),
    audio_voice_refs_dir: z.string(),
  })
  .partial();

export interface Config {
  sdBinaryPath: string;
  modelsDir: string;
  outputsDir: string;
  inputsDir: string;
  host: string;
  port: number;
  maxConcurrentJobs: number;
  maxConcurrentDownloads: number;
  jobTimeoutMs: number;
  /** Per-process hard timeout for video (mode:"video" bundle) generations — much longer-running than images. */
  videoJobTimeoutMs: number;
  maxImageDim: number;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  /** Download a prebuilt sd binary at startup if none is found. */
  autoInstall: boolean;
  /** Where auto-installed binaries are unpacked. */
  installDir: string;
  /** Release tag to install ("latest" or e.g. "master-714-b12098f"). */
  releaseTag: string;
  /** Hardware backend to prefer when selecting a release asset. */
  accel: 'cpu' | 'vulkan' | 'cuda' | 'rocm';

  // --- LLM serving (llama.cpp) ---
  /** Path to the llama-server binary (or a bare command on PATH). */
  llmBinaryPath: string;
  /** Download a prebuilt llama-server release at startup if none is found. */
  llmAutoInstall: boolean;
  /** Where auto-installed llama-server binaries are unpacked. */
  llmInstallDir: string;
  /** llama.cpp release tag to install ("latest" or a specific tag). */
  llmReleaseTag: string;
  /** Hardware backend to prefer when selecting a llama.cpp release asset. */
  llmAccel: 'cpu' | 'vulkan' | 'cuda' | 'rocm';
  /** Root directory llama-server's router mode scans for GGUF models. */
  llmModelsDir: string;
  /** Internal port llama-server listens on (bound to 127.0.0.1 only). */
  llmPort: number;
  /** Default context size (-c) for loaded models. */
  llmCtxSize: number;
  /** Default GPU layers (-ngl); -1 means omit the flag (let llama-server auto-decide). */
  llmGpuLayers: number;
  /** Enable jinja chat-template + tool-calling support (--jinja). */
  llmJinja: boolean;
  /** Max time to wait for llama-server's /health to become ready at startup. */
  llmStartupTimeoutMs: number;

  // --- Audio generation (audio.cpp) ---
  /** Path to the audiocpp_server binary (or a bare command on PATH). */
  audioBinaryPath: string;
  /** Download a prebuilt audiocpp_server release at startup if none is found. */
  audioAutoInstall: boolean;
  /** Where auto-installed audiocpp_server binaries are unpacked. */
  audioInstallDir: string;
  /**
   * "owner/repo" to query for audio.cpp releases. Defaults to upstream,
   * which as of this writing only publishes Windows assets — override with
   * a fork/mirror that publishes Linux/macOS builds once one exists.
   */
  audioReleasesRepo: string;
  /** audio.cpp release tag to install ("latest" or a specific tag). */
  audioReleaseTag: string;
  /** Hardware backend to prefer when selecting an audio.cpp release asset. */
  audioAccel: 'cpu' | 'vulkan' | 'cuda' | 'rocm';
  /** Root directory holding per-model audio bundles (see src/audio/config-gen.ts). */
  audioModelsDir: string;
  /** Internal port audiocpp_server listens on (bound to 127.0.0.1 only). */
  audioPort: number;
  /** Max time to wait for audiocpp_server's /health to become ready at startup. */
  audioStartupTimeoutMs: number;
  /** Generated server config's busy_timeout_ms (0 disables the guard). */
  audioRequestTimeoutMs: number;
  /** Proxy ceiling for one LLM completion (0 = no limit). */
  llmRequestTimeoutMs: number;
  /**
   * Root directory for user-uploaded reference voice audio (WAV), used as
   * `voice_ref` for voice-cloning/conversion models like Chatterbox. Mirrors
   * `inputsDir` (reference images for img2img) — uploaded once, then
   * referenced by name in a `/v1/audio/speech` request.
   */
  audioVoiceRefsDir: string;
}

function readJsonIfExists(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Failed to parse config file ${path}: ${(err as Error).message}`);
  }
}

function num(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error(`Expected numeric env value but got "${value}"`);
  return n;
}

function bool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;
  throw new Error(`Expected boolean env value but got "${value}"`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const configDir = resolve(process.cwd(), 'config');
  const fileConfig = configFileSchema.parse({
    ...readJsonIfExists(resolve(configDir, 'default.json')),
    ...readJsonIfExists(resolve(configDir, 'local.json')),
  });

  const envConfig = configFileSchema.parse({
    sd_binary_path: env.SD_BINARY_PATH,
    models_dir: env.SD_MODELS_DIR,
    outputs_dir: env.SD_OUTPUTS_DIR,
    inputs_dir: env.SD_INPUTS_DIR,
    host: env.SD_HOST,
    port: num(env.SD_PORT),
    max_concurrent_jobs: num(env.SD_MAX_CONCURRENT_JOBS),
    max_concurrent_downloads: num(env.SD_MAX_CONCURRENT_DOWNLOADS),
    job_timeout_ms: num(env.SD_JOB_TIMEOUT_MS),
    video_job_timeout_ms: num(env.SD_VIDEO_JOB_TIMEOUT_MS),
    max_image_dim: num(env.SD_MAX_IMAGE_DIM),
    log_level: env.SD_LOG_LEVEL,
    auto_install: bool(env.SD_AUTO_INSTALL),
    install_dir: env.SD_INSTALL_DIR,
    release_tag: env.SD_RELEASE_TAG,
    accel: env.SD_ACCEL,
    llm_binary_path: env.SD_LLM_BINARY_PATH,
    llm_auto_install: bool(env.SD_LLM_AUTO_INSTALL),
    llm_install_dir: env.SD_LLM_INSTALL_DIR,
    llm_release_tag: env.SD_LLM_RELEASE_TAG,
    llm_accel: env.SD_LLM_ACCEL,
    llm_models_dir: env.SD_LLM_MODELS_DIR,
    llm_port: num(env.SD_LLM_PORT),
    llm_ctx_size: num(env.SD_LLM_CTX_SIZE),
    llm_gpu_layers: num(env.SD_LLM_GPU_LAYERS),
    llm_jinja: bool(env.SD_LLM_JINJA),
    llm_startup_timeout_ms: num(env.SD_LLM_STARTUP_TIMEOUT_MS),
    llm_request_timeout_ms: num(env.SD_LLM_REQUEST_TIMEOUT_MS),
    audio_binary_path: env.SD_AUDIO_BINARY_PATH,
    audio_auto_install: bool(env.SD_AUDIO_AUTO_INSTALL),
    audio_install_dir: env.SD_AUDIO_INSTALL_DIR,
    audio_releases_repo: env.SD_AUDIO_RELEASES_REPO,
    audio_release_tag: env.SD_AUDIO_RELEASE_TAG,
    audio_accel: env.SD_AUDIO_ACCEL,
    audio_models_dir: env.SD_AUDIO_MODELS_DIR,
    audio_port: num(env.SD_AUDIO_PORT),
    audio_startup_timeout_ms: num(env.SD_AUDIO_STARTUP_TIMEOUT_MS),
    audio_request_timeout_ms: num(env.SD_AUDIO_REQUEST_TIMEOUT_MS),
    audio_voice_refs_dir: env.SD_AUDIO_VOICE_REFS_DIR,
  });

  const merged = { ...fileConfig, ...stripUndefined(envConfig) };

  const finalSchema = configFileSchema.required();
  const parsed = finalSchema.parse(merged);

  return {
    sdBinaryPath: parsed.sd_binary_path,
    modelsDir: resolve(process.cwd(), parsed.models_dir),
    outputsDir: resolve(process.cwd(), parsed.outputs_dir),
    inputsDir: resolve(process.cwd(), parsed.inputs_dir),
    host: parsed.host,
    port: parsed.port,
    maxConcurrentJobs: parsed.max_concurrent_jobs,
    maxConcurrentDownloads: parsed.max_concurrent_downloads,
    jobTimeoutMs: parsed.job_timeout_ms,
    videoJobTimeoutMs: parsed.video_job_timeout_ms,
    maxImageDim: parsed.max_image_dim,
    logLevel: parsed.log_level,
    autoInstall: parsed.auto_install,
    installDir: resolve(process.cwd(), parsed.install_dir),
    releaseTag: parsed.release_tag,
    accel: parsed.accel,
    llmBinaryPath: parsed.llm_binary_path,
    llmAutoInstall: parsed.llm_auto_install,
    llmInstallDir: resolve(process.cwd(), parsed.llm_install_dir),
    llmReleaseTag: parsed.llm_release_tag,
    llmAccel: parsed.llm_accel,
    llmModelsDir: resolve(process.cwd(), parsed.llm_models_dir),
    llmPort: parsed.llm_port,
    llmCtxSize: parsed.llm_ctx_size,
    llmGpuLayers: parsed.llm_gpu_layers,
    llmJinja: parsed.llm_jinja,
    llmStartupTimeoutMs: parsed.llm_startup_timeout_ms,
    llmRequestTimeoutMs: parsed.llm_request_timeout_ms,
    audioBinaryPath: parsed.audio_binary_path,
    audioAutoInstall: parsed.audio_auto_install,
    audioInstallDir: resolve(process.cwd(), parsed.audio_install_dir),
    audioReleasesRepo: parsed.audio_releases_repo,
    audioReleaseTag: parsed.audio_release_tag,
    audioAccel: parsed.audio_accel,
    audioModelsDir: resolve(process.cwd(), parsed.audio_models_dir),
    audioPort: parsed.audio_port,
    audioStartupTimeoutMs: parsed.audio_startup_timeout_ms,
    audioRequestTimeoutMs: parsed.audio_request_timeout_ms,
    audioVoiceRefsDir: resolve(process.cwd(), parsed.audio_voice_refs_dir),
  };
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
