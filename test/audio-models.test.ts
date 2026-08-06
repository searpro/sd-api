import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectAudioBundle } from '../src/audio-models/bundle.js';
import { AudioModelManager } from '../src/audio-models/manager.js';
import { makeTestConfig } from './helpers.js';

const log = { info() {}, warn() {}, debug() {}, error() {} } as never;

describe('inspectAudioBundle', () => {
  let audioModelsDir: string;

  beforeAll(async () => {
    audioModelsDir = await mkdtemp(join(tmpdir(), 'audio-bundle-test-'));

    await mkdir(join(audioModelsDir, 'pocket-tts'), { recursive: true });
    await writeFile(
      join(audioModelsDir, 'pocket-tts', 'model.json'),
      JSON.stringify({ family: 'pocket_tts', task: 'tts' }),
    );
    await writeFile(join(audioModelsDir, 'pocket-tts', 'pocket-tts-english-q8_0.gguf'), 'x');

    await mkdir(join(audioModelsDir, 'no-manifest'), { recursive: true });
    await writeFile(join(audioModelsDir, 'no-manifest', 'weights.gguf'), 'x');

    await mkdir(join(audioModelsDir, 'empty'), { recursive: true });
  });

  it('reports ready + family/task for a registered bundle', async () => {
    const info = await inspectAudioBundle(audioModelsDir, 'pocket-tts');
    expect(info.ready).toBe(true);
    expect(info.family).toBe('pocket_tts');
    expect(info.task).toBe('tts');
    expect(info.files.map((f) => f.name)).toEqual(['pocket-tts-english-q8_0.gguf']);
  });

  it('reports not-ready for a bundle with files but no manifest', async () => {
    const info = await inspectAudioBundle(audioModelsDir, 'no-manifest');
    expect(info.ready).toBe(false);
    expect(info.family).toBeNull();
    expect(info.files.map((f) => f.name)).toEqual(['weights.gguf']);
  });

  it('reports not-ready for an empty bundle', async () => {
    const info = await inspectAudioBundle(audioModelsDir, 'empty');
    expect(info.ready).toBe(false);
    expect(info.files).toEqual([]);
  });

  it('never lists model.json itself as a component file', async () => {
    const info = await inspectAudioBundle(audioModelsDir, 'pocket-tts');
    expect(info.files.some((f) => f.name === 'model.json')).toBe(false);
  });
});

describe('AudioModelManager', () => {
  it('lists, creates, resolves paths for, and deletes bundles', async () => {
    const config = await makeTestConfig();
    const manager = new AudioModelManager(config, log);
    await manager.init();

    expect(await manager.list()).toEqual([]);

    await manager.createBundle('qwen3-asr');
    await manager.writeManifest('qwen3-asr', { family: 'qwen3_asr', task: 'asr' });
    const paths = await manager.resolveComponentPaths('qwen3-asr', 'weights', 'qwen3-asr-0.6b-q8_0.gguf');
    await writeFile(paths.finalPath, 'weights');

    const bundle = await manager.get('qwen3-asr');
    expect(bundle?.ready).toBe(true);
    expect(bundle?.family).toBe('qwen3_asr');
    expect(bundle?.files.map((f) => f.name)).toEqual(['qwen3-asr-0.6b-q8_0.gguf']);

    const list = await manager.list();
    expect(list.map((m) => m.id)).toContain('qwen3-asr');

    await manager.deleteComponent('qwen3-asr', 'weights', 'qwen3-asr-0.6b-q8_0.gguf');
    expect((await manager.get('qwen3-asr'))?.ready).toBe(false);

    await manager.deleteModel('qwen3-asr');
    expect(await manager.get('qwen3-asr')).toBeNull();
  });

  it('writeManifest rejects a manifest missing family or task', async () => {
    const config = await makeTestConfig();
    const manager = new AudioModelManager(config, log);
    await expect(manager.writeManifest('x', { family: 'pocket_tts' } as never)).rejects.toThrow();
    await expect(manager.writeManifest('x', { task: 'tts' } as never)).rejects.toThrow();
  });

  it('fileNameFor rejects unsupported extensions and the reserved "model.json" name', async () => {
    const config = await makeTestConfig();
    const manager = new AudioModelManager(config, log);
    expect(manager.fileNameFor('https://example.com/weights.gguf')).toBe('weights.gguf');
    expect(manager.fileNameFor('https://example.com/tokenizer.json')).toBe('tokenizer.json');
    expect(() => manager.fileNameFor('https://example.com/archive.zip')).toThrow();
    expect(() => manager.fileNameFor('https://example.com/x.gguf', 'model.json')).toThrow();
  });

  it('rejects unsafe model/file names via assertSafeName', async () => {
    const config = await makeTestConfig();
    const manager = new AudioModelManager(config, log);
    await expect(manager.get('../escape')).rejects.toThrow();
  });
});
