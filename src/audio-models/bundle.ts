import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSafeName, safeResolve } from '../util/paths.js';
import { errors } from '../errors.js';

/**
 * Per-model layout for audio serving, flat like the LLM side (no
 * checkpoint/vae/clip split) — audiocpp_server's model registry points a
 * `path` directly at this directory:
 *
 *   <audioModelsDir>/
 *     pocket-tts/
 *       model.json          (required — family/task; see src/audio/config-gen.ts)
 *       pocket-tts-english-q8_0.gguf
 *
 * Unlike LLM bundles (where model.json is an optional display-name-only
 * sidecar), it's required here: audiocpp_server needs `family`/`task` to
 * pick the right loading code, and neither can be inferred from files alone.
 */

export type AudioComponentType = 'weights' | 'aux';

export interface AudioModelManifest {
  /** Friendly display name. */
  name?: string;
  /** Which audio.cpp family's loading code to use (e.g. "pocket_tts", "qwen3_asr"). */
  family: string;
  /** e.g. "tts", "asr". */
  task: string;
  mode?: 'offline' | 'streaming';
  loadOptions?: Record<string, unknown>;
  sessionOptions?: Record<string, unknown>;
  defaultVoicePreset?: unknown;
  voicePresets?: Record<string, unknown>;
  busyTimeoutMs?: number;
}

export interface AudioComponentFile {
  name: string;
  size: number;
}

export interface AudioPartialFile {
  type: AudioComponentType;
  /** Final filename (without the .part suffix). */
  name: string;
  received: number;
  total: number | null;
}

export interface AudioBundleInfo {
  id: string;
  name: string;
  /** null until a valid model.json is written — the bundle isn't servable without one. */
  family: string | null;
  task: string | null;
  files: AudioComponentFile[];
  size: number;
  modified: string;
  /** Has a manifest (family/task) and at least one real file. */
  ready: boolean;
  partials: AudioPartialFile[];
}

const RESERVED_FILES = new Set(['model.json']);

export async function readAudioManifest(dir: string): Promise<AudioModelManifest | null> {
  try {
    const raw = await readFile(join(dir, 'model.json'), 'utf8');
    return JSON.parse(raw) as AudioModelManifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw errors.invalidModel(`Invalid model.json in audio bundle: ${(err as Error).message}`);
  }
}

/**
 * Every real file in the bundle except model.json itself and in-progress
 * `.part` downloads — audio.cpp model families vary widely in what they
 * need alongside the weights (tokenizer/vocoder/speaker-embedding files),
 * so unlike the LLM side there's no single "the weights file" to pick out.
 */
async function listFiles(dir: string): Promise<AudioComponentFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: AudioComponentFile[] = [];
  for (const name of entries) {
    if (RESERVED_FILES.has(name)) continue;
    if (name.endsWith('.part') || name.endsWith('.part.json')) continue;
    try {
      const s = await stat(join(dir, name));
      if (s.isFile()) out.push({ name, size: s.size });
    } catch {
      // skip
    }
  }
  return out;
}

async function listPartials(dir: string): Promise<AudioPartialFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: AudioPartialFile[] = [];
  for (const name of entries) {
    if (!name.endsWith('.part')) continue;
    try {
      const s = await stat(join(dir, name));
      if (!s.isFile()) continue;
      let total: number | null = null;
      let type: AudioComponentType = 'weights';
      try {
        const meta = JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8'));
        if (typeof meta.total === 'number') total = meta.total;
        if (meta.type === 'weights' || meta.type === 'aux') type = meta.type;
      } catch {
        // no sidecar — best-effort defaults above
      }
      out.push({ type, name: name.slice(0, -'.part'.length), received: s.size, total });
    } catch {
      // skip
    }
  }
  return out;
}

/** Inspect an audio bundle directory. Does not throw on a missing manifest (`ready: false` instead). */
export async function inspectAudioBundle(audioModelsDir: string, id: string): Promise<AudioBundleInfo> {
  assertSafeName(id);
  const dir = safeResolve(audioModelsDir, id);
  const manifest = await readAudioManifest(dir);
  const files = await listFiles(dir);
  const partials = await listPartials(dir);
  const size = files.reduce((a, f) => a + f.size, 0);

  let modified = new Date(0).toISOString();
  try {
    modified = (await stat(dir)).mtime.toISOString();
  } catch {
    /* ignore */
  }

  return {
    id,
    name: manifest?.name ?? id,
    family: manifest?.family ?? null,
    task: manifest?.task ?? null,
    files,
    size,
    modified,
    ready: manifest !== null && files.length > 0,
    partials,
  };
}
