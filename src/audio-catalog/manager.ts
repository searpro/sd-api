import type { FastifyBaseLogger } from 'fastify';
import { AUDIO_CATALOG } from './data.js';
import { listComponentFiles, type CatalogFile } from '../catalog/hf.js';
import type { AudioCatalogModel, AudioCatalogRole } from './types.js';

export interface AudioCatalogComponentSummary {
  role: AudioCatalogRole;
  label: string;
  required: boolean;
  quantizable: boolean;
}

export interface AudioCatalogModelSummary {
  id: string;
  name: string;
  description?: string;
  family: string;
  task: string;
  mode?: 'offline' | 'streaming';
  reference?: string;
  components: AudioCatalogComponentSummary[];
}

// This app's download infra fetches one file per component — same shard
// guard as the image/LLM catalogs, applied defensively here even though no
// audio.cpp GGUF package has been observed sharded yet.
const SHARD_RE = /-\d{5}-of-\d{5}\.gguf$/i;

export interface AudioComponentFiles {
  role: AudioCatalogRole;
  label: string;
  required: boolean;
  quantizable: boolean;
  files: CatalogFile[];
  error?: string;
}

export class AudioCatalogManager {
  constructor(private readonly log: FastifyBaseLogger) {}

  list(): AudioCatalogModelSummary[] {
    return AUDIO_CATALOG.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      family: m.family,
      task: m.task,
      mode: m.mode,
      reference: m.reference,
      components: m.components.map((c) => ({
        role: c.role,
        label: c.label,
        required: c.required,
        quantizable: c.quantizable,
      })),
    }));
  }

  get(id: string): AudioCatalogModel | undefined {
    return AUDIO_CATALOG.find((m) => m.id === id);
  }

  /** Resolve the selectable files for every component of a model via the HF API. */
  async files(id: string, signal?: AbortSignal): Promise<AudioComponentFiles[]> {
    const model = this.get(id);
    if (!model) throw new Error(`Unknown audio catalog model: ${id}`);

    return Promise.all(
      model.components.map(async (c) => {
        try {
          const raw = await listComponentFiles(c.source, 'gguf', signal);
          const files = raw.filter((f) => !SHARD_RE.test(f.filename));
          return { role: c.role, label: c.label, required: c.required, quantizable: c.quantizable, files };
        } catch (err) {
          this.log.warn(
            { model: id, role: c.role, err: (err as Error).message },
            'failed to list HuggingFace files for audio catalog model',
          );
          return {
            role: c.role,
            label: c.label,
            required: c.required,
            quantizable: c.quantizable,
            files: [],
            error: (err as Error).message,
          };
        }
      }),
    );
  }
}
