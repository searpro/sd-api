import { describe, it, expect } from 'vitest';
import { SdWrapper } from '../src/sd/wrapper.js';
import { makeTestConfig } from './helpers.js';

const log = { info() {}, warn() {}, debug() {}, error() {} } as never;

describe('SdWrapper.killAll', () => {
  it('kills an in-flight sd-cli process instead of leaving it orphaned', async () => {
    const config = await makeTestConfig();
    const wrapper = new SdWrapper(config, log);

    process.env.FAKE_SD_SLEEP_MS = '5000';
    try {
      const generation = wrapper.generate({ params: { prompt: 'a cat', model: 'test' } });
      // Let the process actually spawn before killing it.
      await new Promise((r) => setTimeout(r, 200));

      wrapper.killAll();

      await expect(generation).rejects.toThrow();
    } finally {
      delete process.env.FAKE_SD_SLEEP_MS;
    }
  });

  it('is a no-op when nothing is running', async () => {
    const config = await makeTestConfig();
    const wrapper = new SdWrapper(config, log);
    expect(() => wrapper.killAll()).not.toThrow();
  });

  it('does not affect a generation that already completed', async () => {
    const config = await makeTestConfig();
    const wrapper = new SdWrapper(config, log);
    const result = await wrapper.generate({ params: { prompt: 'a cat', model: 'test' } });
    expect(result.outputName).toMatch(/\.png$/);
    // Nothing left tracked to kill — a stray SIGKILL here would be a bug
    // (e.g. re-killing a reused/pooled process), not just a no-op.
    expect(() => wrapper.killAll()).not.toThrow();
  });
});
