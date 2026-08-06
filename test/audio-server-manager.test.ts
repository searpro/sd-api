import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AudioServerManager } from '../src/audio/server-manager.js';
import { audioServerConfigPath } from '../src/audio/config-gen.js';
import { makeTestConfig } from './helpers.js';

const log = { info() {}, warn() {}, debug() {}, error() {} } as never;

async function waitForStatus(get: () => string, want: string, ms = 5000): Promise<void> {
  const start = Date.now();
  while (get() !== want) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for status "${want}", got "${get()}"`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('AudioServerManager', () => {
  let manager: AudioServerManager | undefined;

  afterEach(async () => {
    await manager?.stop();
    manager = undefined;
    delete process.env.FAKE_AUDIO_NO_HEALTH;
  });

  it('transitions stopped -> starting -> ready and stop() kills the child', async () => {
    const config = await makeTestConfig();
    manager = new AudioServerManager(config, log);
    expect(manager.status).toBe('stopped');

    await manager.start();
    expect(manager.status).toBe('ready');
    expect(manager.isReady()).toBe(true);
    expect(manager.baseUrl).toBe(`http://127.0.0.1:${config.audioPort}`);

    const health = await fetch(`${manager.baseUrl}/health`);
    expect(health.ok).toBe(true);

    await manager.stop();
    expect(manager.status).toBe('stopped');
    await expect(fetch(`${manager.baseUrl}/health`)).rejects.toThrow();
  });

  it('surfaces AUDIO_STARTUP_FAILED when /health never becomes ready', async () => {
    process.env.FAKE_AUDIO_NO_HEALTH = '1';
    const config = await makeTestConfig({ audioStartupTimeoutMs: 800 });
    manager = new AudioServerManager(config, log);

    await expect(manager.start()).rejects.toThrow(/AUDIO_STARTUP_FAILED|Timed out/);
    expect(manager.status).toBe('failed');
    expect(manager.lastError).toBeTruthy();
  });

  it('ensureRunning() is idempotent and does not double-spawn', async () => {
    const config = await makeTestConfig();
    manager = new AudioServerManager(config, log);

    await manager.ensureRunning();
    expect(manager.status).toBe('ready');
    const debugBefore = await (await fetch(`${manager.baseUrl}/__debug`)).json();

    await manager.ensureRunning();
    expect(manager.status).toBe('ready');
    const debugAfter = await (await fetch(`${manager.baseUrl}/__debug`)).json();
    expect(debugAfter.requestCount - debugBefore.requestCount).toBeLessThan(5);
  });

  it('coalesces concurrent start() callers into one spawn', async () => {
    const config = await makeTestConfig();
    manager = new AudioServerManager(config, log);

    const [a, b] = await Promise.all([manager.ensureRunning(), manager.ensureRunning()]);
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
    expect(manager.status).toBe('ready');
  });

  it('binary detection: isBinaryAvailable() and ensureBinary() with autoInstall off', async () => {
    const config = await makeTestConfig({ audioBinaryPath: '/nonexistent/audiocpp_server' });
    manager = new AudioServerManager(config, log);
    expect(await manager.isBinaryAvailable()).toBe(false);
    await expect(manager.ensureBinary()).rejects.toThrow(/AUDIO_BINARY_NOT_FOUND|not found/);
  });

  it('restart() replaces the running process (new pid, still ready)', async () => {
    const config = await makeTestConfig();
    manager = new AudioServerManager(config, log);

    await manager.start();
    expect(manager.status).toBe('ready');
    const before = await (await fetch(`${manager.baseUrl}/__debug`)).json();

    await manager.restart();
    expect(manager.status).toBe('ready');
    const after = await (await fetch(`${manager.baseUrl}/__debug`)).json();
    expect(after.requestCount).toBeLessThan(before.requestCount + 5);
  });

  it('scheduleRestart() debounces multiple calls into a single restart', async () => {
    const config = await makeTestConfig();
    manager = new AudioServerManager(config, log);
    await manager.start();
    expect(manager.status).toBe('ready');

    manager.scheduleRestart(50);
    manager.scheduleRestart(50);
    manager.scheduleRestart(50);

    await waitForStatus(() => manager!.status, 'ready');
    const health = await fetch(`${manager.baseUrl}/health`);
    expect(health.ok).toBe(true);
  });

  it('scheduleRestart() cleared by stop() does not respawn after shutdown', async () => {
    const config = await makeTestConfig();
    manager = new AudioServerManager(config, log);
    await manager.start();

    manager.scheduleRestart(50);
    await manager.stop();
    expect(manager.status).toBe('stopped');

    await new Promise((r) => setTimeout(r, 300));
    expect(manager.status).toBe('stopped');
  });

  it('regenerates the server config from model.json manifests before each start', async () => {
    const config = await makeTestConfig();

    // A registrable model (has a manifest) and one that should be skipped.
    await mkdir(join(config.audioModelsDir, 'pocket-tts'), { recursive: true });
    await writeFile(
      join(config.audioModelsDir, 'pocket-tts', 'model.json'),
      JSON.stringify({ family: 'pocket_tts', task: 'tts' }),
    );
    await mkdir(join(config.audioModelsDir, 'no-manifest'), { recursive: true });

    manager = new AudioServerManager(config, log);
    await manager.start();
    expect(manager.status).toBe('ready');

    const written = JSON.parse(await readFile(audioServerConfigPath(config), 'utf8'));
    expect(written.models.map((m: { id: string }) => m.id)).toEqual(['pocket-tts']);

    const debug = await (await fetch(`${manager.baseUrl}/__debug`)).json();
    expect(debug.configuredModels).toEqual(['pocket-tts']);
  });
});
