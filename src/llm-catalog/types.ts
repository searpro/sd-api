/** Where a component's files live on HuggingFace. Always GGUF for llama.cpp. */
export interface LlmCatalogSource {
  /** HuggingFace repo id, "owner/name". */
  repo: string;
  /** Optional sub-folder within the repo. */
  path?: string;
  /**
   * Optional case-insensitive substring the filename must contain. Used to
   * disambiguate when a repo holds several unrelated files.
   */
  match?: string;
}

export type LlmCatalogRole = 'gguf' | 'mmproj';

export interface LlmCatalogComponent {
  role: LlmCatalogRole;
  label: string;
  required: boolean;
  /** Whether this component offers multiple quantizations to choose from. */
  quantizable: boolean;
  source: LlmCatalogSource;
}

export interface LlmCatalogModel {
  id: string;
  name: string;
  description?: string;
  /**
   * Total parameter count in billions — this is what determines download
   * size and memory footprint (a MoE model keeps every expert resident in
   * memory even though only `activeParams` compute per token).
   */
  params: number;
  /**
   * Active parameters per token in billions, for sparse MoE models — this is
   * what actually drives inference speed/cost, and is usually far below
   * `params`. Omitted for dense models (active == total).
   */
  activeParams?: number;
  /**
   * Suggested deployment tier: 'mac' fits comfortably in ~24GB unified
   * memory at a reasonable quant; 'cloud' needs a real GPU; 'both' (default)
   * works reasonably on either. Advisory only — the live file listing always
   * shows every quant regardless of tier.
   */
  tier?: 'mac' | 'cloud' | 'both';
  /** Vision-language model: paired with an mmproj vision projector. */
  vision?: boolean;
  /** Model family, for grouping in the UI (e.g. "Llama", "Qwen"). */
  family: string;
  /** Link to the model's HuggingFace page. */
  reference?: string;
  components: LlmCatalogComponent[];
}
