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
  activeParams?: number;
  tier: 'mac' | 'cloud' | 'both';
  vision: boolean;
  family: string;
  reference?: string;
  components: LlmCatalogComponentSummary[];
}

// Some newer model repos (Qwen3.6, Gemma 4, gpt-oss, GLM ...) ship extra
// speculative-decoding draft-model files alongside the real weights —
// "mtp-" (multi-token-prediction draft), "dflash-"/"eagle3-" (draft heads
// for speculative decoding). None of these are usable as the main "weights"
// component; without stripping them a user could pick one by mistake and
// download a broken, non-functional bundle.
const AUX_DRAFT_RE = /^(mtp|dflash|eagle3?)-/i;

// This app's download infra fetches one file per component — it has no
// concept of a multi-part download. Some repos publish a quant as
// "-00001-of-00003.gguf" shards (alongside other, single-file quants of the
// same model) once the file crosses ~50GB; surfacing a lone shard as a
// pickable option would let a user "install" a silently truncated, unusable
// model. Filtered out for every role, not just weights.
const SHARD_RE = /-\d{5}-of-\d{5}\.gguf$/i;

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
      activeParams: m.activeParams,
      tier: m.tier ?? 'both',
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
          const noShards = raw.filter((f) => !SHARD_RE.test(f.filename));
          // A "gguf" (weights) component's source has no `match` filter, so
          // without this it would also pull in the repo's mmproj-*.gguf
          // vision-projector files and any speculative-decoding draft files
          // (which live alongside the weights in the same repo) as bogus
          // "weights" options.
          const files =
            c.role === 'gguf'
              ? noShards.filter((f) => !isMmproj(f.filename) && !AUX_DRAFT_RE.test(f.filename))
              : noShards;
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
