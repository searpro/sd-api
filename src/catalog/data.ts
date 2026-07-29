import type { CatalogModel } from './types.js';

/**
 * Curated catalog of text-to-image models supported by stable-diffusion.cpp,
 * built from the upstream docs:
 *   https://github.com/leejet/stable-diffusion.cpp/tree/master/docs
 *
 * Each component points at a HuggingFace repo; the actual files and their
 * quantizations are listed live via the HF API (see hf.ts), so this data stays
 * small and does not go stale as new quants are published.
 *
 * Scope: txt2img models only. Image-edit models (Kontext, Qwen-Image-Edit,
 * LongCat/Boogu Edit), video models (Wan, LTX-2.3), PiD (requires a reference
 * image) and Ideogram4 (needs an unconditional diffusion model) are omitted
 * because the generation pipeline here is txt2img.
 */
const DOCS = 'https://github.com/leejet/stable-diffusion.cpp/blob/master/docs';

// --- Shared component sources -------------------------------------------------
const FLUX1_AE = { repo: 'black-forest-labs/FLUX.1-dev', match: 'ae' };
const FLUX1_SCHNELL_AE = { repo: 'black-forest-labs/FLUX.1-schnell', match: 'ae' };
const FLUX2_AE = { repo: 'black-forest-labs/FLUX.2-dev', match: 'ae' };
const FLUX_TEXT_ENCODERS = 'comfyanonymous/flux_text_encoders';

