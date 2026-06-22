import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../schemas/generate.js';

const modelInfoSchema = z.object({
  name: z.string(),
  type: z.enum(['checkpoint', 'vae', 'clip']),
  size: z.number(),
  modified: z.string(),
});

const downloadSchema = z.object({
  url: z.string().url(),
  type: z.enum(['checkpoint', 'vae', 'clip']).default('checkpoint'),
  name: z.string().optional(),
});

export async function modelRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  // Phase 3: list models.
  app.get(
    '/v1/models',
    {
      schema: {
        tags: ['models'],
        summary: 'List installed models',
        response: { 200: z.object({ models: z.array(modelInfoSchema) }) },
      },
    },
    async () => ({ models: await app.models.list() }),
  );

  // Phase 3: download a model (streamed to disk).
  app.post(
    '/v1/models/download',
    {
      schema: {
        tags: ['models'],
        summary: 'Download a model from a URL',
        body: downloadSchema,
        response: {
          201: modelInfoSchema,
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const info = await app.models.download(req.body);
      return reply.code(201).send(info);
    },
  );

  // Phase 3: delete a model (traversal-safe).
  app.delete<{ Params: { name: string } }>(
    '/v1/models/:name',
    {
      schema: {
        tags: ['models'],
        summary: 'Delete a model by name',
        params: z.object({ name: z.string() }),
        response: {
          200: z.object({ deleted: z.string() }),
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      await app.models.delete(req.params.name);
      return reply.send({ deleted: req.params.name });
    },
  );
}
