import type { FastifyBaseLogger } from 'fastify';
import { LLM_CATALOG } from './data.js';
import { listComponentFiles, type CatalogFile } from '../catalog/hf.js';
import { isMmproj } from '../llm-models/bundle.js';
import type { LlmCatalogModel, LlmCatalogRole } from './types.js';

export interface LlmCatalogComponentSummary {
  role: LlmCatalogRole;
  label: string;
  required: boolean;
  quantizable: boolean;
}

export interface LlmCatalogModelSummary {
  id: string;
  name: string;
  description?: string;
  params: number;
  vision: boolean;
  family: string;
  reference?: string;
  components: LlmCatalogComponentSummary[];
}

export interface LlmComponentFiles {
  role: LlmCatalogRole;
  label: string;
  required: boolean;
  quantizable: boolean;
  files: CatalogFile[];
  error?: string;
}

export class LlmCatalogManager {
  constructor(private readonly log: FastifyBaseLogger) {}

  list(): LlmCatalogModelSummary[] {
    return LLM_CATALOG.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      params: m.params,
      vision: m.vision ?? false,
      family: m.family,
      reference: m.reference,
      components: m.components.map((c) => ({
        role: c.role,
        label: c.label,
        required: c.required,
        quantizable: c.quantizable,
      })),
    }));
  }

  get(id: string): LlmCatalogModel | undefined {
    return LLM_CATALOG.find((m) => m.id === id);
  }

  /** Resolve the selectable GGUF files for every component of a model via the HF API. */
  async files(id: string, signal?: AbortSignal): Promise<LlmComponentFiles[]> {
    const model = this.get(id);
    if (!model) throw new Error(`Unknown LLM catalog model: ${id}`);

    return Promise.all(
      model.components.map(async (c) => {
        try {
          const raw = await listComponentFiles(c.source, 'gguf', signal);
          // A "gguf" (weights) component's source has no `match` filter, so
          // without this it would also pull in the repo's mmproj-*.gguf
          // vision-projector files (which live alongside the weights in the
          // same repo) as bogus "weights" options.
          const files = c.role === 'gguf' ? raw.filter((f) => !isMmproj(f.filename)) : raw;
          return { role: c.role, label: c.label, required: c.required, quantizable: c.quantizable, files };
        } catch (err) {
          this.log.warn(
            { model: id, role: c.role, err: (err as Error).message },
            'failed to list HuggingFace files for LLM catalog model',
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
