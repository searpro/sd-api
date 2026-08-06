/** Where a component's files live on HuggingFace. */
export interface AudioCatalogSource {
  /** HuggingFace repo id, "owner/name". */
  repo: string;
  /** Optional sub-folder within the repo. */
  path?: string;
  /**
   * Optional case-insensitive substring the filename must contain. Used to
   * disambiguate when a repo folder holds several unrelated files.
   */
  match?: string;
}

export type AudioCatalogRole = 'weights' | 'aux';

export interface AudioCatalogComponent {
  role: AudioCatalogRole;
  label: string;
  required: boolean;
  /** Whether this component offers multiple quantizations to choose from. */
  quantizable: boolean;
  source: AudioCatalogSource;
}

export interface AudioCatalogModel {
  id: string;
  name: string;
  description?: string;
  /** audio.cpp family id (model_specs/<family>.json) — written into model.json on install. */
  family: string;
  /** e.g. "tts", "asr" — written into model.json on install. */
  task: string;
  mode?: 'offline' | 'streaming';
  /** Link to the model's HuggingFace page. */
  reference?: string;
  components: AudioCatalogComponent[];
}
