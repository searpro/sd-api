/**
 * A counting semaphore for async work, FIFO.
 *
 * Exists because sd-cli is spawned per request and each process loads the
 * whole model into memory. Two concurrent generations mean two copies of a
 * multi-gigabyte model resident at once, which on a typical machine does not
 * degrade gracefully — it exhausts memory and the OS kills the server. So the
 * number of *simultaneously running* generations has to be bounded, and
 * everything else waits its turn.
 *
 * Waiting rather than rejecting is deliberate: a caller asking for three
 * images wants three images, and a queue makes that slow instead of fatal.
 */
export class Semaphore {
  private held = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly permits: number) {
    if (!Number.isInteger(permits) || permits < 1) {
      throw new Error(`Semaphore needs at least 1 permit, got ${permits}`);
    }
  }

  /** Permits currently taken. Exposed for logging and tests. */
  get inUse(): number {
    return this.held;
  }

  /** Callers currently waiting for a permit. Exposed for logging and tests. */
  get queued(): number {
    return this.waiters.length;
  }

  /**
   * Run `fn` once a permit is free, releasing it afterwards.
   *
   * `signal` aborts the *wait* only. Once `fn` has started it owns the
   * cancellation story — for a generation that means killing the child
   * process, which the caller already handles.
   */
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());

    if (this.held < this.permits) {
      this.held++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const grant = () => {
        cleanup();
        this.held++;
        resolve();
      };
      const onAbort = () => {
        // Drop this waiter without touching `held` — it never got a permit.
        const index = this.waiters.indexOf(grant);
        if (index !== -1) this.waiters.splice(index, 1);
        cleanup();
        reject(abortError());
      };
      const cleanup = () => signal?.removeEventListener('abort', onAbort);

      this.waiters.push(grant);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private release(): void {
    this.held--;
    // Hand the slot straight to the next waiter rather than just decrementing
    // and letting whoever calls acquire() next take it — otherwise a caller
    // arriving at the right moment jumps the queue.
    this.waiters.shift()?.();
  }
}

function abortError(): Error {
  return new DOMException('Aborted while waiting for a generation slot', 'AbortError');
}
