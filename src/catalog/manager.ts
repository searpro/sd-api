import type { FastifyBaseLogger } from 'fastify';
import { CATALOG } from './data.js';
import { listComponentFiles, type CatalogFile } from './hf.js';
import type { CatalogModel, Format } from './types.js';

export interface CatalogComponentSummary {
  role: string;
  bundleType: 'checkpoint' | 'vae' | 'clip';
  label: string;
  required: boolean;
  quantizable: boolean;
  formats: Format[];
}

export interface CatalogModelSummary {
  id: string;
  name: string;
  description?: string;
  loadMode: 'model' | 'diffusion-model';
  reference?: string;
  defaults?: CatalogModel['defaults'];
  components: CatalogComponentSummary[];
}

export interface ComponentFiles {
  role: string;
  bundleType: 'checkpoint' | 'vae' | 'clip';
  label: string;
  required: boolean;
  quantizable: boolean;
  /** Available files keyed by format. */
  files: Partial<Record<Format, CatalogFile[]>>;
  /** Per-format errors (e.g. HF unreachable), if any. */
  errors?: Partial<Record<Format, string>>;
}

export class CatalogManager {
  constructor(private readonly log: FastifyBaseLogger) {}

  list(): CatalogModelSummary[] {
    return CATALOG.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      loadMode: m.loadMode,
      reference: m.reference,
      defaults: m.defaults,
      components: m.components.map((c) => ({
        role: c.role,
        bundleType: c.bundleType,
        label: c.label,
        required: c.required,
        quantizable: c.quantizable,
        formats: Object.keys(c.sources) as Format[],
      })),
    }));
  }

  get(id: string): CatalogModel | undefined {
    return CATALOG.find((m) => m.id === id);
  }

  /** Resolve the selectable files for every component of a model via the HF API. */
  async files(id: string, signal?: AbortSignal): Promise<ComponentFiles[]> {
    const model = this.get(id);
    if (!model) throw new Error(`Unknown catalog model: ${id}`);

    return Promise.all(
      model.components.map(async (c) => {
        const files: ComponentFiles['files'] = {};
        const errors: ComponentFiles['errors'] = {};
        await Promise.all(
          (Object.entries(c.sources) as [Format, NonNullable<(typeof c.sources)[Format]>][]).map(
            async ([format, source]) => {
              try {
                files[format] = await listComponentFiles(source, format, signal);
              } catch (err) {
                this.log.warn(
                  { model: id, role: c.role, format, err: (err as Error).message },
                  'failed to list HuggingFace files',
                );
                errors[format] = (err as Error).message;
              }
            },
          ),
        );
        return {
          role: c.role,
          bundleType: c.bundleType,
          label: c.label,
          required: c.required,
          quantizable: c.quantizable,
          files,
          ...(Object.keys(errors).length > 0 ? { errors } : {}),
        };
      }),
    );
  }
}
