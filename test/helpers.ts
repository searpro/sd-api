import { mkdtemp, mkdir, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../src/config.js';

const here = fileURLToPath(new URL('.', import.meta.url));
export const FAKE_SD = resolve(here, 'fixtures/fake-sd.mjs');
export const FAKE_LLAMA_SERVER = resolve(here, 'fixtures/fake-llama-server.mjs');
export const FAKE_AUDIO_SERVER = resolve(here, 'fixtures/fake-audio-server.mjs');

/** Wrapper script so the fake binary is executed via node and is chmod +x. */
export async function makeFakeBinary(dir: string): Promise<string> {
  const path = join(dir, 'sd');
  await writeFile(path, `#!/bin/sh\nexec node "${FAKE_SD}" "$@"\n`);
  await chmod(path, 0o755);
  return path;
}

/** Wrapper script so the fake long-running llama-server is spawnable like a real binary. */
export async function makeFakeLlamaBinary(dir: string): Promise<string> {
  const path = join(dir, 'llama-server');
  await writeFile(path, `#!/bin/sh\nexec node "${FAKE_LLAMA_SERVER}" "$@"\n`);
  await chmod(path, 0o755);
  return path;
}

/** Wrapper script so the fake long-running audiocpp_server is spawnable like a real binary. */
export async function makeFakeAudioBinary(dir: string): Promise<string> {
  const path = join(dir, 'audiocpp_server');
  await writeFile(path, `#!/bin/sh\nexec node "${FAKE_AUDIO_SERVER}" "$@"\n`);
  await chmod(path, 0o755);
  return path;
}

export async function makeTestConfig(overrides: Partial<Config> = {}): Promise<Config> {
  const root = await mkdtemp(join(tmpdir(), 'sd-api-test-'));
  const modelsDir = join(root, 'models');
  const outputsDir = join(root, 'outputs');
  const inputsDir = join(root, 'inputs');
  await mkdir(outputsDir, { recursive: true });
  await mkdir(inputsDir, { recursive: true });

  // Seed a split bundle "test" with checkpoint + vae + clip(llm) components.
  await mkdir(join(modelsDir, 'test', 'checkpoint'), { recursive: true });
  await mkdir(join(modelsDir, 'test', 'vae'), { recursive: true });
  await mkdir(join(modelsDir, 'test', 'clip'), { recursive: true });
  await writeFile(join(modelsDir, 'test', 'checkpoint', 'diffusion.gguf'), 'dummy');
  await writeFile(join(modelsDir, 'test', 'vae', 'vae.safetensors'), 'dummy');
  await writeFile(join(modelsDir, 'test', 'clip', 'qwen3-4b.gguf'), 'dummy');
  // Also a single-file full model.
  await writeFile(join(modelsDir, 'full.gguf'), 'dummy');

  const sdBinaryPath = await makeFakeBinary(root);
  const llmModelsDir = join(root, 'llm-models');
  await mkdir(llmModelsDir, { recursive: true });
  const llmBinaryPath = await makeFakeLlamaBinary(root);
  const audioModelsDir = join(root, 'audio-models');
  await mkdir(audioModelsDir, { recursive: true });
  const audioBinaryPath = await makeFakeAudioBinary(root);

  return {
    sdBinaryPath,
    modelsDir,
    outputsDir,
    inputsDir,
    host: '127.0.0.1',
    port: 0,
    maxConcurrentJobs: 2,
    maxConcurrentDownloads: 2,
    jobTimeoutMs: 10000,
    maxImageDim: 2048,
    logLevel: 'fatal',
    autoInstall: false,
    installDir: join(root, 'bin'),
    releaseTag: 'latest',
    accel: 'cpu',
    llmBinaryPath,
    llmAutoInstall: false,
    llmInstallDir: join(root, 'llm-bin'),
    llmReleaseTag: 'latest',
    llmAccel: 'cpu',
    llmModelsDir,
    // Randomized to reduce collision risk between concurrently-run test files
    // (llama-server, unlike Fastify, doesn't support port:0 for auto-assign).
    llmPort: 20000 + Math.floor(Math.random() * 20000),
    llmCtxSize: 512,
    llmGpuLayers: -1,
    llmJinja: true,
    llmStartupTimeoutMs: 5000,
    audioBinaryPath,
    audioAutoInstall: false,
    audioInstallDir: join(root, 'audio-bin'),
    audioReleasesRepo: '0xShug0/audio.cpp',
    audioReleaseTag: 'latest',
    audioAccel: 'cpu',
    audioModelsDir,
    // Randomized for the same reason as llmPort (no port:0 auto-assign support);
    // offset into a disjoint range so the two can never collide with each other.
    audioPort: 40000 + Math.floor(Math.random() * 20000),
    audioStartupTimeoutMs: 5000,
    audioRequestTimeoutMs: 300000,
    ...overrides,
  };
}
