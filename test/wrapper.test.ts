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

/**
 * Each sd-cli process loads the whole model into memory, so how many run at
 * once is a hard memory constraint, not a throughput preference. Before this
 * was enforced in the wrapper, POST /v1/generate spawned one per request with
 * no limit: three concurrent segment images was enough to exhaust memory and
 * get the server killed mid-run.
 *
 * These assert on the count of live child processes rather than on internal
 * permit bookkeeping — that is the number that actually costs memory.
 */
describe('SdWrapper concurrency', () => {
  /** Highest number of fake sd-cli processes alive at once across `count` runs. */
  async function peakProcesses(maxConcurrentJobs: number, count: number): Promise<number> {
    const config = await makeTestConfig({ maxConcurrentJobs });
    const wrapper = new SdWrapper(config, log);

    // Long enough that every generation would overlap if nothing serialised.
    process.env.FAKE_SD_SLEEP_MS = '200';
    let peak = 0;
    const sampler = setInterval(() => {
      peak = Math.max(peak, wrapper.stats.running);
    }, 10);
    try {
      await Promise.all(
        Array.from({ length: count }, (_, i) =>
          wrapper.generate({ params: { prompt: `p${i}`, model: 'test' } }),
        ),
      );
      return peak;
    } finally {
      clearInterval(sampler);
      delete process.env.FAKE_SD_SLEEP_MS;
    }
  }

  it('never runs more than one generation at a time by default', async () => {
    expect(await peakProcesses(1, 4)).toBe(1);
  });

  it('honours a raised limit without exceeding it', async () => {
    expect(await peakProcesses(2, 5)).toBe(2);
  });

  it('still completes every queued generation, with distinct outputs', async () => {
    const config = await makeTestConfig({ maxConcurrentJobs: 1 });
    const wrapper = new SdWrapper(config, log);

    const results = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        wrapper.generate({ params: { prompt: `p${i}`, model: 'test' } }),
      ),
    );

    // Queueing must not collapse distinct requests onto one output file.
    expect(results).toHaveLength(3);
    expect(new Set(results.map((r) => r.outputName)).size).toBe(3);
    expect(wrapper.stats).toEqual({ running: 0, queued: 0 });
  });

  it('frees the slot after a failed generation', async () => {
    const config = await makeTestConfig({ maxConcurrentJobs: 1 });
    const wrapper = new SdWrapper(config, log);

    process.env.FAKE_SD_FAIL = '1';
    try {
      await expect(
        wrapper.generate({ params: { prompt: 'boom', model: 'test' } }),
      ).rejects.toThrow();
    } finally {
      delete process.env.FAKE_SD_FAIL;
    }

    // A wedged slot here would mean one bad generation takes the server out of
    // service for good — worse than the crash this replaced.
    expect(wrapper.stats.running).toBe(0);
    const result = await wrapper.generate({ params: { prompt: 'after', model: 'test' } });
    expect(result.outputName).toMatch(/\.png$/);
  });

  it('does not spawn a process for a caller that gave up while queued', async () => {
    const config = await makeTestConfig({ maxConcurrentJobs: 1 });
    const wrapper = new SdWrapper(config, log);
    const controller = new AbortController();

    process.env.FAKE_SD_SLEEP_MS = '400';
    try {
      const held = wrapper.generate({ params: { prompt: 'first', model: 'test' } });
      await new Promise((r) => setTimeout(r, 50));

      const queued = wrapper.generate({
        params: { prompt: 'abandoned', model: 'test' },
        signal: controller.signal,
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(wrapper.stats).toEqual({ running: 1, queued: 1 });

      controller.abort();
      await expect(queued).rejects.toThrow();
      // Still only the original process — the abandoned one never spawned.
      expect(wrapper.stats.running).toBe(1);

      await held;
      expect(wrapper.stats).toEqual({ running: 0, queued: 0 });
    } finally {
      delete process.env.FAKE_SD_SLEEP_MS;
    }
  });
});
