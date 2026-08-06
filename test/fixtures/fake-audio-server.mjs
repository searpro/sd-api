#!/usr/bin/env node
// A stand-in for audiocpp_server used in tests. Like fake-llama-server.mjs,
// this is a long-running HTTP server (AudioServerManager supervises a
// persistent process), but unlike llama-server it takes almost everything
// through --config rather than flags, so host/port come from that file.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const configPath = flag('--config');
const serverConfig = configPath ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
const port = serverConfig.port ?? 8091;
const host = serverConfig.host ?? '127.0.0.1';
const models = serverConfig.models ?? [];

// Test-observable counters, exposed via GET /__debug.
let requestCount = 0;

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolvePromise(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/** Multipart bodies aren't parsed here — we only need to prove raw bytes arrived intact. */
function countBytes(req) {
  return new Promise((resolvePromise, reject) => {
    let total = 0;
    req.on('data', (c) => (total += c.length));
    req.on('end', () => resolvePromise(total));
    req.on('error', reject);
  });
}

// A minimal (silent, 1-sample) WAV file — enough to prove the response byte
// stream and content-type make it back through the proxy unmodified.
const FAKE_WAV = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
  0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x80, 0x3e, 0x00, 0x00, 0x00, 0x7d, 0x00, 0x00,
  0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
]);

const server = createServer(async (req, res) => {
  requestCount++;
  const url = new URL(req.url, `http://${host}:${port}`);

  if (url.pathname === '/health') {
    if (process.env.FAKE_AUDIO_NO_HEALTH === '1') {
      res.writeHead(503).end('not ready');
      return;
    }
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ status: 'ok', models: models.length }));
    return;
  }

  if (url.pathname === '/__debug') {
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ requestCount, configuredModels: models.map((m) => m.id) }));
    return;
  }

  if (url.pathname === '/v1/models' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        object: 'list',
        data: models.map((m) => ({ id: m.id, object: 'model', created: 0, owned_by: 'audiocpp' })),
      }),
    );
    return;
  }

  if (url.pathname === '/v1/audio/speech' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    if (body.response_format === 'json') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({ model: body.model, audio_base64: FAKE_WAV.toString('base64') }),
      );
      return;
    }
    res.writeHead(200, { 'content-type': 'audio/wav' }).end(FAKE_WAV);
    return;
  }

  if (url.pathname === '/v1/audio/transcriptions' && req.method === 'POST') {
    const contentType = req.headers['content-type'] ?? '';
    if (contentType.toLowerCase().startsWith('multipart/form-data')) {
      const bytes = await countBytes(req);
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ text: `fake transcript (received ${bytes} multipart bytes)` }));
      return;
    }
    const body = await readBody(req).catch(() => ({}));
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ text: `fake transcript of ${body.audio ?? 'unknown'}` }));
    return;
  }

  if (url.pathname === '/v1/audio/voices' && req.method === 'GET') {
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ voices: ['alba', 'cosette'], model: url.searchParams.get('model') ?? null }));
    return;
  }

  if (url.pathname === '/v1/tasks/run' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ model: body.model, result: 'fake-task-result' }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
});

server.listen(port, host, () => {
  process.stderr.write(`fake-audio-server listening on http://${host}:${port}\n`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  // Force-exit if close hangs (e.g. a keep-alive stream still open).
  setTimeout(() => process.exit(0), 500).unref();
});
