import { readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { readAudioManifest, type AudioModelManifest } from '../audio-models/bundle.js';

export type { AudioModelManifest } from '../audio-models/bundle.js';

interface AudioServerModelEntry {
  id: string;
  family: string;
  path: string;
  task: string;
  mode: 'offline' | 'streaming';
  load_options?: Record<string, unknown>;
  session_options?: Record<string, unknown>;
  default_voice_preset?: unknown;
  voice_presets?: Record<string, unknown>;
  busy_timeout_ms?: number;
}

export interface AudioServerConfig {
  host: string;
  port: number;
  backend: 'cpu' | 'cuda' | 'vulkan' | 'metal';
  lazy_load: boolean;
  busy_timeout_ms: number;
  models: AudioServerModelEntry[];
}

/** Wraps the shared AudioModelManifest reader (audio-models/bundle.ts) with
 * warn-and-skip semantics — a missing/invalid manifest shouldn't fail the
 * whole server config, just leave that one model unregistered. */
async function readManifestOrSkip(
  dir: string,
  id: string,
  log: FastifyBaseLogger,
): Promise<AudioModelManifest | null> {
  let manifest: AudioModelManifest | null;
  try {
    manifest = await readAudioManifest(dir);
  } catch (err) {
    log.warn(
      { model: id, err: (err as Error).message },
      'invalid audio model.json — skipping server registration',
    );
    return null;
  }
  if (!manifest) {
    log.warn(
      { model: id },
      'audio model has no model.json manifest (family/task) — skipping server registration',
    );
  }
  return manifest;
}

/**
 * audiocpp_server's config documents "cuda"|"cpu"|"vulkan"|"metal" as the
 * only backend names. Our installer's accel enum also carries "rocm" (for
 * release-asset selection, shared with sd/llm), which isn't a recognized
 * server backend name yet — fall back to cpu rather than pass through a
 * value the binary will reject.
 */
function toServerBackend(accel: Config['audioAccel']): AudioServerConfig['backend'] {
  return accel === 'rocm' ? 'cpu' : accel;
}

/**
 * Scan audioModelsDir for bundles carrying a model.json manifest and build
 * the config object audiocpp_server loads via --config. Bundles without a
 * manifest are skipped (logged), not fatal — we have no way to infer
 * family/task from files alone, so an unregistered model simply isn't
 * servable until one is added.
 */
export async function buildAudioServerConfig(
  config: Config,
  log: FastifyBaseLogger,
): Promise<AudioServerConfig> {
  let dirents: { name: string; isDirectory: () => boolean }[];
  try {
    dirents = await readdir(config.audioModelsDir, { withFileTypes: true });
  } catch {
    dirents = [];
  }

  const models: AudioServerModelEntry[] = [];
  for (const d of dirents) {
    if (d.name.startsWith('.') || !d.isDirectory()) continue;
    const dir = join(config.audioModelsDir, d.name);
    const manifest = await readManifestOrSkip(dir, d.name, log);
    if (!manifest) continue;
    models.push({
      id: d.name,
      family: manifest.family,
      path: dir,
      task: manifest.task,
      mode: manifest.mode ?? 'offline',
      ...(manifest.loadOptions ? { load_options: manifest.loadOptions } : {}),
      ...(manifest.sessionOptions ? { session_options: manifest.sessionOptions } : {}),
      ...(manifest.defaultVoicePreset !== undefined
        ? { default_voice_preset: manifest.defaultVoicePreset }
        : {}),
      ...(manifest.voicePresets ? { voice_presets: manifest.voicePresets } : {}),
      ...(manifest.busyTimeoutMs !== undefined ? { busy_timeout_ms: manifest.busyTimeoutMs } : {}),
    });
  }

  return {
    host: '127.0.0.1',
    port: config.audioPort,
    backend: toServerBackend(config.audioAccel),
    // Register every configured model at startup but defer each one's actual
    // framework load/session creation until its first request — installing
    // many models shouldn't mean loading them all into memory at boot.
    lazy_load: true,
    busy_timeout_ms: config.audioRequestTimeoutMs,
    models,
  };
}

/** Path the generated server config is written to before each (re)start. */
export function audioServerConfigPath(config: Config): string {
  return resolve(dirname(config.audioModelsDir), 'audio-server-config.generated.json');
}

/**
 * Write the current server config to disk, creating parent dirs as needed.
 * Called before every spawn/restart so newly-installed models (and their
 * manifests) become servable without a manual process restart.
 */
export async function writeAudioServerConfig(
  config: Config,
  log: FastifyBaseLogger,
): Promise<string> {
  const path = audioServerConfigPath(config);
  const serverConfig = await buildAudioServerConfig(config, log);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(serverConfig, null, 2), 'utf8');
  log.info(
    { path, models: serverConfig.models.map((m) => m.id) },
    'wrote audiocpp_server config',
  );
  return path;
}
