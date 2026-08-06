import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { z } from 'zod';
import { safeResolve } from '../util/paths.js';
import { errors } from '../errors.js';
import { errorResponseSchema } from '../schemas/generate.js';

// outputsDir holds both generated images (src/sd/wrapper.ts) and, since
// generated speech is saved there too (src/routes/audio.ts), generated audio.
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.wav': 'audio/wav',
};

export async function outputRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  // Phase 6: fetch a generated output (image or audio; binary or base64).
  app.get<{ Params: { name: string }; Querystring: { format?: string } }>(
    '/v1/outputs/:name',
    {
      schema: {
        tags: ['outputs'],
        summary: 'Fetch a generated output (image or audio)',
        description: 'Returns the raw bytes, or a base64 JSON payload when ?format=base64.',
        params: z.object({ name: z.string() }),
        querystring: z.object({ format: z.enum(['binary', 'base64']).optional() }),
        response: { 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const path = safeResolve(app.config.outputsDir, req.params.name);
      try {
        const s = await stat(path);
        if (!s.isFile()) throw new Error('not a file');
      } catch {
        throw errors.outputNotFound(req.params.name);
      }
      const mime = MIME_BY_EXT[extname(req.params.name).toLowerCase()] ?? 'application/octet-stream';

      if (req.query.format === 'base64') {
        const data = await readFile(path);
        return reply.send({
          name: req.params.name,
          mime,
          base64: data.toString('base64'),
        });
      }

      reply.header('Content-Type', mime);
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.send(createReadStream(path));
    },
  );
}