export const CATALOG: CatalogModel[] = [
  // ===== Classic full checkpoints (single file, -m) ==========================
  {
    id: 'sd1.5',
    name: 'Stable Diffusion 1.5',
    description: 'Classic SD 1.5 full checkpoint.',
    loadMode: 'model',
    reference: `${DOCS}/sd.md`,
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Checkpoint',
        required: true,
        quantizable: false,
        sources: {
          safetensors: { repo: 'stable-diffusion-v1-5/stable-diffusion-v1-5', match: 'v1-5-pruned-emaonly' },
        },
      },
    ],
  },
  {
    id: 'sd2.1',
    name: 'Stable Diffusion 2.1',
    description: 'SD 2.1 768 full checkpoint.',
    loadMode: 'model',
    reference: `${DOCS}/sd.md`,
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Checkpoint',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'stabilityai/stable-diffusion-2-1', match: 'v2-1_768-ema-pruned' } },
      },
    ],
  },
  {
    id: 'sdxl-base',
    name: 'SDXL base 1.0',
    description: 'SDXL base 1.0. Optional fp16-fix VAE recommended.',
    loadMode: 'model',
    reference: `${DOCS}/sd.md`,
    defaults: { width: 1024, height: 1024 },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Checkpoint',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'stabilityai/stable-diffusion-xl-base-1.0', match: 'sd_xl_base_1.0' } },
      },
      {
        role: 'vae',
        bundleType: 'vae',
        label: 'VAE (fp16-fix, optional)',
        required: false,
        quantizable: false,
        sources: { safetensors: { repo: 'madebyollin/sdxl-vae-fp16-fix', match: 'sdxl_vae' } },
      },
    ],
  },
  {
    id: 'sdxl-turbo',
    name: 'SDXL Turbo',
    description: 'SDXL Turbo (1-4 steps, cfg ~1).',
    loadMode: 'model',
    reference: `${DOCS}/sd.md`,
    defaults: { width: 1024, height: 1024, cfg_scale: 1, steps: 4 },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Checkpoint',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'stabilityai/sdxl-turbo', match: 'sd_xl_turbo_1.0_fp16' } },
      },
    ],
  },
  {
    id: 'ssd-1b',
    name: 'SSD-1B (distilled SDXL)',
    description: 'Segmind SSD-1B, a distilled SDXL with a smaller U-Net.',
    loadMode: 'model',
    reference: `${DOCS}/distilled_sd.md`,
    defaults: { width: 1024, height: 1024 },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Checkpoint',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'segmind/SSD-1B', match: 'a1111' } },
      },
    ],
  },
  {
    id: 'segmind-vega',
    name: 'Segmind Vega (distilled SDXL)',
    description: 'Segmind Vega, a small distilled SDXL.',
    loadMode: 'model',
    reference: `${DOCS}/distilled_sd.md`,
    defaults: { width: 1024, height: 1024 },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Checkpoint',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'segmind/Segmind-Vega', match: 'segmind-vega' } },
      },
    ],
  },
  {
    id: 'sd3-medium',
    name: 'Stable Diffusion 3 Medium',
    description: 'SD3 Medium, all-in-one checkpoint (includes CLIP + T5).',
    loadMode: 'model',
    reference: `${DOCS}/sd3.md`,
    defaults: { width: 1024, height: 1024, cfg_scale: 4.5, sampler: 'euler' },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Checkpoint (incl. clips + t5xxl)',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'stabilityai/stable-diffusion-3-medium', match: 'sd3_medium_incl_clips_t5xxlfp16' } },
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
  {
    id: 'hidream-o1-image',
    name: 'HiDream-O1-Image',
    description: 'HiDream-O1-Image (dev / base full checkpoints).',
    loadMode: 'model',
    reference: `${DOCS}/hidream_o1_image.md`,
    defaults: { width: 1024, height: 1024, cfg_scale: 1 },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Checkpoint (dev or base)',
        required: true,
        quantizable: true,
        sources: { safetensors: { repo: 'Comfy-Org/HiDream-O1-Image', path: 'checkpoints' } },
      },
    ],
  },

  // ===== FLUX.1 ==============================================================
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
      { role: 'vae', bundleType: 'vae', label: 'VAE (ae)', required: true, quantizable: false, sources: { safetensors: FLUX1_AE } },
      { role: 'clip_l', bundleType: 'clip', label: 'CLIP-L', required: true, quantizable: false, sources: { safetensors: { repo: FLUX_TEXT_ENCODERS, match: 'clip_l' } } },
      { role: 't5xxl', bundleType: 'clip', label: 'T5-XXL', required: true, quantizable: false, sources: { safetensors: { repo: FLUX_TEXT_ENCODERS, match: 't5xxl' } } },
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
      { role: 'vae', bundleType: 'vae', label: 'VAE (ae)', required: true, quantizable: false, sources: { safetensors: FLUX1_SCHNELL_AE } },
      { role: 'clip_l', bundleType: 'clip', label: 'CLIP-L', required: true, quantizable: false, sources: { safetensors: { repo: FLUX_TEXT_ENCODERS, match: 'clip_l' } } },
      { role: 't5xxl', bundleType: 'clip', label: 'T5-XXL', required: true, quantizable: false, sources: { safetensors: { repo: FLUX_TEXT_ENCODERS, match: 't5xxl' } } },
    ],
  },

  // ===== FLUX.2 ==============================================================
  {
    id: 'flux2-dev',
    name: 'FLUX.2 dev',
    description: 'FLUX.2 dev. Diffusion + FLUX.2 VAE + Mistral-Small-3.2-24B.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/flux2.md`,
    defaults: { cfg_scale: 1, sampler: 'euler' },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: { gguf: { repo: 'city96/FLUX.2-dev-gguf' } },
      },
      { role: 'vae', bundleType: 'vae', label: 'VAE (FLUX.2 ae)', required: true, quantizable: false, sources: { safetensors: FLUX2_AE } },
      {
        role: 'llm',
        bundleType: 'clip',
        label: 'Mistral-Small-3.2-24B text encoder',
        required: true,
        quantizable: true,
        sources: { gguf: { repo: 'unsloth/Mistral-Small-3.2-24B-Instruct-2506-GGUF' } },
      },
    ],
  },
  {
    id: 'flux2-klein-4b',
    name: 'FLUX.2 klein 4B',
    description: 'FLUX.2 klein 4B. Diffusion + FLUX.2 VAE + Qwen3-4B.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/flux2.md`,
    defaults: { cfg_scale: 1, steps: 4, sampler: 'euler' },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'leejet/FLUX.2-klein-4B-GGUF' },
          safetensors: { repo: 'black-forest-labs/FLUX.2-klein-4B' },
        },
      },
      { role: 'vae', bundleType: 'vae', label: 'VAE (FLUX.2 ae)', required: true, quantizable: false, sources: { safetensors: FLUX2_AE } },
      {
        role: 'llm',
        bundleType: 'clip',
        label: 'Qwen3-4B text encoder',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'unsloth/Qwen3-4B-GGUF' },
          safetensors: { repo: 'Comfy-Org/flux2-klein-4B', path: 'split_files/text_encoders' },
        },
      },
    ],
  },
  {
    id: 'flux2-klein-9b',
    name: 'FLUX.2 klein 9B',
    description: 'FLUX.2 klein 9B. Diffusion + FLUX.2 VAE + Qwen3-8B.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/flux2.md`,
    defaults: { cfg_scale: 1, steps: 4, sampler: 'euler' },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'leejet/FLUX.2-klein-9B-GGUF' },
          safetensors: { repo: 'black-forest-labs/FLUX.2-klein-9B' },
        },
      },
      { role: 'vae', bundleType: 'vae', label: 'VAE (FLUX.2 ae)', required: true, quantizable: false, sources: { safetensors: FLUX2_AE } },
      {
        role: 'llm',
        bundleType: 'clip',
        label: 'Qwen3-8B text encoder',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'unsloth/Qwen3-8B-GGUF' },
          safetensors: { repo: 'Comfy-Org/flux2-klein-9B', path: 'split_files/text_encoders' },
        },
      },
    ],
  },

  // ===== Chroma ==============================================================
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
        sources: { gguf: { repo: 'silveroxides/Chroma-GGUF' }, safetensors: { repo: 'lodestones/Chroma' } },
      },
      { role: 'vae', bundleType: 'vae', label: 'VAE (FLUX ae)', required: true, quantizable: false, sources: { safetensors: FLUX1_AE } },
      { role: 't5xxl', bundleType: 'clip', label: 'T5-XXL', required: true, quantizable: false, sources: { safetensors: { repo: FLUX_TEXT_ENCODERS, match: 't5xxl' } } },
    ],
  },
  {
    id: 'chroma1-radiance',
    name: 'Chroma1-Radiance',
    description: 'Chroma1-Radiance — VAE-less (decodes directly to RGB). Diffusion + T5-XXL.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/chroma_radiance.md`,
    defaults: { cfg_scale: 4, sampler: 'euler' },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: { gguf: { repo: 'silveroxides/Chroma1-Radiance-GGUF' }, safetensors: { repo: 'lodestones/Chroma1-Radiance' } },
      },
      { role: 't5xxl', bundleType: 'clip', label: 'T5-XXL', required: true, quantizable: false, sources: { safetensors: { repo: FLUX_TEXT_ENCODERS, match: 't5xxl' } } },
    ],
  },

  // ===== Lens ================================================================
  {
    id: 'lens',
    name: 'Lens',
    description: 'Lens / Lens Turbo. Diffusion + FLUX.2 VAE + GPT-OSS-20B. Pick the file in the dropdown.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/lens.md`,
    defaults: { cfg_scale: 5 },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model (lens / lens_turbo)',
        required: true,
        quantizable: true,
        sources: { safetensors: { repo: 'Comfy-Org/Lens', path: 'diffusion_models' } },
      },
      { role: 'vae', bundleType: 'vae', label: 'VAE (FLUX.2 ae)', required: true, quantizable: false, sources: { safetensors: FLUX2_AE } },
      {
        role: 'llm',
        bundleType: 'clip',
        label: 'GPT-OSS-20B text encoder',
        required: true,
        quantizable: true,
        sources: { gguf: { repo: 'unsloth/gpt-oss-20b-GGUF' } },
      },
    ],
  },

  // ===== Qwen-Image ==========================================================
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
      { role: 'vae', bundleType: 'vae', label: 'VAE', required: true, quantizable: false, sources: { safetensors: { repo: 'Comfy-Org/Qwen-Image_ComfyUI', path: 'split_files/vae' } } },
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

  // ===== Image-edit models (require reference image[s], -r) ==================
  {
    id: 'flux1-kontext-dev',
    name: 'FLUX.1 Kontext dev (edit)',
    description: 'FLUX.1 Kontext image editing. Provide a reference image.',
    loadMode: 'diffusion-model',
    edit: true,
    reference: `${DOCS}/kontext.md`,
    defaults: { cfg_scale: 1, sampler: 'euler' },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'QuantStack/FLUX.1-Kontext-dev-GGUF' },
          safetensors: { repo: 'black-forest-labs/FLUX.1-Kontext-dev', match: 'flux1-kontext-dev' },
        },
      },
      { role: 'vae', bundleType: 'vae', label: 'VAE (ae)', required: true, quantizable: false, sources: { safetensors: FLUX1_AE } },
      { role: 'clip_l', bundleType: 'clip', label: 'CLIP-L', required: true, quantizable: false, sources: { safetensors: { repo: FLUX_TEXT_ENCODERS, match: 'clip_l' } } },
      { role: 't5xxl', bundleType: 'clip', label: 'T5-XXL', required: true, quantizable: false, sources: { safetensors: { repo: FLUX_TEXT_ENCODERS, match: 't5xxl' } } },
    ],
  },
  {
    id: 'qwen-image-edit',
    name: 'Qwen-Image-Edit (edit)',
    description: 'Qwen-Image editing. Provide a reference image.',
    loadMode: 'diffusion-model',
    edit: true,
    reference: `${DOCS}/qwen_image_edit.md`,
    defaults: { cfg_scale: 2.5, sampler: 'euler' },
    extraArgs: ['--flow-shift', '3'],
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'QuantStack/Qwen-Image-Edit-GGUF' },
          safetensors: { repo: 'Comfy-Org/Qwen-Image-Edit_ComfyUI', path: 'split_files/diffusion_models', match: 'edit' },
        },
      },
      { role: 'vae', bundleType: 'vae', label: 'VAE', required: true, quantizable: false, sources: { safetensors: { repo: 'Comfy-Org/Qwen-Image_ComfyUI', path: 'split_files/vae' } } },
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
    id: 'qwen-image-edit-2509',
    name: 'Qwen-Image-Edit 2509 (multi-ref edit)',
    description: 'Qwen-Image-Edit 2509 — supports multiple reference images. With a GGUF text encoder, also add the mmproj (llm_vision).',
    loadMode: 'diffusion-model',
    edit: true,
    reference: `${DOCS}/qwen_image_edit.md`,
    defaults: { cfg_scale: 2.5, sampler: 'euler' },
    extraArgs: ['--flow-shift', '3'],
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'QuantStack/Qwen-Image-Edit-2509-GGUF' },
          safetensors: { repo: 'Comfy-Org/Qwen-Image-Edit_ComfyUI', path: 'split_files/diffusion_models', match: '2509' },
        },
      },
      { role: 'vae', bundleType: 'vae', label: 'VAE', required: true, quantizable: false, sources: { safetensors: { repo: 'Comfy-Org/Qwen-Image_ComfyUI', path: 'split_files/vae' } } },
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
      {
        role: 'llm_vision',
        bundleType: 'clip',
        label: 'mmproj (only with GGUF text encoder)',
        required: false,
        quantizable: true,
        sources: { gguf: { repo: 'mradermacher/Qwen2.5-VL-7B-Instruct-GGUF', match: 'mmproj' } },
      },
    ],
  },
  {
    id: 'qwen-image-edit-2511',
    name: 'Qwen-Image-Edit 2511 (edit)',
    description: 'Qwen-Image-Edit 2511. Runs with --qwen-image-zero-cond-t (set automatically).',
    loadMode: 'diffusion-model',
    edit: true,
    reference: `${DOCS}/qwen_image_edit.md`,
    defaults: { cfg_scale: 2.5, sampler: 'euler' },
    extraArgs: ['--flow-shift', '3', '--qwen-image-zero-cond-t'],
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'unsloth/Qwen-Image-Edit-2511-GGUF' },
          safetensors: { repo: 'Comfy-Org/Qwen-Image-Edit_ComfyUI', path: 'split_files/diffusion_models', match: '2511' },
        },
      },
      { role: 'vae', bundleType: 'vae', label: 'VAE', required: true, quantizable: false, sources: { safetensors: { repo: 'Comfy-Org/Qwen-Image_ComfyUI', path: 'split_files/vae' } } },
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
    id: 'mage-flow-edit-turbo',
    name: 'Mage-Flow Edit Turbo (edit)',
    description:
      'Fast Mage-Flow instruction-based image editing (4 steps). Provide reference image(s). Diffusion + Mage-VAE + Qwen3-VL-4B.',
    loadMode: 'diffusion-model',
    edit: true,
    reference: `${DOCS}/mage_flow.md`,
    defaults: { steps: 4, cfg_scale: 1 },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: { safetensors: { repo: 'microsoft/Mage-Flow-Edit-Turbo', path: 'transformer' } },
      },
      {
        role: 'vae',
        bundleType: 'vae',
        label: 'VAE (Mage-VAE)',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'microsoft/Mage-Flow', path: 'vae' } },
      },
      {
        role: 'llm',
        bundleType: 'clip',
        label: 'Qwen3-VL-4B text encoder',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'Qwen/Qwen3-VL-4B-Instruct-GGUF' },
          safetensors: { repo: 'Comfy-Org/Krea-2', path: 'text_encoders' },
        },
      },
      {
        role: 'llm_vision',
        bundleType: 'clip',
        label: 'mmproj (only with GGUF text encoder)',
        required: false,
        quantizable: true,
        sources: { gguf: { repo: 'Qwen/Qwen3-VL-4B-Instruct-GGUF', match: 'mmproj' } },
      },
    ],
  },

  // ===== LongCat / Ovis / Anima / ERNIE / Boogu ==============================
  {
    id: 'longcat-image',
    name: 'LongCat-Image',
    description: 'LongCat-Image. Diffusion + FLUX VAE + Qwen2.5-VL-7B.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/longcat_image.md`,
    defaults: { cfg_scale: 5, sampler: 'euler' },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'vantagewithai/LongCat-Image-GGUF', path: 'comfy' },
          safetensors: { repo: 'Comfy-Org/LongCat-Image', path: 'split_files/diffusion_models' },
        },
      },
      { role: 'vae', bundleType: 'vae', label: 'VAE (FLUX ae)', required: true, quantizable: false, sources: { safetensors: FLUX1_AE } },
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
    id: 'ovis-image',
    name: 'Ovis-Image-7B',
    description: 'Ovis-Image-7B. Diffusion + FLUX VAE + Ovis2.5.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/ovis_image.md`,
    defaults: { cfg_scale: 5 },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'leejet/Ovis-Image-7B-GGUF' },
          safetensors: { repo: 'Comfy-Org/Ovis-Image', path: 'split_files/diffusion_models' },
        },
      },
      { role: 'vae', bundleType: 'vae', label: 'VAE (FLUX ae)', required: true, quantizable: false, sources: { safetensors: FLUX1_SCHNELL_AE } },
      {
        role: 'llm',
        bundleType: 'clip',
        label: 'Ovis2.5 text encoder',
        required: true,
        quantizable: false,
        sources: { safetensors: { repo: 'Comfy-Org/Ovis-Image', path: 'split_files/text_encoders' } },
      },
    ],
  },
  {
    id: 'anima',
    name: 'Anima',
    description: 'Anima. Diffusion + VAE + Qwen3-0.6B-Base.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/anima.md`,
    defaults: { cfg_scale: 6, sampler: 'euler' },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'Bedovyy/Anima-GGUF' },
          safetensors: { repo: 'circlestone-labs/Anima', path: 'split_files/diffusion_models' },
        },
      },
      { role: 'vae', bundleType: 'vae', label: 'VAE', required: true, quantizable: false, sources: { safetensors: { repo: 'circlestone-labs/Anima', path: 'split_files/vae' } } },
      {
        role: 'llm',
        bundleType: 'clip',
        label: 'Qwen3-0.6B-Base text encoder',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'mradermacher/Qwen3-0.6B-Base-GGUF' },
          safetensors: { repo: 'circlestone-labs/Anima', path: 'split_files/text_encoders' },
        },
      },
    ],
  },
  {
    id: 'ernie-image-turbo',
    name: 'ERNIE-Image Turbo',
    description: 'ERNIE-Image Turbo (8 steps). Diffusion + VAE + Ministral-3B.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/ernie_image.md`,
    defaults: { cfg_scale: 1, steps: 8 },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'unsloth/ERNIE-Image-Turbo-GGUF' },
          safetensors: { repo: 'Comfy-Org/ERNIE-Image', path: 'diffusion_models', match: 'turbo' },
        },
      },
      { role: 'vae', bundleType: 'vae', label: 'VAE', required: true, quantizable: false, sources: { safetensors: { repo: 'Comfy-Org/ERNIE-Image', path: 'vae' } } },
      {
        role: 'llm',
        bundleType: 'clip',
        label: 'Ministral-3B text encoder',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'unsloth/Ministral-3-3B-Instruct-2512-GGUF' },
          safetensors: { repo: 'Comfy-Org/ERNIE-Image', path: 'text_encoders' },
        },
      },
    ],
  },
  {
    id: 'ernie-image',
    name: 'ERNIE-Image',
    description: 'ERNIE-Image. Diffusion + VAE + Ministral-3B.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/ernie_image.md`,
    defaults: { cfg_scale: 5 },
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'unsloth/ERNIE-Image-GGUF' },
          safetensors: { repo: 'Comfy-Org/ERNIE-Image', path: 'diffusion_models' },
        },
      },
      { role: 'vae', bundleType: 'vae', label: 'VAE', required: true, quantizable: false, sources: { safetensors: { repo: 'Comfy-Org/ERNIE-Image', path: 'vae' } } },
      {
        role: 'llm',
        bundleType: 'clip',
        label: 'Ministral-3B text encoder',
        required: true,
        quantizable: true,
        sources: {
          gguf: { repo: 'unsloth/Ministral-3-3B-Instruct-2512-GGUF' },
          safetensors: { repo: 'Comfy-Org/ERNIE-Image', path: 'text_encoders' },
        },
      },
    ],
  },
  {
    id: 'boogu-image',
    name: 'Boogu-Image',
    description: 'Boogu-Image (base). Diffusion + FLUX VAE + Qwen3-VL-8B.',
    loadMode: 'diffusion-model',
    reference: `${DOCS}/boogu_image.md`,
    components: [
      {
        role: 'checkpoint',
        bundleType: 'checkpoint',
        label: 'Diffusion model (base)',
        required: true,
        quantizable: true,
        sources: { safetensors: { repo: 'Comfy-Org/Boogu-Image', path: 'diffusion_models', match: 'base' } },
      },
      { role: 'vae', bundleType: 'vae', label: 'VAE (FLUX ae)', required: true, quantizable: false, sources: { safetensors: FLUX1_AE } },
      {
        role: 'llm',
        bundleType: 'clip',
        label: 'Qwen3-VL-8B text encoder',
        required: true,
        quantizable: true,
        sources: { gguf: { repo: 'unsloth/Qwen3-VL-8B-Instruct-GGUF' } },
      },
    ],
  },

  // ===== Z-Image =============================================================
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
      { role: 'vae', bundleType: 'vae', label: 'VAE (FLUX ae)', required: true, quantizable: false, sources: { safetensors: FLUX1_SCHNELL_AE } },
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
      { role: 'vae', bundleType: 'vae', label: 'VAE (FLUX ae)', required: true, quantizable: false, sources: { safetensors: FLUX1_SCHNELL_AE } },
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
];
