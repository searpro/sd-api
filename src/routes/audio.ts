import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { errors } from '../errors.js';
import { safeResolve } from '../util/paths.js';
import { uniqueOutputName } from '../util/filename.js';

/**
 * OpenAI-audio-shaped reverse proxy to a locally-supervised `audiocpp_server`
 * (see src/audio/server-manager.ts). Structurally mirrors src/routes/llm.ts:
 * requests are forwarded byte-for-byte, so one code path handles JSON, SSE,
 * and binary (audio/wav) responses alike — we never buffer or reshape the
 * upstream body, only relay it.
 *
 * `.passthrough()` on JSON body schemas is required: fastify-type-provider-zod
 * replaces `request.body` with the *parsed* value, and a plain zod object
 * strips unknown keys by default — without passthrough we'd silently drop
 * fields like `voice_ref`, `stream_format`, `options`, etc.
 */

const speechSchema = z
  .object({
    model: z.string().min(1),
    input: z.string().min(1),
    // Text-based voice reference for "VoiceDesign"-capable families —
    // confirmed via `audiocpp_cli --help`: `--instruct <text>` is the
    // general voice-design instruction field ("for models such as Qwen3
    // TTS"); `caption` is a *family-specific* alias used by Irodori-TTS's
    // own request-options schema. Only meaningful against a bundle whose
    // model.json has task:"vdes" (voice design). We send both from the web
    // UI's single caption field since which one a given family reads varies.
    instruct: z.string().optional(),
    caption: z.string().optional(),
  })
  .passthrough();
const transcriptionJsonSchema = z
  .object({
    model: z.string().min(1),
    audio: z.string().min(1),
    // Word-level timestamps — confirmed against the real binary: this only
    // works via audiocpp_server's generic /v1/tasks/run task-runner (its
    // OpenAI-shape /v1/audio/transcriptions ignores the field entirely), so
    // the route handler below transparently proxies there instead when set.
    words_out: z.boolean().optional(),
  })
  .passthrough();
const tasksRunSchema = z.object({ model: z.string().min(1), request: z.record(z.unknown()) }).passthrough();

