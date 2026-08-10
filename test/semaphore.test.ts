import { describe, it, expect } from 'vitest';
import { Semaphore } from '../src/util/semaphore.js';

/** A promise plus the handles to settle it, so a test can hold work open. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Semaphore', () => {
  it('rejects a nonsensical permit count rather than silently allowing everything', () => {
    expect(() => new Semaphore(0)).toThrow(/at least 1 permit/);
    expect(() => new Semaphore(-1)).toThrow(/at least 1 permit/);
    expect(() => new Semaphore(1.5)).toThrow(/at least 1 permit/);
  });

  // The whole point: with one permit, a second caller must not start until the
  // first has finished. This is what stops two model loads coexisting.
  it('runs one at a time when there is a single permit', async () => {
    const sem = new Semaphore(1);
    const first = deferred();
    const order: string[] = [];

    const a = sem.run(async () => {
      order.push('a:start');
      await first.promise;
      order.push('a:end');
    });
    const b = sem.run(async () => {
      order.push('b:start');
    });

    // Let the microtask queue drain — b must still be waiting.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['a:start']);
    expect(sem.inUse).toBe(1);
    expect(sem.queued).toBe(1);

    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
    expect(sem.inUse).toBe(0);
    expect(sem.queued).toBe(0);
  });

  it('allows exactly `permits` runners at once', async () => {
    const sem = new Semaphore(2);
    const gate = deferred();
    let concurrent = 0;
    let peak = 0;

    const runs = Array.from({ length: 5 }, () =>
      sem.run(async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        await gate.promise;
        concurrent--;
      }),
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(peak).toBe(2);

    gate.resolve();
    await Promise.all(runs);
    expect(peak).toBe(2);
    expect(sem.inUse).toBe(0);
  });

  it('serves waiters in FIFO order', async () => {
    const sem = new Semaphore(1);
    const gate = deferred();
    const order: number[] = [];

    const runs = [
      sem.run(async () => {
        order.push(0);
        await gate.promise;
      }),
      ...[1, 2, 3].map((n) => sem.run(async () => void order.push(n))),
    ];

    gate.resolve();
    await Promise.all(runs);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  // A permit must come back even when the work throws, or one failed
  // generation would wedge the server for good.
  it('releases the permit when the work throws', async () => {
    const sem = new Semaphore(1);

    await expect(
      sem.run(async () => {
        throw new Error('generation failed');
      }),
    ).rejects.toThrow('generation failed');

    expect(sem.inUse).toBe(0);
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('does not start work for a caller that aborts while queued', async () => {
    const sem = new Semaphore(1);
    const gate = deferred();
    const controller = new AbortController();
    let started = false;

    const held = sem.run(async () => {
      await gate.promise;
    });
    const queued = sem.run(async () => {
      started = true;
    }, controller.signal);

    await Promise.resolve();
    expect(sem.queued).toBe(1);

    controller.abort();
    await expect(queued).rejects.toThrow(/Aborted/);
    expect(started).toBe(false);

    // The abandoned waiter must not have consumed the permit it never got.
    gate.resolve();
    await held;
    expect(sem.inUse).toBe(0);
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('rejects immediately for a signal that is already aborted', async () => {
    const sem = new Semaphore(1);
    let started = false;

    await expect(
      sem.run(async () => {
        started = true;
      }, AbortSignal.abort()),
    ).rejects.toThrow(/Aborted/);

    expect(started).toBe(false);
    expect(sem.inUse).toBe(0);
  });

  // An abort that lands after the work started is the caller's problem to
  // handle (for a generation, by killing the child) — the semaphore must not
  // reject a run that is already underway.
  it('ignores an abort once the work has started', async () => {
    const sem = new Semaphore(1);
    const controller = new AbortController();
    const gate = deferred();

    const run = sem.run(async () => {
      controller.abort();
      await gate.promise;
      return 'finished';
    }, controller.signal);

    gate.resolve();
    await expect(run).resolves.toBe('finished');
    expect(sem.inUse).toBe(0);
  });
});
