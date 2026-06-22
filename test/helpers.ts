import { mkdtemp, mkdir, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../src/config.js';

const here = fileURLToPath(new URL('.', import.meta.url));
export const FAKE_SD = resolve(here, 'fixtures/fake-sd.mjs');

/** Wrapper script so the fake binary is executed via node and is chmod +x. */
export async function makeFakeBinary(dir: string): Promise<string> {
  const path = join(dir, 'sd');
  await writeFile(path, `#!/bin/sh\nexec node "${FAKE_SD}" "$@"\n`);
  await chmod(path, 0o755);
  return path;
}

export async function makeTestConfig(overrides: Partial<Config> = {}): Promise<Config> {
  const root = await mkdtemp(join(tmpdir(), 'sd-api-test-'));
  const modelsDir = join(root, 'models');
  const outputsDir = join(root, 'outputs');
  await mkdir(join(modelsDir, 'checkpoints'), { recursive: true });
  await mkdir(join(modelsDir, 'vae'), { recursive: true });
  await mkdir(join(modelsDir, 'clip'), { recursive: true });
  await mkdir(outputsDir, { recursive: true });
  // A dummy checkpoint file the wrapper can resolve.
  await writeFile(join(modelsDir, 'checkpoints', 'test.gguf'), 'dummy');

  const sdBinaryPath = await makeFakeBinary(root);

  return {
    sdBinaryPath,
    modelsDir,
    outputsDir,
    host: '127.0.0.1',
    port: 0,
    maxConcurrentJobs: 2,
    jobTimeoutMs: 10000,
    maxImageDim: 2048,
    logLevel: 'fatal',
    ...overrides,
  };
}
