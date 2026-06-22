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
  format: z.enum(['safetensors', 'gguf']),
  quant: z.string().nullable(),
});

const componentFilesSchema = z.object({
  role: z.string(),
  bundleType: z.enum(['checkpoint', 'vae', 'clip']),
  label: z.string(),
  required: z.boolean(),
  quantizable: z.boolean(),
  files: z.record(z.array(fileSchema)),
  errors: z.record(z.string()).optional(),
});

export async function catalogRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Browse the curated model catalog (static; no network).
  app.get(
    '/v1/catalog',
    {
      schema: {
        tags: ['catalog'],
        summary: 'List catalog models available to download',
      },
    },
    async () => ({ models: app.catalog.list() }),
  );

  // Resolve the selectable files (per format + quantization) for a model.
  app.get<{ Params: { id: string } }>(
    '/v1/catalog/:id/files',
    {
      schema: {
        tags: ['catalog'],
        summary: 'List downloadable files (formats + quantizations) for a catalog model',
        description: 'Queries the HuggingFace Hub for the real files of each component.',
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({ id: z.string(), components: z.array(componentFilesSchema) }),
          404: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!app.catalog.get(req.params.id)) {
        throw new AppError('MODEL_NOT_FOUND', `Unknown catalog model: ${req.params.id}`, 404);
      }
      const components = await app.catalog.files(req.params.id);
      return reply.send({ id: req.params.id, components });
    },
  );
}
