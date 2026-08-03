#!/usr/bin/env node
// A stand-in for llama-server used in tests. Unlike fake-sd.mjs (a one-shot
// script matching sd-cli's per-request spawn model), this is a long-running
// HTTP server, since LlamaServerManager supervises a persistent process.
import { createServer } from 'node:http';

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const port = Number(flag('--port') ?? 8090);
const host = flag('--host') ?? '127.0.0.1';

// Test-observable counters, exposed via GET /__debug.
let requestCount = 0;
let abortedStreams = 0;

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

const server = createServer(async (req, res) => {
  requestCount++;
  const url = new URL(req.url, `http://${host}:${port}`);

  if (url.pathname === '/health') {
    if (process.env.FAKE_LLAMA_NO_HEALTH === '1') {
      res.writeHead(503).end('not ready');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    return;
  }

  if (url.pathname === '/__debug') {
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ requestCount, abortedStreams }));
    return;
  }

  if (url.pathname === '/v1/models' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'fake-model', object: 'model', created: 0, owned_by: 'llamacpp' }],
      }),
    );
    return;
  }

  if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    if (body.stream) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      let aborted = false;
      // `req` ('close') fires once the request body is fully read, not when
      // the connection actually drops (a Node IncomingMessage quirk) — `res`
      // ('close') correctly reflects the response socket closing prematurely.
      res.on('close', () => {
        if (!res.writableEnded) {
          aborted = true;
          abortedStreams++;
        }
      });
      const chunks = ['Hello', ' from', ' fake', ' llama'];
      for (const piece of chunks) {
        if (aborted) return;
        const delta = { choices: [{ delta: { content: piece }, index: 0 }] };
        res.write(`data: ${JSON.stringify(delta)}\n\n`);
        await new Promise((r) => setTimeout(r, 15));
      }
      if (!aborted) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        id: 'chatcmpl-fake',
        object: 'chat.completion',
        created: 0,
        model: body.model ?? 'fake-model',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'Hello from fake llama' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 4, total_tokens: 5 },
      }),
    );
    return;
  }

  if (url.pathname === '/v1/completions' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        id: 'cmpl-fake',
        object: 'text_completion',
        created: 0,
        model: body.model ?? 'fake-model',
        choices: [{ index: 0, text: 'fake completion', finish_reason: 'stop' }],
      }),
    );
    return;
  }

  if (url.pathname === '/v1/embeddings' && req.method === 'POST') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({ object: 'list', data: [{ object: 'embedding', embedding: [0.1, 0.2], index: 0 }] }),
    );
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
});

server.listen(port, host, () => {
  process.stderr.write(`fake-llama-server listening on http://${host}:${port}\n`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  // Force-exit if close hangs (e.g. a keep-alive stream still open).
  setTimeout(() => process.exit(0), 500).unref();
});
