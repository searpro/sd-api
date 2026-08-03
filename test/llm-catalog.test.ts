import { describe, it, expect, vi, afterEach } from 'vitest';
import { clearHfCache } from '../src/catalog/hf.js';
import { LlmCatalogManager } from '../src/llm-catalog/manager.js';

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

describe('LlmCatalogManager', () => {
  it('lists curated LLMs, all under 30B params', () => {
    const cat = new LlmCatalogManager(log);
    const models = cat.list();
    expect(models.length).toBeGreaterThan(10);
    for (const m of models) expect(m.params).toBeLessThan(30);

    const qwen = models.find((m) => m.id === 'qwen3-8b');
    expect(qwen).toBeTruthy();
    expect(qwen!.components.map((c) => c.role)).toEqual(['gguf']);

    const vision = models.find((m) => m.id === 'gemma-3-4b-it');
    expect(vision!.vision).toBe(true);
    expect(vision!.components.map((c) => c.role).sort()).toEqual(['gguf', 'mmproj']);
  });

  it('resolves GGUF quant files via the (stubbed) HF API', async () => {
    stubTree([
      { path: 'Qwen_Qwen3-8B-Q4_K_M.gguf', size: 100 },
      { path: 'Qwen_Qwen3-8B-IQ3_M.gguf', size: 80 },
      { path: 'README.md', size: 1 },
    ]);
    const cat = new LlmCatalogManager(log);
    const comps = await cat.files('qwen3-8b');
    const gguf = comps.find((c) => c.role === 'gguf');
    expect(gguf!.files.map((f) => f.quant).sort()).toEqual(['IQ3_M', 'Q4_K_M']);
    expect(gguf!.files[0].format).toBe('gguf');
  });

  it('splits weights from mmproj via the match filter for vision models', async () => {
    stubTree([
      { path: 'google_gemma-3-4b-it-Q4_K_M.gguf', size: 100 },
      { path: 'mmproj-google_gemma-3-4b-it-f16.gguf', size: 20 },
    ]);
    const cat = new LlmCatalogManager(log);
    const comps = await cat.files('gemma-3-4b-it');
    const gguf = comps.find((c) => c.role === 'gguf')!;
    const mmproj = comps.find((c) => c.role === 'mmproj')!;
    expect(gguf.files.map((f) => f.filename)).toEqual(['google_gemma-3-4b-it-Q4_K_M.gguf']);
    expect(mmproj.files.map((f) => f.filename)).toEqual(['mmproj-google_gemma-3-4b-it-f16.gguf']);
  });

  it('throws for an unknown model id', async () => {
    const cat = new LlmCatalogManager(log);
    await expect(cat.files('nonexistent-model')).rejects.toThrow();
  });
});
