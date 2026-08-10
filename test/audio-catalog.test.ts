import { describe, it, expect, vi, afterEach } from 'vitest';
import { clearHfCache } from '../src/catalog/hf.js';
import { AudioCatalogManager } from '../src/audio-catalog/manager.js';

const log = { info() {}, warn() {}, debug() {}, error() {} } as never;

afterEach(() => {
  vi.unstubAllGlobals();
  clearHfCache();
});

function stubTree(entries: { path: string; size: number }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: async () => entries.map((e) => ({ type: 'file', path: e.path, size: e.size })),
    })),
  );
}

describe('AudioCatalogManager', () => {
  it('lists curated audio.cpp models with family/task metadata', () => {
    const cat = new AudioCatalogManager(log);
    const models = cat.list();
    expect(models.length).toBeGreaterThanOrEqual(4);

    const tts = models.find((m) => m.id === 'pocket-tts');
    expect(tts).toBeTruthy();
    expect(tts!.family).toBe('pocket_tts');
    expect(tts!.task).toBe('tts');
    expect(tts!.components.map((c) => c.role)).toEqual(['weights']);

    const asr = models.find((m) => m.id === 'qwen3-asr');
    expect(asr!.family).toBe('qwen3_asr');
    expect(asr!.task).toBe('asr');
  });

  it('has the 5 new voice-design/expressive/timestamp entries with correct family+task', () => {
    const cat = new AudioCatalogManager(log);
    const models = cat.list();
    const byId = Object.fromEntries(models.map((m) => [m.id, m]));

    // task uses the real audiocpp_cli task enum (vdes, not "design" — the
    // model's own doc metadata uses the friendlier name, but the CLI/server
    // task field does not, confirmed via `audiocpp_cli --help`).
    expect(byId['qwen3-tts-voicedesign']).toMatchObject({ family: 'qwen3_tts', task: 'vdes' });
    expect(byId['qwen3-tts-customvoice']).toMatchObject({ family: 'qwen3_tts', task: 'tts' });
    expect(byId['omnivoice']).toMatchObject({ family: 'omnivoice', task: 'tts' });
    expect(byId['dramabox']).toMatchObject({ family: 'dramabox', task: 'tts' });
    expect(byId['parakeet-tdt']).toMatchObject({ family: 'parakeet_tdt', task: 'asr' });

    for (const id of ['qwen3-tts-voicedesign', 'qwen3-tts-customvoice', 'omnivoice', 'dramabox', 'parakeet-tdt']) {
      expect(byId[id].components.map((c) => c.role)).toEqual(['weights']);
    }
  });

  it('resolves quant files via the (stubbed) HF API', async () => {
    stubTree([
      { path: 'PocketTTS-GGUF/english/pocket-tts-english-bf16.gguf', size: 200 },
      { path: 'PocketTTS-GGUF/english/pocket-tts-english-q8_0.gguf', size: 100 },
      { path: 'README.md', size: 1 },
    ]);
    const cat = new AudioCatalogManager(log);
    const comps = await cat.files('pocket-tts');
    const weights = comps.find((c) => c.role === 'weights');
    expect(weights!.files.map((f) => f.quant).sort()).toEqual(['BF16', 'Q8_0']);
    expect(weights!.files[0].format).toBe('gguf');
  });

  it('throws for an unknown model id', async () => {
    const cat = new AudioCatalogManager(log);
    await expect(cat.files('nonexistent-model')).rejects.toThrow();
  });

  it('excludes shard-split files ("-00001-of-00003.gguf") defensively', async () => {
    stubTree([
      { path: 'chatterbox-q8_0.gguf', size: 100 },
      { path: 'chatterbox-q8_0-00001-of-00003.gguf', size: 50 },
      { path: 'chatterbox-q8_0-00002-of-00003.gguf', size: 50 },
    ]);
    const cat = new AudioCatalogManager(log);
    const comps = await cat.files('chatterbox');
    const weights = comps.find((c) => c.role === 'weights')!;
    expect(weights.files.map((f) => f.filename)).toEqual(['chatterbox-q8_0.gguf']);
  });

  it('reports a per-component error instead of throwing when the HF request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found', headers: { get: () => null } })),
    );
    const cat = new AudioCatalogManager(log);
    const comps = await cat.files('qwen3-tts');
    expect(comps[0].files).toEqual([]);
    expect(comps[0].error).toBeTruthy();
  });
});
