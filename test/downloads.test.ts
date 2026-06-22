import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { DownloadManager } from '../src/downloads/manager.js';
import { ModelManager } from '../src/models/manager.js';
import { makeTestConfig } from './helpers.js';

const log = { info() {}, warn() {}, debug() {}, error() {} } as never;

// Deterministic payload.
const SIZE = 200_000;
const PAYLOAD = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i++) PAYLOAD[i] = i % 256;

let server: Server;
let base: string;
let slow = false;

beforeAll(async () => {
  server = createServer((req, res) => {
    const range = req.headers.range;
    const send = async (start: number, status: number) => {
      const body = PAYLOAD.subarray(start);
      res.writeHead(status, {
        'Content-Length': String(body.length),
        'Accept-Ranges': 'bytes',
        ...(status === 206
          ? { 'Content-Range': `bytes ${start}-${SIZE - 1}/${SIZE}` }
          : {}),
      });
      if (!slow) {
        res.end(body);
        return;
      }
      // Stream slowly so the test can cancel mid-flight.
      let off = 0;
      const chunk = 16_000;
      const tick = () => {
        if (off >= body.length) return res.end();
        res.write(body.subarray(off, off + chunk));
        off += chunk;
        setTimeout(tick, 40);
      };
      tick();
    };
    if (range) {
      const m = /bytes=(\d+)-/.exec(range);
      const start = m ? Number(m[1]) : 0;
      if (start >= SIZE) {
        res.writeHead(416).end();
        return;
      }
      void send(start, 206);
    } else {
      void send(0, 200);
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('DownloadManager', () => {
  it('downloads a component with progress and completes', async () => {
    slow = false;
    const config = await makeTestConfig();
    const models = new ModelManager(config, log);
    const dl = new DownloadManager(config, models, log);

    const task = dl.enqueue({ model: 'm1', type: 'checkpoint', url: `${base}/x.gguf`, name: 'x.gguf' });
    await waitFor(() => task.status === 'completed');
    expect(task.total).toBe(SIZE);
    expect(task.received).toBe(SIZE);

    const final = join(config.modelsDir, 'm1', 'checkpoint', 'x.gguf');
    expect((await stat(final)).size).toBe(SIZE);
    expect(Buffer.compare(await readFile(final), PAYLOAD)).toBe(0);
  });

  it('resumes from an existing .part via a Range request', async () => {
    slow = false;
    const config = await makeTestConfig();
    const models = new ModelManager(config, log);
    const dl = new DownloadManager(config, models, log);

    // Seed a partial: first 80k bytes + sidecar metadata.
    const dir = join(config.modelsDir, 'm2', 'checkpoint');
    await mkdir(dir, { recursive: true });
    const partial = 80_000;
    await writeFile(join(dir, 'y.gguf.part'), PAYLOAD.subarray(0, partial));
    await writeFile(
      join(dir, 'y.gguf.part.json'),
      JSON.stringify({ url: `${base}/y.gguf`, total: SIZE, model: 'm2', type: 'checkpoint', name: 'y.gguf' }),
    );

    const task = await dl.resumePartial('m2', 'checkpoint', 'y.gguf');
    await waitFor(() => task.status === 'completed');
    expect(task.resumed).toBe(true);

    const final = join(dir, 'y.gguf');
    expect((await stat(final)).size).toBe(SIZE);
    expect(Buffer.compare(await readFile(final), PAYLOAD)).toBe(0);
  });

  it('cancels a running download and keeps the partial', async () => {
    slow = true;
    const config = await makeTestConfig();
    const models = new ModelManager(config, log);
    const dl = new DownloadManager(config, models, log);

    const task = dl.enqueue({ model: 'm3', type: 'checkpoint', url: `${base}/z.gguf`, name: 'z.gguf' });
    await waitFor(() => task.status === 'downloading' && task.received > 0);
    expect(dl.cancel(task.id)).toBe(true);
    await waitFor(() => task.status === 'cancelled');

    const part = join(config.modelsDir, 'm3', 'checkpoint', 'z.gguf.part');
    expect((await stat(part)).size).toBeGreaterThan(0);

    // The bundle reports the partial as resumable.
    const bundle = await models.get('m3');
    expect(bundle?.partials.find((p) => p.name === 'z.gguf')).toBeTruthy();
  });
});
