import type { ClipRole } from '../models/bundle.js';

/** Weight file formats users can choose between. */
export type Format = 'safetensors' | 'gguf';

/** A component role within a catalog model. Maps to a bundle component. */
export type CatalogRole = 'checkpoint' | 'vae' | ClipRole;

/** Where a component's files live on HuggingFace, per format. */
export interface CatalogSource {
  /** HuggingFace repo id, "owner/name". */
  repo: string;
  /** Optional sub-folder within the repo (e.g. "split_files/diffusion_models"). */
  path?: string;
  /**
   * Optional case-insensitive substring the filename must contain. Used to
   * disambiguate when a repo holds several unrelated files (e.g. "ae" to pick
   * the VAE, "clip_l" to pick the CLIP-L encoder).
   */
  match?: string;
}

export interface CatalogComponent {
  role: CatalogRole;
  /** Bundle sub-directory the downloaded file goes into. */
  bundleType: 'checkpoint' | 'vae' | 'clip';
  label: string;
  required: boolean;
  /** Whether this component offers multiple quantizations to choose from. */
  quantizable: boolean;
  sources: Partial<Record<Format, CatalogSource>>;
}

export interface CatalogModel {
  id: string;
  name: string;
  description?: string;
  /** How sd-cli loads the checkpoint. */
  loadMode: 'model' | 'diffusion-model';
  /** Link to the upstream documentation page. */
  reference?: string;
  defaults?: {
    steps?: number;
    cfg_scale?: number;
    width?: number;
    height?: number;
    sampler?: string;
    negative_prompt?: string;
  };
  components: CatalogComponent[];
}
