import type { FastifyInstance } from 'fastify';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { safeResolve } from '../util/paths.js';
import { errors } from '../errors.js';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/**
 * Input image storage (for img2img / edit). Images are uploaded here and then
 * referenced by name in a generation request (init_image / mask / ref_images).
 */
export async function inputRoutes(app: FastifyInstance): Promise<void> {
  // Upload one or more input images (multipart/form-data).
  app.post(
    '/v1/inputs',
    {
      schema: {
        tags: ['inputs'],
        summary: 'Upload input image(s) for img2img / editing',
        consumes: ['multipart/form-data'],
      },
    },
    async (req, reply) => {
      if (!req.isMultipart()) {
        throw errors.invalidPath('Expected multipart/form-data upload');
      }
      await mkdir(app.config.inputsDir, { recursive: true });

      const saved: { name: string; size: number }[] = [];
      for await (const part of req.files()) {
        const ext = extname(part.filename || '').toLowerCase();
        if (!IMAGE_EXT.has(ext)) {
          throw errors.invalidPath(
            `Unsupported image type "${ext || 'unknown'}". Allowed: ${[...IMAGE_EXT].join(', ')}`,
          );
        }
        const name = `${randomUUID()}${ext}`;
        const path = safeResolve(app.config.inputsDir, name);
        await pipeline(part.file, createWriteStream(path));
        if (part.file.truncated) {
          throw errors.invalidPath('Uploaded file exceeds the size limit');
        }
        const s = await stat(path);
        saved.push({ name, size: s.size });
      }

      if (saved.length === 0) throw errors.invalidPath('No files in upload');
      return reply.code(201).send({ inputs: saved });
    },
  );

  // Serve an uploaded input image (for UI preview).
  app.get<{ Params: { name: string } }>(
    '/v1/inputs/:name',
    {
      schema: { tags: ['inputs'], summary: 'Fetch an uploaded input image' },
    },
    async (req, reply) => {
      const path = safeResolve(app.config.inputsDir, req.params.name);
      try {
        const s = await stat(path);
        if (!s.isFile()) throw new Error('not a file');
      } catch {
        throw errors.inputNotFound(req.params.name);
      }
      reply.header('Content-Type', MIME[extname(req.params.name).toLowerCase()] ?? 'application/octet-stream');
      return reply.send(createReadStream(path));
    },
  );
}
