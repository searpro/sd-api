import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { LogBuffer } from '../src/logs/buffer.js';
import { buildServer } from '../src/server.js';
import { makeTestConfig } from './helpers.js';

function line(obj: Record<string, unknown>): string {
  return JSON.stringify({ level: 30, time: Date.now(), pid: 1, hostname: 'test', ...obj });
}

describe('LogBuffer (unit — categorization, no Fastify)', () => {
  it('suppresses "incoming request" lines and tags the paired "request completed" line as http', () => {
    const buf = new LogBuffer();
    buf.write(line({ reqId: 'r1', req: { method: 'GET', url: '/v1/models' }, msg: 'incoming request' }));
    buf.write(line({ reqId: 'r1', res: { statusCode: 200 }, responseTime: 1.2, msg: 'request completed' }));
    const entries = buf.list();
    expect(entries).toHaveLength(1); // the "incoming request" line was never stored
    expect(entries[0].category).toBe('http');
    expect(entries[0].msg).toBe('request completed');
  });

  it('tags a request to /health as healthcheck', () => {
    const buf = new LogBuffer();
    buf.write(line({ reqId: 'r1', req: { method: 'GET', url: '/health' }, msg: 'incoming request' }));
    buf.write(line({ reqId: 'r1', res: { statusCode: 200 }, msg: 'request completed' }));
    expect(buf.list()[0].category).toBe('healthcheck');
  });

  it('tags a 4xx/5xx completed request as error, even without an err field', () => {
    const buf = new LogBuffer();
    buf.write(line({ reqId: 'r1', req: { method: 'GET', url: '/nope' }, msg: 'incoming request' }));
    buf.write(line({ reqId: 'r1', res: { statusCode: 404 }, msg: 'request completed' }));
    buf.write(line({ reqId: 'r2', req: { method: 'POST', url: '/v1/generate' }, msg: 'incoming request' }));
    buf.write(line({ reqId: 'r2', res: { statusCode: 400 }, msg: 'request completed' }));
    const entries = buf.list();
    expect(entries.every((e) => e.category === 'error')).toBe(true);
  });

  it('tags an explicit err field or level >= 50 as error', () => {
    const buf = new LogBuffer();
    buf.write(line({ msg: 'unhandled error', err: { message: 'boom' } }));
    buf.write(line({ level: 50, msg: 'something failed' }));
    expect(buf.list().every((e) => e.category === 'error')).toBe(true);
  });

  it('tags llama-server and sd-cli child-process lines by their msg field', () => {
    const buf = new LogBuffer();
    buf.write(line({ level: 20, msg: 'llama-server', line: 'server listening' }));
    buf.write(line({ level: 20, msg: 'sd', line: 'sampling...' }));
    const [a, b] = buf.list();
    expect(a.category).toBe('llama-server');
    expect(b.category).toBe('sd-cli');
  });

  it('falls back to app for everything else', () => {
    const buf = new LogBuffer();
    buf.write(line({ msg: 'sd-api listening on http://0.0.0.0:3000' }));
    expect(buf.list()[0].category).toBe('app');
  });

  it('drops malformed lines instead of throwing', () => {
    const buf = new LogBuffer();
    expect(() => buf.write('not json{{{')).not.toThrow();
    expect(buf.list()).toHaveLength(0);
  });

  it('list() respects limit, level, and category filters', () => {
    const buf = new LogBuffer();
    buf.write(line({ msg: 'one' }));
    buf.write(line({ level: 40, msg: 'two' }));
    buf.write(line({ msg: 'three' }));
    expect(buf.list({ limit: 1 }).map((e) => e.msg)).toEqual(['three']);
    expect(buf.list({ level: 'warn' }).map((e) => e.msg)).toEqual(['two']);
    expect(buf.list({ category: 'app' })).toHaveLength(3);
  });

  it('subscribe() delivers new writes and unsubscribe stops delivery', () => {
    const buf = new LogBuffer();
    const received: string[] = [];
    const unsubscribe = buf.subscribe((r) => received.push(r.msg ?? ''));
    buf.write(line({ msg: 'a' }));
    unsubscribe();
    buf.write(line({ msg: 'b' }));
    expect(received).toEqual(['a']);
  });
});

describe('GET /v1/logs and /v1/logs/stream (routes)', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildServer(await makeTestConfig());
    baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/logs returns buffered entries, filterable by category', async () => {
    app.logs.write(line({ msg: 'app-level info' }));
    app.logs.write(line({ reqId: 'x1', req: { url: '/health' }, msg: 'incoming request' }));
    app.logs.write(line({ reqId: 'x1', res: { statusCode: 200 }, msg: 'request completed' }));

    const all = await (await fetch(`${baseUrl}/v1/logs`)).json();
    expect(all.logs.some((r: { category: string }) => r.category === 'healthcheck')).toBe(true);

    const appOnly = await (await fetch(`${baseUrl}/v1/logs?category=app`)).json();
    expect(appOnly.logs.every((r: { category: string }) => r.category === 'app')).toBe(true);
  });

  it('SSE stream replays the current buffer then delivers live entries, and cleans up on disconnect', async () => {
    app.logs.write(line({ msg: 'pre-existing line for replay' }));
    const before = app.logs.listenerCount('log');

    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/v1/logs/stream`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const frames: { event: string; data: unknown }[] = [];

    async function readFrame(): Promise<void> {
      for (;;) {
        const parts = buf.split('\n\n');
        if (parts.length > 1) {
          const raw = parts.shift()!;
          buf = parts.join('\n\n');
          const eventLine = raw.split('\n').find((l) => l.startsWith('event: '));
          const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
          if (eventLine && dataLine) {
            frames.push({ event: eventLine.slice(7), data: JSON.parse(dataLine.slice(6)) });
          }
          return;
        }
        const { done, value } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
      }
    }

    await readFrame(); // replay burst
    expect(frames[0].event).toBe('replay');
    expect(
      (frames[0].data as { msg?: string }[]).some((r) => r.msg === 'pre-existing line for replay'),
    ).toBe(true);

    // Server-side subscriber count went up while the stream is open.
    expect(app.logs.listenerCount('log')).toBe(before + 1);

    app.logs.write(line({ msg: 'a brand new live line' }));
    await readFrame();
    expect(frames[1].event).toBe('log');
    expect((frames[1].data as { msg?: string }).msg).toBe('a brand new live line');

    controller.abort();
    await new Promise((r) => setTimeout(r, 50)); // let the server's 'close' handler run
    expect(app.logs.listenerCount('log')).toBe(before);
  });
});
