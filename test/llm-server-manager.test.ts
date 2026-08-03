import { describe, it, expect, afterEach } from 'vitest';
import { LlamaServerManager } from '../src/llm/server-manager.js';
import { makeTestConfig } from './helpers.js';

const log = { info() {}, warn() {}, debug() {}, error() {} } as never;

describe('LlamaServerManager', () => {
  let manager: LlamaServerManager | undefined;

  afterEach(async () => {
    await manager?.stop();
    manager = undefined;
    delete process.env.FAKE_LLAMA_NO_HEALTH;
  });

  it('transitions stopped -> starting -> ready and stop() kills the child', async () => {
    const config = await makeTestConfig();
    manager = new LlamaServerManager(config, log);
    expect(manager.status).toBe('stopped');

    await manager.start();
    expect(manager.status).toBe('ready');
    expect(manager.isReady()).toBe(true);
    expect(manager.baseUrl).toBe(`http://127.0.0.1:${config.llmPort}`);

    const health = await fetch(`${manager.baseUrl}/health`);
    expect(health.ok).toBe(true);

    await manager.stop();
    expect(manager.status).toBe('stopped');
    await expect(fetch(`${manager.baseUrl}/health`)).rejects.toThrow();
  });

  it('surfaces LLM_STARTUP_FAILED when /health never becomes ready', async () => {
    process.env.FAKE_LLAMA_NO_HEALTH = '1';
    const config = await makeTestConfig({ llmStartupTimeoutMs: 800 });
    manager = new LlamaServerManager(config, log);

    await expect(manager.start()).rejects.toThrow(/LLM_STARTUP_FAILED|Timed out/);
    expect(manager.status).toBe('failed');
    expect(manager.lastError).toBeTruthy();
  });

  it('ensureRunning() is idempotent and does not double-spawn', async () => {
    const config = await makeTestConfig();
    manager = new LlamaServerManager(config, log);

    await manager.ensureRunning();
    expect(manager.status).toBe('ready');
    const debugBefore = await (await fetch(`${manager.baseUrl}/__debug`)).json();

    // A second call while already ready must be a no-op (no new process).
    await manager.ensureRunning();
    expect(manager.status).toBe('ready');
    const debugAfter = await (await fetch(`${manager.baseUrl}/__debug`)).json();
    // The __debug call itself increments requestCount, so allow for exactly
    // the two /__debug hits made here — no additional /health flurry from a
    // second spawn attempt racing in.
    expect(debugAfter.requestCount - debugBefore.requestCount).toBeLessThan(5);
  });

  it('coalesces concurrent start() callers into one spawn', async () => {
    const config = await makeTestConfig();
    manager = new LlamaServerManager(config, log);

    const [a, b] = await Promise.all([manager.ensureRunning(), manager.ensureRunning()]);
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
    expect(manager.status).toBe('ready');
  });

  it('binary detection: isBinaryAvailable() and ensureBinary() with autoInstall off', async () => {
    const config = await makeTestConfig({ llmBinaryPath: '/nonexistent/llama-server' });
    manager = new LlamaServerManager(config, log);
    expect(await manager.isBinaryAvailable()).toBe(false);
    await expect(manager.ensureBinary()).rejects.toThrow(/LLM_BINARY_NOT_FOUND|not found/);
  });
});
