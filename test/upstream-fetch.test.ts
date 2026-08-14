import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { upstreamFetch } from '../src/util/upstream-fetch.js';

/**
 * These pin the behaviour that made a long TTS request look like an
 * unreachable engine: Node's global fetch abandons a request after 300 s
 * waiting for response headers, so `audio_request_timeout_ms` could be set
 * above that and never take effect.
 *
 * The real case takes six minutes to reproduce, so the same mechanism is
 * exercised at millisecond scale — what matters is that the dispatcher is
 * actually applied and that the caller's ceiling is the one that decides.
 */
let server: Server | undefined;

function serverDelayingHeadersBy(ms: number): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }, ms);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`);
    });
  });
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

describe('upstreamFetch', () => {
  it('waits for a response slower than the timeout it was given', async () => {
    const base = await serverDelayingHeadersBy(400);
    const response = await upstreamFetch(base, { method: 'GET' }, 5_000);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('gives up once its own ceiling is passed', async () => {
    const base = await serverDelayingHeadersBy(1_000);
    await expect(upstreamFetch(base, { method: 'GET' }, 200)).rejects.toThrow();
  });

  it('treats 0 as no limit, matching how the engine guards read it', async () => {
    const base = await serverDelayingHeadersBy(400);
    const response = await upstreamFetch(base, { method: 'GET' }, 0);
    expect(response.status).toBe(200);
  });

  it('reuses one agent per timeout rather than building one per request', async () => {
    const base = await serverDelayingHeadersBy(0);
    const first = await upstreamFetch(base, { method: 'GET' }, 5_000);
    const second = await upstreamFetch(base, { method: 'GET' }, 5_000);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });
});
