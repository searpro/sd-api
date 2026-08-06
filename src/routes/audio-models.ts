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

const voicePresetSchema = z
  .object({
    name: z.string().min(1),
    voice_ref: z.string().optional(),
    reference_text: z.string().optional(),
    makeDefault: z.boolean().optional(),
  })
  .passthrough();

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
          'code and can\'t infer either from files alone. Restarts audiocpp_server (regenerating ' +
          'its --config registry) before responding, so the change — including a new/updated ' +
          '`voicePresets` entry — is live immediately, not just "on the next restart".',
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
      try {
        await app.audio.restart();
      } catch (err) {
        req.log.warn(
          { model: req.params.model, err: (err as Error).message },
          'audiocpp_server restart after manifest write failed — model.json was saved, but the ' +
            'server may need a manual restart to serve it',
        );
      }
      return reply.send(bundle);
    },
  );

  // Register (or update) a single named voice preset without clobbering the
  // rest of the manifest — read-merge-write over writeManifest, since the
  // server config's `voice_presets` is per-model and audiocpp_server only
  // selects one per request via the OpenAI-shape `"voice"` request field
  // (confirmed against the real binary: cloning-only families like
  // Chatterbox ignore a bare `voice_ref` on the request itself — the
  // reference audio has to be pre-registered here, in model.json).
  app.post<{ Params: { model: string } }>(
    '/v1/audio-models/:model/voice-presets',
    {
      schema: {
        tags: ['audio'],
        summary: 'Register a named voice preset (e.g. a cloning reference WAV) on a model',
        description:
          'Merges into the existing model.json `voicePresets` (rather than replacing the whole ' +
          'manifest like PUT .../manifest) and restarts audiocpp_server so it\'s selectable ' +
          'immediately via `{"model", "input", "voice": "<name>"}` on /v1/audio/speech. Typically ' +
          '`voice_ref` is the `path` returned by POST /v1/audio-voice-refs.',
        params: z.object({ model: z.string() }),
        body: voicePresetSchema,
        response: {
          200: z.object({
            model: bundleSchema,
            voicePresets: z.array(z.string()),
            defaultVoicePreset: z.unknown().optional(),
          }),
          400: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const { name, makeDefault, ...presetFields } = req.body as z.infer<typeof voicePresetSchema>;
      const manifest = await app.audioModels.getManifest(req.params.model);
      if (!manifest) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_MODEL',
            message: `Audio model "${req.params.model}" has no model.json yet — set family/task first via PUT .../manifest`,
          },
        });
      }
      const voicePresets = { ...(manifest.voicePresets ?? {}), [name]: presetFields };
      const defaultVoicePreset =
        makeDefault || manifest.defaultVoicePreset === undefined ? name : manifest.defaultVoicePreset;
      await app.audioModels.writeManifest(req.params.model, { ...manifest, voicePresets, defaultVoicePreset });
      const bundle = await app.audioModels.get(req.params.model);
      if (!bundle) {
        return reply
          .code(400)
          .send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to write voice preset' } });
      }
      try {
        await app.audio.restart();
      } catch (err) {
        req.log.warn(
          { model: req.params.model, err: (err as Error).message },
          'audiocpp_server restart after voice preset write failed',
        );
      }
      return reply.send({ model: bundle, voicePresets: Object.keys(voicePresets), defaultVoicePreset });
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
