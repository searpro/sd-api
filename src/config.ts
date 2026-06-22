import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Configuration system (Phase 7).
 *
 * Resolution order (later wins):
 *   1. config/default.json
 *   2. config/local.json (optional, git-ignored)
 *   3. Environment variables (SD_* prefix)
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
    max_image_dim: z.number().int().positive(),
    log_level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
    auto_install: z.boolean(),
    install_dir: z.string(),
    release_tag: z.string(),
    accel: z.enum(['cpu', 'vulkan', 'cuda', 'rocm']),
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
    max_image_dim: num(env.SD_MAX_IMAGE_DIM),
    log_level: env.SD_LOG_LEVEL,
    auto_install: bool(env.SD_AUTO_INSTALL),
    install_dir: env.SD_INSTALL_DIR,
    release_tag: env.SD_RELEASE_TAG,
    accel: env.SD_ACCEL,
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
    maxImageDim: parsed.max_image_dim,
    logLevel: parsed.log_level,
    autoInstall: parsed.auto_install,
    installDir: resolve(process.cwd(), parsed.install_dir),
    releaseTag: parsed.release_tag,
    accel: parsed.accel,
  };
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
