import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMmproj, inspectLlmBundle } from '../src/llm-models/bundle.js';
import { LlmModelManager } from '../src/llm-models/manager.js';
import { makeTestConfig } from './helpers.js';

const log = { info() {}, warn() {}, debug() {}, error() {} } as never;

describe('isMmproj', () => {
  it('recognizes mmproj-prefixed filenames case-insensitively', () => {
    expect(isMmproj('mmproj-f16.gguf')).toBe(true);
    expect(isMmproj('MMPROJ-google_gemma-3-4b-it-bf16.gguf')).toBe(true);
    expect(isMmproj('qwen3-8b-Q4_K_M.gguf')).toBe(false);
  });
});

describe('inspectLlmBundle', () => {
  let llmModelsDir: string;

  beforeAll(async () => {
    llmModelsDir = await mkdtemp(join(tmpdir(), 'llm-bundle-test-'));
    await mkdir(join(llmModelsDir, 'qwen3-8b'), { recursive: true });
    await writeFile(join(llmModelsDir, 'qwen3-8b', 'Qwen_Qwen3-8B-Q4_K_M.gguf'), 'x');

    await mkdir(join(llmModelsDir, 'gemma-3-4b-it'), { recursive: true });
    await writeFile(join(llmModelsDir, 'gemma-3-4b-it', 'google_gemma-3-4b-it-Q4_K_M.gguf'), 'x');
    await writeFile(join(llmModelsDir, 'gemma-3-4b-it', 'mmproj-google_gemma-3-4b-it-f16.gguf'), 'xx');

    await mkdir(join(llmModelsDir, 'empty'), { recursive: true });
  });

  it('reports weights and readiness for a text-only model', async () => {
    const info = await inspectLlmBundle(llmModelsDir, 'qwen3-8b');
    expect(info.ready).toBe(true);
    expect(info.weights?.name).toBe('Qwen_Qwen3-8B-Q4_K_M.gguf');
    expect(info.mmproj).toBeNull();
  });

  it('separates weights from the mmproj vision projector', async () => {
    const info = await inspectLlmBundle(llmModelsDir, 'gemma-3-4b-it');
    expect(info.ready).toBe(true);
    expect(info.weights?.name).toBe('google_gemma-3-4b-it-Q4_K_M.gguf');
    expect(info.mmproj?.name).toBe('mmproj-google_gemma-3-4b-it-f16.gguf');
  });

  it('reports not-ready for an empty bundle', async () => {
    const info = await inspectLlmBundle(llmModelsDir, 'empty');
    expect(info.ready).toBe(false);
    expect(info.weights).toBeNull();
  });

  it('applies the display name from model.json', async () => {
    await writeFile(join(llmModelsDir, 'qwen3-8b', 'model.json'), JSON.stringify({ name: 'Qwen3 8B' }));
    const info = await inspectLlmBundle(llmModelsDir, 'qwen3-8b');
    expect(info.name).toBe('Qwen3 8B');
  });
});

describe('LlmModelManager', () => {
  it('lists, creates, resolves paths for, and deletes bundles', async () => {
    const config = await makeTestConfig();
    const manager = new LlmModelManager(config, log);
    await manager.init();

    expect(await manager.list()).toEqual([]);

    await manager.createBundle('smollm2-1.7b');
    const paths = await manager.resolveComponentPaths('smollm2-1.7b', 'gguf', 'SmolLM2-1.7B-Instruct-Q4_K_M.gguf');
    await writeFile(paths.finalPath, 'weights');

    const bundle = await manager.get('smollm2-1.7b');
    expect(bundle?.ready).toBe(true);
    expect(bundle?.weights?.name).toBe('SmolLM2-1.7B-Instruct-Q4_K_M.gguf');

    const list = await manager.list();
    expect(list.map((m) => m.id)).toContain('smollm2-1.7b');

    await manager.deleteComponent('smollm2-1.7b', 'gguf', 'SmolLM2-1.7B-Instruct-Q4_K_M.gguf');
    expect((await manager.get('smollm2-1.7b'))?.ready).toBe(false);

    await manager.deleteModel('smollm2-1.7b');
    expect(await manager.get('smollm2-1.7b')).toBeNull();
  });

  it('fileNameFor rejects non-.gguf extensions', async () => {
    const config = await makeTestConfig();
    const manager = new LlmModelManager(config, log);
    expect(manager.fileNameFor('https://example.com/model.gguf')).toBe('model.gguf');
    expect(() => manager.fileNameFor('https://example.com/model.safetensors')).toThrow();
  });

  it('rejects unsafe model/file names via assertSafeName', async () => {
    const config = await makeTestConfig();
    const manager = new LlmModelManager(config, log);
    await expect(manager.get('../escape')).rejects.toThrow();
  });
});
