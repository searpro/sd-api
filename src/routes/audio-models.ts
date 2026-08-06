import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../schemas/generate.js';
import { audioDownloadTaskSchema } from './audio-downloads.js';
import type { AudioModelManifest } from '../audio-models/bundle.js';

const componentFileSchema = z.object({ name: z.string(), size: z.number() });

const partialSchema = z.object({
  type: z.enum(['weights', 'aux']),
  name: z.string(),
  received: z.number(),
  total: z.number().nullable(),
});

const bundleSchema = z.object({
  id: z.string(),
  name: z.string(),
  family: z.string().nullable(),
  task: z.string().nullable(),
  files: z.array(componentFileSchema),
  size: z.number(),
  modified: z.string(),
  ready: z.boolean(),
  partials: z.array(partialSchema),
});

const componentType = z.enum(['weights', 'aux']);

const createSchema = z.object({ model: z.string().min(1) });

const downloadSchema = z.object({
  model: z.string().min(1),
  type: componentType.default('weights'),
  url: z.string().url(),
  name: z.string().optional(),
});

const manifestSchema = z.object({
  name: z.string().optional(),
  family: z.string().min(1),
  task: z.string().min(1),
  mode: z.enum(['offline', 'streaming']).optional(),
  loadOptions: z.record(z.unknown()).optional(),
  sessionOptions: z.record(z.unknown()).optional(),
  defaultVoicePreset: z.unknown().optional(),
  voicePresets: z.record(z.unknown()).optional(),
  busyTimeoutMs: z.number().optional(),
});

export async function audioModelRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List audio model bundles.
  app.get(
    '/v1/audio-models',
    {
      schema: {
        tags: ['audio'],
        summary: 'List installed audio model bundles',
        response: { 200: z.object({ models: z.array(bundleSchema) }) },
      },
    },
    async () => ({ models: await app.audioModels.list() }),
  );

  // Get one audio model bundle.
  app.get<{ Params: { model: string } }>(
    '/v1/audio-models/:model',
    {
      schema: {
        tags: ['audio'],
        summary: 'Get an audio model bundle',
        params: z.object({ model: z.string() }),
        response: { 200: bundleSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const bundle = await app.audioModels.get(req.params.model);
      if (!bundle) {
        return reply
          .code(404)
          .send({ error: { code: 'MODEL_NOT_FOUND', message: `Audio model not found: ${req.params.model}` } });
      }
      return reply.send(bundle);
    },
  );

  // Create an empty bundle directory.
  app.post(
    '/v1/audio-models',
    {
      schema: {
        tags: ['audio'],
        summary: 'Create an empty audio model bundle',
        body: createSchema,
        response: { 201: bundleSchema, 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      await app.audioModels.createBundle(req.body.model);
      const bundle = await app.audioModels.get(req.body.model);
      if (!bundle) {
        return reply
          .code(400)
          .send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create bundle' } });
      }
      return reply.code(201).send(bundle);
    },
  );

  // Write/replace a bundle's model.json sidecar (family/task, required).
  app.put<{ Params: { model: string } }>(
    '/v1/audio-models/:model/manifest',
    {
      schema: {
        tags: ['audio'],
        summary: 'Write an audio bundle sidecar (model.json)',
        description:
          'family/task are required — audiocpp_server needs them to pick the right loading ' +
          "code and can't infer either from files alone. Take effect on the next server restart.",
        params: z.object({ model: z.string() }),
        body: manifestSchema,
        response: { 200: bundleSchema, 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      await app.audioModels.writeManifest(req.params.model, req.body as AudioModelManifest);
      const bundle = await app.audioModels.get(req.params.model);
      if (!bundle) {
        return reply
          .code(400)
          .send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to write manifest' } });
      }
      return reply.send(bundle);
    },
  );

  // Enqueue a background download of a component into an audio bundle.
  app.post(
    '/v1/audio-models/download',
    {
      schema: {
        tags: ['audio'],
        summary: 'Enqueue a background download of an audio model component',
        description:
          'Returns a download task immediately. Track progress via GET /v1/audio-downloads/:id.',
        body: downloadSchema,
        response: { 202: audioDownloadTaskSchema, 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const task = app.audioDownloads.enqueue(req.body);
      return reply.code(202).send(task);
    },
  );

  // Delete a whole audio model bundle.
  app.delete<{ Params: { model: string } }>(
    '/v1/audio-models/:model',
    {
      schema: {
        tags: ['audio'],
        summary: 'Delete an audio model bundle',
        params: z.object({ model: z.string() }),
        response: { 200: z.object({ deleted: z.string() }), 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      await app.audioModels.deleteModel(req.params.model);
      return reply.send({ deleted: req.params.model });
    },
  );

  // Delete a single file within an audio bundle.
  app.delete<{ Params: { model: string; type: 'weights' | 'aux'; name: string } }>(
    '/v1/audio-models/:model/:type/:name',
    {
      schema: {
        tags: ['audio'],
        summary: 'Delete a single file within an audio bundle',
        params: z.object({ model: z.string(), type: componentType, name: z.string() }),
        response: { 200: z.object({ deleted: z.string() }), 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      await app.audioModels.deleteComponent(req.params.model, req.params.type, req.params.name);
      return reply.send({ deleted: `${req.params.model}/${req.params.type}/${req.params.name}` });
    },
  );
}
