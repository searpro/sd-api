import type { FastifyInstance } from 'fastify';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, stat, readdir, unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { safeResolve, assertSafeName } from '../util/paths.js';
import { errors } from '../errors.js';
import { errorResponseSchema } from '../schemas/generate.js';

// audiocpp_server's own docs describe voice_ref as a WAV path specifically
// (e.g. Chatterbox's "Reference voice WAV path for voice cloning") — kept
// narrow rather than accepting arbitrary audio types it may not decode.
const WAV_EXT = '.wav';

const voiceRefSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number(),
  modified: z.string(),
});

/**
 * Storage for user-uploaded reference voice audio (WAV) used as `voice_ref`
 * for voice-cloning/conversion-only TTS models (e.g. Chatterbox — see
 * README's Audio generation section). Mirrors src/routes/inputs.ts (image
 * references for img2img): upload once, then pass the returned server-local
 * `path` as `voice_ref` in a `/v1/audio/speech` request body.
 */
export async function audioVoiceRefRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/v1/audio-voice-refs',
    {
      schema: {
        tags: ['audio'],
        summary: 'Upload a reference voice WAV for voice-cloning TTS models',
        description:
          'Used as `voice_ref` in a /v1/audio/speech request for cloning-only models like ' +
          'Chatterbox, which require a speaker reference audio (and optionally matching ' +
          '`reference_text`) rather than plain text input.',
        consumes: ['multipart/form-data'],
        response: { 201: z.object({ voiceRefs: z.array(voiceRefSchema) }) },
      },
    },
    async (req, reply) => {
      if (!req.isMultipart()) {
        throw errors.invalidPath('Expected multipart/form-data upload');
      }
      await mkdir(app.config.audioVoiceRefsDir, { recursive: true });

      const saved: { name: string; path: string; size: number; modified: string }[] = [];
      for await (const part of req.files()) {
        const ext = extname(part.filename || '').toLowerCase();
        if (ext !== WAV_EXT) {
          throw errors.invalidPath(`Unsupported audio type "${ext || 'unknown'}". Allowed: ${WAV_EXT}`);
        }
        const name = `${randomUUID()}${ext}`;
        const path = safeResolve(app.config.audioVoiceRefsDir, name);
        await pipeline(part.file, createWriteStream(path));
        if (part.file.truncated) {
          throw errors.invalidPath('Uploaded file exceeds the size limit');
        }
        const s = await stat(path);
        saved.push({ name, path, size: s.size, modified: s.mtime.toISOString() });
      }

      if (saved.length === 0) throw errors.invalidPath('No files in upload');
      return reply.code(201).send({ voiceRefs: saved });
    },
  );

  typed.get(
    '/v1/audio-voice-refs',
    {
      schema: {
        tags: ['audio'],
        summary: 'List uploaded reference voice WAVs',
        response: { 200: z.object({ voiceRefs: z.array(voiceRefSchema) }) },
      },
    },
    async () => {
      let entries: string[];
      try {
        entries = await readdir(app.config.audioVoiceRefsDir);
      } catch {
        entries = [];
      }
      const voiceRefs: { name: string; path: string; size: number; modified: string }[] = [];
      for (const name of entries) {
        if (extname(name).toLowerCase() !== WAV_EXT) continue;
        const path = safeResolve(app.config.audioVoiceRefsDir, name);
        try {
          const s = await stat(path);
          if (!s.isFile()) continue;
          voiceRefs.push({ name, path, size: s.size, modified: s.mtime.toISOString() });
        } catch {
          // skip
        }
      }
      voiceRefs.sort((a, b) => b.modified.localeCompare(a.modified));
      return { voiceRefs };
    },
  );

  app.get<{ Params: { name: string } }>(
    '/v1/audio-voice-refs/:name',
    {
      schema: {
        tags: ['audio'],
        summary: 'Fetch an uploaded reference voice WAV (for UI playback)',
        response: { 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      assertSafeName(req.params.name);
      const path = safeResolve(app.config.audioVoiceRefsDir, req.params.name);
      try {
        const s = await stat(path);
        if (!s.isFile()) throw new Error('not a file');
      } catch {
        throw errors.audioVoiceRefNotFound(req.params.name);
      }
      reply.header('Content-Type', 'audio/wav');
      return reply.send(createReadStream(path));
    },
  );

  app.delete<{ Params: { name: string } }>(
    '/v1/audio-voice-refs/:name',
    {
      schema: {
        tags: ['audio'],
        summary: 'Delete an uploaded reference voice WAV',
        response: { 200: z.object({ removed: z.string() }), 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      assertSafeName(req.params.name);
      const path = safeResolve(app.config.audioVoiceRefsDir, req.params.name);
      try {
        await unlink(path);
      } catch {
        throw errors.audioVoiceRefNotFound(req.params.name);
      }
      return reply.send({ removed: req.params.name });
    },
  );
}