export async function audioRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * Forward a JSON request to audiocpp_server and relay its response
   * (status, content-type, body) verbatim to the client, aborting the
   * upstream call if the client disconnects. No response validation/
   * reshaping — passthrough for maximum client compatibility.
   */
  async function proxyToAudio(
    req: FastifyRequest,
    reply: FastifyReply,
    upstreamPath: string,
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<void> {
    const controller = new AbortController();
    // `req.raw` ('close') fires as soon as the request body is fully read —
    // not when the client disconnects (a well-known Node IncomingMessage
    // quirk) — which would abort the upstream fetch immediately on every
    // request. `reply.raw` ('close') correctly reflects the response socket
    // closing prematurely.
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });

    let upstream: Response;
    try {
      upstream = await fetch(`${app.audio.baseUrl}${upstreamPath}`, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) return; // client already gone
      throw errors.audioServerUnavailable(
        `Could not reach audiocpp_server at ${app.audio.baseUrl}: ${(err as Error).message}`,
      );
    }

    await relay(req, reply, upstream, controller);
  }

  /**
   * Same as proxyToAudio, but forwards the raw incoming request body
   * unparsed (used for multipart/form-data transcription uploads — see the
   * addContentTypeParser registration below) instead of re-encoding JSON.
   */
  async function proxyToAudioRaw(
    req: FastifyRequest,
    reply: FastifyReply,
    upstreamPath: string,
    contentType: string,
  ): Promise<void> {
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });

    let upstream: Response;
    try {
      upstream = await fetch(`${app.audio.baseUrl}${upstreamPath}`, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: Readable.toWeb(req.raw) as ReadableStream,
        duplex: 'half',
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      throw errors.audioServerUnavailable(
        `Could not reach audiocpp_server at ${app.audio.baseUrl}: ${(err as Error).message}`,
      );
    }

    await relay(req, reply, upstream, controller);
  }

  /**
   * Like proxyToAudio, but for non-streaming /v1/audio/speech requests:
   * buffers the full response (these are small — seconds of speech), writes
   * a copy into outputsDir alongside generated images (same directory the
   * image side already uses — see src/sd/wrapper.ts), then relays the
   * already-buffered bytes to the client with an `X-Output-Name` header so
   * callers/the UI can fetch it again later via GET /v1/outputs/:name.
   * Streaming requests (stream_format: sse|audio) skip this — chunk
   * boundaries would need real bookkeeping — and fall back to proxyToAudio.
   */
  async function proxyToAudioSpeechAndSave(
    req: FastifyRequest,
    reply: FastifyReply,
    body: Record<string, unknown>,
  ): Promise<void> {
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });

    let upstream: Response;
    try {
      upstream = await fetch(`${app.audio.baseUrl}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      throw errors.audioServerUnavailable(
        `Could not reach audiocpp_server at ${app.audio.baseUrl}: ${(err as Error).message}`,
      );
    }

    if (!upstream.ok) {
      // Error responses are small JSON — no output to save, relay unchanged.
      await relay(req, reply, upstream, controller);
      return;
    }

    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    const buf = Buffer.from(await upstream.arrayBuffer());

    let outputName: string | undefined;
    try {
      let audioBytes: Buffer | undefined;
      if (contentType.startsWith('audio/')) {
        audioBytes = buf;
      } else if (contentType.includes('application/json')) {
        // response_format:"json" — audiocpp_server returns {"audio":"<base64>","format":"wav",...}.
        const parsed = JSON.parse(buf.toString('utf8')) as {
          audio?: string;
          audio_base64?: string;
          format?: string;
        };
        const b64 = parsed.audio ?? parsed.audio_base64;
        if (typeof b64 === 'string') audioBytes = Buffer.from(b64, 'base64');
      }
      if (audioBytes) {
        await mkdir(app.config.outputsDir, { recursive: true });
        outputName = uniqueOutputName('wav');
        await writeFile(safeResolve(app.config.outputsDir, outputName), audioBytes);
      }
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'failed to persist generated audio to outputs dir');
    }

    reply.header('content-type', contentType);
    if (outputName) reply.header('X-Output-Name', outputName);
    reply.code(upstream.status);
    return reply.send(buf);
  }

  async function relay(
    req: FastifyRequest,
    reply: FastifyReply,
    upstream: Response,
    controller: AbortController,
  ): Promise<void> {
    if (!upstream.body) {
      reply.raw.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      });
      reply.raw.end();
      return;
    }

    reply.raw.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    });
    try {
      await pipeline(
        Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]),
        reply.raw,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        req.log.warn({ err: (err as Error).message }, 'audiocpp_server upstream stream error');
      }
      // Response is already committed (headers sent) — nothing more we can do
      // but ensure the socket is closed.
      reply.raw.destroy();
    }
  }

  // Replace the @fastify/multipart parser (registered globally in server.ts)
  // with a no-op for just this plugin's routes, so a multipart transcription
  // upload reaches the handler as an unconsumed raw stream instead of being
  // parsed into fields/files we'd have to re-encode. Content-type parsers
  // are cloned (not shared) per encapsulated plugin context, so this swap
  // only affects audioRoutes — /v1/inputs' multipart uploads are unaffected
  // — but the clone already contains the inherited global parser, so it must
  // be removed here first or addContentTypeParser rejects the duplicate key.
  app.removeContentTypeParser('multipart/form-data');
  app.addContentTypeParser('multipart/form-data', (_req, _payload, done) => done(null, undefined));

  app.post(
    '/v1/audio/speech',
    {
      schema: {
        tags: ['audio'],
        summary: 'OpenAI-style text-to-speech (proxied to audiocpp_server)',
        description:
          'Returns audio/wav by default; set response_format:"json" for base64 WAV, or ' +
          'stream_format:"sse"/"audio" for a streaming-capable model. The request body is ' +
          'forwarded to audiocpp_server unmodified. Non-streaming responses are also saved into ' +
          'outputsDir (see GET /v1/outputs/:name) — the saved filename comes back as the ' +
          '`X-Output-Name` response header. Voice-cloning-only models (Chatterbox, DramaBox, ...) ' +
          'need a reference registered via POST /v1/audio-models/:model/voice-presets, selected ' +
          'here via `voice`. Voice-*design* models (task:"vdes" — the *-voicedesign catalog ' +
          'entries, or OmniVoice) instead take a text `instruct` (or, for some families, ' +
          '`caption`) describing the target voice directly — no reference audio needed.',
        body: speechSchema,
      },
    },
    async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const streaming = body.stream_format === 'sse' || body.stream_format === 'audio' || body.stream === true;
      if (streaming) {
        return proxyToAudio(req, reply, '/v1/audio/speech', 'POST', body);
      }
      return proxyToAudioSpeechAndSave(req, reply, body);
    },
  );

  app.post(
    '/v1/audio/transcriptions',
    {
      schema: {
        tags: ['audio'],
        summary: 'OpenAI-style transcription (proxied to audiocpp_server)',
        description:
          'Accepts a JSON body with a server-local audio path ({"model","audio"}), or a ' +
          'multipart/form-data upload (model, language?, file) matching the OpenAI Whisper ' +
          'convention. Routed by Content-Type; multipart uploads are streamed through unparsed. ' +
          'Word-level timestamps (whisperX-like): set `words_out: true` on the JSON-body form to ' +
          'get a `words[]` array back (`{word, start_sample, end_sample, confidence}` each — e.g. ' +
          'with the parakeet-tdt catalog entry, which supports this natively). Confirmed against ' +
          'the real binary that this only works via audiocpp_server\'s generic task-runner path, ' +
          'not its OpenAI-shape endpoint directly, so this route transparently proxies to ' +
          '/v1/tasks/run instead when `words_out` is set. **Not available with multipart uploads** ' +
          '(no server-local path to hand it) — upload first via POST /v1/audio-voice-refs (WAV) to ' +
          'get a path, then use the JSON form.',
      },
    },
    async (req, reply) => {
      const contentType = req.headers['content-type'] ?? '';
      if (contentType.toLowerCase().startsWith('multipart/form-data')) {
        return proxyToAudioRaw(req, reply, '/v1/audio/transcriptions', contentType);
      }
      const body = transcriptionJsonSchema.parse(req.body);
      if (body.words_out) {
        // audiocpp_server's OpenAI-shape endpoint silently ignores words_out
        // (confirmed against the real binary) — only /v1/tasks/run's generic
        // task-runner path actually returns a words[] array, so route there.
        const { model, ...request } = body;
        return proxyToAudio(req, reply, '/v1/tasks/run', 'POST', {
          model,
          request: { task: 'asr', ...request },
        });
      }
      return proxyToAudio(req, reply, '/v1/audio/transcriptions', 'POST', body);
    },
  );

  app.get<{ Querystring: { model?: string } }>(
    '/v1/audio/voices',
    {
      schema: {
        tags: ['audio'],
        summary: 'List cached voice ids / presets for a TTS model (proxied to audiocpp_server)',
        querystring: z.object({ model: z.string().min(1).optional() }),
      },
    },
    async (req, reply) => {
      const qs = req.query.model ? `?model=${encodeURIComponent(req.query.model)}` : '';
      return proxyToAudio(req, reply, `/v1/audio/voices${qs}`, 'GET');
    },
  );

  app.get(
    '/v1/audio/models',
    {
      schema: {
        tags: ['audio'],
        summary: 'OpenAI-compatible model listing (proxied to audiocpp_server)',
        description:
          'This is the strict OpenAI-shape endpoint for the models audiocpp_server currently ' +
          'has configured — not our own model/bundle management API.',
      },
    },
    async (req, reply) => proxyToAudio(req, reply, '/v1/models', 'GET'),
  );

  app.post(
    '/v1/audio/tasks/run',
    {
      schema: {
        tags: ['audio'],
        summary: 'Generic audio.cpp framework request (proxied to audiocpp_server)',
        description:
          'Escape hatch for tasks without a dedicated route (voice conversion, music ' +
          'generation, source separation, ...): {"model","request":{...}} using the same ' +
          'request fields as audiocpp_cli, passed through unmodified.',
        body: tasksRunSchema,
      },
    },
    async (req, reply) => proxyToAudio(req, reply, '/v1/tasks/run', 'POST', req.body),
  );
}
