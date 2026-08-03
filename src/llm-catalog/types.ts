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
  /** Parameter count in billions, for display/sorting (always < 30 in this catalog). */
  params: number;
  /** Vision-language model: paired with an mmproj vision projector. */
  vision?: boolean;
  /** Model family, for grouping in the UI (e.g. "Llama", "Qwen"). */
  family: string;
  /** Link to the model's HuggingFace page. */
  reference?: string;
  components: LlmCatalogComponent[];
}
