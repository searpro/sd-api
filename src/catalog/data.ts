import type { CatalogModel } from './types.js';

/**
 * Curated catalog of models supported by stable-diffusion.cpp, built from the
 * upstream docs (https://github.com/leejet/stable-diffusion.cpp/tree/master/docs).
 *
 * Each component points at a HuggingFace repo; the actual files and their
 * quantizations are listed live via the HF API (see hf.ts), so this data stays
 * small and does not go stale as new quants are published.
 */
const DOCS = 'https://github.com/leejet/stable-diffusion.cpp/blob/master/docs';

export const CATALOG: CatalogModel[] = [
  {
    id: 'z-image-turbo',
    name: 'Z-Image Turbo',
    description: 'Fast Z-Image variant; runs in ~4GB VRAM. Diffusion + VAE + Qwen3-4B.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/z_image.md`,
    defaults: { steps: 8, cfg_scale: 1, sampler: 'euler' },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'leejet/Z-Image-Turbo-GGUF' },
          safetensors: { repo: 'Comfy-Org/z_image_turbo', path: 'split_files/diffusion_models' },
        },
      },
      {
        role: 'vae',
        bundleType: 'vae',
        label: 'VAE (FLUX ae)',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'black-forest-labs/FLUX.1-schnell', match: 'ae' } },
      },
      {
        role: 'llm',
        bundleType: 'clip',
        label: 'Qwen3-4B text encoder',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF' },
          safetensors: { repo: 'Comfy-Org/z_image_turbo', path: 'split_files/text_encoders' },
        },
      },
    ],
  },
  {
    id: 'z-image',
    name: 'Z-Image (base)',
    description: 'Base Z-Image model. Diffusion + VAE + Qwen3-4B.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/z_image.md`,
    defaults: { cfg_scale: 5, sampler: 'euler' },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'unsloth/Z-Image-GGUF' },
          safetensors: { repo: 'Comfy-Org/z_image', path: 'split_files/diffusion_models' },
        },
      },
      {
        role: 'vae',
        bundleType: 'vae',
        label: 'VAE (FLUX ae)',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'black-forest-labs/FLUX.1-schnell', match: 'ae' } },
      },
      {
        role: 'llm',
        bundleType: 'clip',
        label: 'Qwen3-4B text encoder',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF' },
          safetensors: { repo: 'Comfy-Org/z_image', path: 'split_files/text_encoders' },
        },
      },
    ],
  },
  {
    id: 'flux1-dev',
    name: 'FLUX.1 dev',
    description: 'FLUX.1 dev. Diffusion + VAE + CLIP-L + T5-XXL.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/flux.md`,
    defaults: { cfg_scale: 1, sampler: 'euler' },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'leejet/FLUX.1-dev-gguf' },
          safetensors: { repo: 'black-forest-labs/FLUX.1-dev', match: 'flux1-dev' },
        },
      },
      {
        role: 'vae',
        bundleType: 'vae',
        label: 'VAE (ae)',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'black-forest-labs/FLUX.1-dev', match: 'ae' } },
      },
      {
        role: 'clip_l',
        bundleType: 'clip',
        label: 'CLIP-L',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'comfyanonymous/flux_text_encoders', match: 'clip_l' } },
      },
      {
        role: 't5xxl',
        bundleType: 'clip',
        label: 'T5-XXL',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'comfyanonymous/flux_text_encoders', match: 't5xxl' } },
      },
    ],
  },
  {
    id: 'flux1-schnell',
    name: 'FLUX.1 schnell',
    description: 'FLUX.1 schnell (4-step). Diffusion + VAE + CLIP-L + T5-XXL.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/flux.md`,
    defaults: { cfg_scale: 1, steps: 4, sampler: 'euler' },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'leejet/FLUX.1-schnell-gguf' },
          safetensors: { repo: 'black-forest-labs/FLUX.1-schnell', match: 'flux1-schnell' },
        },
      },
      {
        role: 'vae',
        bundleType: 'vae',
        label: 'VAE (ae)',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'black-forest-labs/FLUX.1-schnell', match: 'ae' } },
      },
      {
        role: 'clip_l',
        bundleType: 'clip',
        label: 'CLIP-L',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'comfyanonymous/flux_text_encoders', match: 'clip_l' } },
      },
      {
        role: 't5xxl',
        bundleType: 'clip',
        label: 'T5-XXL',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'comfyanonymous/flux_text_encoders', match: 't5xxl' } },
      },
    ],
  },
  {
    id: 'qwen-image',
    name: 'Qwen-Image',
    description: 'Qwen-Image. Diffusion + VAE + Qwen2.5-VL-7B.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/qwen_image.md`,
    defaults: { cfg_scale: 2.5, sampler: 'euler' },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'QuantStack/Qwen-Image-GGUF' },
          safetensors: { repo: 'Comfy-Org/Qwen-Image_ComfyUI', path: 'split_files/diffusion_models' },
        },
      },
      {
        role: 'vae',
        bundleType: 'vae',
        label: 'VAE',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'Comfy-Org/Qwen-Image_ComfyUI', path: 'split_files/vae' } },
      },
      {
        role: 'llm',
        bundleType: 'clip',
        label: 'Qwen2.5-VL-7B text encoder',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'mradermacher/Qwen2.5-VL-7B-Instruct-GGUF' },
          safetensors: { repo: 'Comfy-Org/Qwen-Image_ComfyUI', path: 'split_files/text_encoders' },
        },
      },
    ],
  },
  {
    id: 'chroma',
    name: 'Chroma',
    description: 'Chroma (FLUX-based). Diffusion + VAE + T5-XXL.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/chroma.md`,
    defaults: { cfg_scale: 4, sampler: 'euler' },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'silveroxides/Chroma-GGUF' },
          safetensors: { repo: 'lodestones/Chroma' },
        },
      },
      {
        role: 'vae',
        bundleType: 'vae',
        label: 'VAE (FLUX ae)',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'black-forest-labs/FLUX.1-dev', match: 'ae' } },
      },
      {
        role: 't5xxl',
        bundleType: 'clip',
        label: 'T5-XXL',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'comfyanonymous/flux_text_encoders', match: 't5xxl' } },
      },
    ],
  },
  {
    id: 'sd3.5-large',
    name: 'Stable Diffusion 3.5 Large',
    description: 'SD 3.5 Large (full checkpoint) + CLIP-G + CLIP-L + T5-XXL.',
    loadMode: 'model',
    reference: `${DOCS}/sd3.md`,
    defaults: { cfg_scale: 4.5, sampler: 'euler' },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Checkpoint',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'stabilityai/stable-diffusion-3.5-large', match: 'sd3.5_large' } },
      },
      {
        role: 'clip_g',
        bundleType: 'clip',
        label: 'CLIP-G',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'Comfy-Org/stable-diffusion-3.5-fp8', path: 'text_encoders', match: 'clip_g' } },
      },
      {
        role: 'clip_l',
        bundleType: 'clip',
        label: 'CLIP-L',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'Comfy-Org/stable-diffusion-3.5-fp8', path: 'text_encoders', match: 'clip_l' } },
      },
      {
        role: 't5xxl',
        bundleType: 'clip',
        label: 'T5-XXL',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'Comfy-Org/stable-diffusion-3.5-fp8', path: 'text_encoders', match: 't5xxl' } },
      },
    ],
  },
];
