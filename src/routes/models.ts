import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../schemas/generate.js';
import type { ModelManifest } from '../models/bundle.js';

const componentFileSchema = z.object({
  name: z.string(),
  size: z.number(),
  role: z.string().optional(),
});

const bundleSchema = z.object({
  id: z.string(),
  name: z.string(),
  loadMode: z.enum(['model', 'diffusion-model']),
  checkpoint: componentFileSchema.nullable(),
  vae: componentFileSchema.nullable(),
  clip: z.array(componentFileSchema),
  size: z.number(),
  modified: z.string(),
  ready: z.boolean(),
});

const componentType = z.enum(['checkpoint', 'vae', 'clip']);

const createSchema = z.object({ model: z.string().min(1) });

const downloadSchema = z.object({
  model: z.string().min(1),
  type: componentType.default('checkpoint'),
  url: z.string().url(),
  name: z.string().optional(),
});

export async function modelRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List model bundles.
  app.get(
    '/v1/models',
    {
      schema: {
        tags: ['models'],
        summary: 'List installed model bundles',
        response: { 200: z.object({ models: z.array(bundleSchema) }) },
      },
    },
    async () => ({ models: await app.models.list() }),
  );

  // Get one bundle.
  app.get<{ Params: { model: string } }>(
    '/v1/models/:model',
    {
      schema: {
        tags: ['models'],
        summary: 'Get a model bundle',
        params: z.object({ model: z.string() }),
        response: { 200: bundleSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const bundle = await app.models.get(req.params.model);
      if (!bundle) {
        return reply
          .code(404)
          .send({ error: { code: 'MODEL_NOT_FOUND', message: `Model not found: ${req.params.model}` } });
      }
      return reply.send(bundle);
    },
  );

  // Create an empty bundle (checkpoint/, vae/, clip/).
  app.post(
    '/v1/models',
    {
      schema: {
        tags: ['models'],
        summary: 'Create an empty model bundle',
        body: createSchema,
        response: { 201: bundleSchema, 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      await app.models.createBundle(req.body.model);
      const bundle = await app.models.get(req.body.model);
      if (!bundle) {
        return reply
          .code(400)
          .send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create bundle' } });
      }
      return reply.code(201).send(bundle);
    },
  );

  // Write/replace a bundle's model.json manifest.
  app.put<{ Params: { model: string } }>(
    '/v1/models/:model/manifest',
    {
      schema: {
        tags: ['models'],
        summary: 'Write a bundle manifest (model.json)',
        params: z.object({ model: z.string() }),
        body: z.object({
          name: z.string().optional(),
          load: z.enum(['auto', 'model', 'diffusion-model']).optional(),
          components: z.record(z.string()).optional(),
          defaults: z.record(z.unknown()).optional(),
          extra_args: z.array(z.string()).optional(),
        }),
        response: { 200: bundleSchema, 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      await app.models.writeManifest(req.params.model, req.body as unknown as ModelManifest);
      const bundle = await app.models.get(req.params.model);
      if (!bundle) {
        return reply
          .code(400)
          .send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to write manifest' } });
      }
      return reply.send(bundle);
    },
  );

  // Download a component into a bundle.
  app.post(
    '/v1/models/download',
    {
      schema: {
        tags: ['models'],
        summary: 'Download a model component (checkpoint/vae/clip) into a bundle',
        body: downloadSchema,
        response: { 201: bundleSchema, 400: errorResponseSchema, 502: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const bundle = await app.models.download(req.body);
      return reply.code(201).send(bundle);
    },
  );

  // Delete a whole bundle.
  app.delete<{ Params: { model: string } }>(
    '/v1/models/:model',
    {
      schema: {
        tags: ['models'],
        summary: 'Delete a model bundle',
        params: z.object({ model: z.string() }),
        response: { 200: z.object({ deleted: z.string() }), 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      await app.models.deleteModel(req.params.model);
      return reply.send({ deleted: req.params.model });
    },
  );

  // Delete a single component within a bundle.
  app.delete<{ Params: { model: string; type: 'checkpoint' | 'vae' | 'clip'; name: string } }>(
    '/v1/models/:model/:type/:name',
    {
      schema: {
        tags: ['models'],
        summary: 'Delete a single component file within a bundle',
        params: z.object({ model: z.string(), type: componentType, name: z.string() }),
        response: { 200: z.object({ deleted: z.string() }), 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      await app.models.deleteComponent(req.params.model, req.params.type, req.params.name);
      return reply.send({ deleted: `${req.params.model}/${req.params.type}/${req.params.name}` });
    },
  );
}
