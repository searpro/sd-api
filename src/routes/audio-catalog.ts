import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../schemas/generate.js';
import { AppError } from '../errors.js';

const fileSchema = z.object({
  filename: z.string(),
  path: z.string(),
  url: z.string(),
  size: z.number(),
  format: z.literal('gguf'),
  quant: z.string().nullable(),
});

const componentFilesSchema = z.object({
  role: z.enum(['weights', 'aux']),
  label: z.string(),
  required: z.boolean(),
  quantizable: z.boolean(),
  files: z.array(fileSchema),
  error: z.string().optional(),
});

export async function audioCatalogRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Browse the curated audio catalog (static; no network).
  app.get(
    '/v1/audio-catalog',
    {
      schema: {
        tags: ['audio'],
        summary: 'List catalog audio models available to download',
        description:
          'Curated audio.cpp models (TTS/ASR). Not the OpenAI-compatible surface — see /v1/audio/* for that.',
      },
    },
    async () => ({ models: app.audioCatalog.list() }),
  );

  // Resolve the selectable files for a model.
  app.get<{ Params: { id: string } }>(
    '/v1/audio-catalog/:id/files',
    {
      schema: {
        tags: ['audio'],
        summary: 'List downloadable files for a catalog audio model',
        description: 'Queries the HuggingFace Hub for the real files of each component.',
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({ id: z.string(), components: z.array(componentFilesSchema) }),
          404: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!app.audioCatalog.get(req.params.id)) {
        throw new AppError('MODEL_NOT_FOUND', `Unknown audio catalog model: ${req.params.id}`, 404);
      }
      const components = await app.audioCatalog.files(req.params.id);
      return reply.send({ id: req.params.id, components });
    },
  );
}
