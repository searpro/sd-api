import type { LlmCatalogModel } from './types.js';

const HF = 'https://huggingface.co';

/**
 * Curated catalog of popular open-weight LLMs (< 30B params) with quantized
 * GGUF releases, for use with `llama-server` (see src/llm/). Repos are
 * verified to exist and carry real .gguf files; the actual file/quant
 * listing is resolved **live** via the HuggingFace Hub API
 * (src/catalog/hf.ts, shared with the image-model catalog) — no filenames
 * are hardcoded here, only repo ids.
 *
 * Sourced primarily from bartowski's and ggml-org's GGUF conversions (the
 * two most consistently up-to-date/complete quantizer accounts on HF for
 * llama.cpp). Vision-language entries pair a `gguf` weights component with
 * an `mmproj` vision-projector component from the same repo.
 */
export const LLM_CATALOG: LlmCatalogModel[] = [
  // ---- Llama ----
  {
    id: 'llama-3.2-1b-instruct',
    name: 'Llama 3.2 1B Instruct',
    description: 'Meta’s smallest Llama 3.2 instruct model — fast, low-memory.',
    params: 1,
    family: 'Llama',
    reference: `${HF}/meta-llama/Llama-3.2-1B-Instruct`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF' } },
    ],
  },
  {
    id: 'llama-3.2-3b-instruct',
    name: 'Llama 3.2 3B Instruct',
    description: 'Compact Llama 3.2 instruct model, good balance of speed and quality.',
    params: 3,
    family: 'Llama',
    reference: `${HF}/meta-llama/Llama-3.2-3B-Instruct`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF' } },
    ],
  },
  {
    id: 'llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B Instruct',
    description: 'Meta’s flagship 8B instruct model, strong general-purpose chat.',
    params: 8,
    family: 'Llama',
    reference: `${HF}/meta-llama/Llama-3.1-8B-Instruct`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF' } },
    ],
  },
  {
    id: 'deepseek-r1-distill-llama-8b',
    name: 'DeepSeek-R1-Distill-Llama 8B',
    description: 'Reasoning-focused: DeepSeek-R1 chain-of-thought distilled onto Llama 3.1 8B.',
    params: 8,
    family: 'DeepSeek',
    reference: `${HF}/deepseek-ai/DeepSeek-R1-Distill-Llama-8B`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF' } },
    ],
  },

  // ---- Qwen ----
  {
    id: 'qwen3-4b',
    name: 'Qwen3 4B',
    description: 'Latest-generation Qwen3, hybrid thinking/non-thinking modes.',
    params: 4,
    family: 'Qwen',
    reference: `${HF}/Qwen/Qwen3-4B`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/Qwen_Qwen3-4B-GGUF' } },
    ],
  },
  {
    id: 'qwen2.5-7b-instruct',
    name: 'Qwen2.5 7B Instruct',
    description: 'Widely-used general-purpose 7B instruct model with strong multilingual support.',
    params: 7,
    family: 'Qwen',
    reference: `${HF}/Qwen/Qwen2.5-7B-Instruct`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/Qwen2.5-7B-Instruct-GGUF' } },
    ],
  },
  {
    id: 'qwen3-8b',
    name: 'Qwen3 8B',
    description: 'Qwen3 mid-size dense model, hybrid thinking/non-thinking modes.',
    params: 8,
    family: 'Qwen',
    reference: `${HF}/Qwen/Qwen3-8B`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/Qwen_Qwen3-8B-GGUF' } },
    ],
  },
  {
    id: 'deepseek-r1-distill-qwen-7b',
    name: 'DeepSeek-R1-Distill-Qwen 7B',
    description: 'DeepSeek-R1 chain-of-thought reasoning distilled onto Qwen2.5 7B.',
    params: 7,
    family: 'DeepSeek',
    reference: `${HF}/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF' } },
    ],
  },
  {
    id: 'qwen2.5-14b-instruct',
    name: 'Qwen2.5 14B Instruct',
    description: 'Larger Qwen2.5 instruct model for more demanding tasks.',
    params: 14,
    family: 'Qwen',
    reference: `${HF}/Qwen/Qwen2.5-14B-Instruct`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/Qwen2.5-14B-Instruct-GGUF' } },
    ],
  },
  {
    id: 'qwen3-14b',
    name: 'Qwen3 14B',
    description: 'Larger Qwen3 dense model, hybrid thinking/non-thinking modes.',
    params: 14,
    family: 'Qwen',
    reference: `${HF}/Qwen/Qwen3-14B`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/Qwen_Qwen3-14B-GGUF' } },
    ],
  },
  {
    id: 'deepseek-r1-distill-qwen-14b',
    name: 'DeepSeek-R1-Distill-Qwen 14B',
    description: 'DeepSeek-R1 chain-of-thought reasoning distilled onto Qwen2.5 14B.',
    params: 14,
    family: 'DeepSeek',
    reference: `${HF}/deepseek-ai/DeepSeek-R1-Distill-Qwen-14B`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF' } },
    ],
  },

  // ---- Mistral ----
  {
    id: 'mistral-7b-instruct-v0.3',
    name: 'Mistral 7B Instruct v0.3',
    description: 'Mistral AI’s classic 7B instruct model.',
    params: 7,
    family: 'Mistral',
    reference: `${HF}/mistralai/Mistral-7B-Instruct-v0.3`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/Mistral-7B-Instruct-v0.3-GGUF' } },
    ],
  },
  {
    id: 'mistral-nemo-instruct-2407',
    name: 'Mistral Nemo Instruct (12B)',
    description: 'Mistral + NVIDIA collaboration, 128K context, strong multilingual.',
    params: 12,
    family: 'Mistral',
    reference: `${HF}/mistralai/Mistral-Nemo-Instruct-2407`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/Mistral-Nemo-Instruct-2407-GGUF' } },
    ],
  },
  {
    id: 'mistral-small-24b-instruct-2501',
    name: 'Mistral Small 24B Instruct (2501)',
    description: 'Mistral’s 24B "small" tier — strong quality-for-size, single GPU friendly.',
    params: 24,
    family: 'Mistral',
    reference: `${HF}/mistralai/Mistral-Small-24B-Instruct-2501`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/Mistral-Small-24B-Instruct-2501-GGUF' } },
    ],
  },

  // ---- Gemma ----
  {
    id: 'gemma-2-9b-it',
    name: 'Gemma 2 9B Instruct',
    description: 'Google’s Gemma 2 instruct model, 9B.',
    params: 9,
    family: 'Gemma',
    reference: `${HF}/google/gemma-2-9b-it`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/gemma-2-9b-it-GGUF' } },
    ],
  },
  {
    id: 'gemma-2-27b-it',
    name: 'Gemma 2 27B Instruct',
    description: 'Google’s largest Gemma 2 instruct model.',
    params: 27,
    family: 'Gemma',
    reference: `${HF}/google/gemma-2-27b-it`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/gemma-2-27b-it-GGUF' } },
    ],
  },
  {
    id: 'gemma-3-4b-it',
    name: 'Gemma 3 4B Instruct (vision)',
    description: 'Google’s Gemma 3, natively multimodal — accepts image input.',
    params: 4,
    vision: true,
    family: 'Gemma',
    reference: `${HF}/google/gemma-3-4b-it`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/google_gemma-3-4b-it-GGUF' } },
      { role: 'mmproj', label: 'Vision projector', required: true, quantizable: true,
        source: { repo: 'bartowski/google_gemma-3-4b-it-GGUF', match: 'mmproj' } },
    ],
  },
  {
    id: 'gemma-3-12b-it',
    name: 'Gemma 3 12B Instruct (vision)',
    description: 'Google’s Gemma 3, natively multimodal — accepts image input.',
    params: 12,
    vision: true,
    family: 'Gemma',
    reference: `${HF}/google/gemma-3-12b-it`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/google_gemma-3-12b-it-GGUF' } },
      { role: 'mmproj', label: 'Vision projector', required: true, quantizable: true,
        source: { repo: 'bartowski/google_gemma-3-12b-it-GGUF', match: 'mmproj' } },
    ],
  },
  {
    id: 'gemma-3-27b-it',
    name: 'Gemma 3 27B Instruct (vision)',
    description: 'Google’s largest Gemma 3, natively multimodal — accepts image input.',
    params: 27,
    vision: true,
    family: 'Gemma',
    reference: `${HF}/google/gemma-3-27b-it`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/google_gemma-3-27b-it-GGUF' } },
      { role: 'mmproj', label: 'Vision projector', required: true, quantizable: true,
        source: { repo: 'bartowski/google_gemma-3-27b-it-GGUF', match: 'mmproj' } },
    ],
  },

  // ---- Microsoft ----
  {
    id: 'phi-3.5-mini-instruct',
    name: 'Phi-3.5 Mini Instruct (3.8B)',
    description: 'Microsoft’s small, capable instruct model.',
    params: 3.8,
    family: 'Phi',
    reference: `${HF}/microsoft/Phi-3.5-mini-instruct`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/Phi-3.5-mini-instruct-GGUF' } },
    ],
  },
  {
    id: 'phi-4',
    name: 'Phi-4 (14B)',
    description: 'Microsoft’s Phi-4, strong reasoning for its size.',
    params: 14,
    family: 'Phi',
    reference: `${HF}/microsoft/phi-4`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/phi-4-GGUF' } },
    ],
  },

  // ---- Small / edge ----
  {
    id: 'smollm2-1.7b-instruct',
    name: 'SmolLM2 1.7B Instruct',
    description: 'HuggingFace’s small, efficient instruct model — runs comfortably on CPU.',
    params: 1.7,
    family: 'SmolLM',
    reference: `${HF}/HuggingFaceTB/SmolLM2-1.7B-Instruct`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'bartowski/SmolLM2-1.7B-Instruct-GGUF' } },
    ],
  },

  // ---- Vision-language (non-Gemma) ----
  {
    id: 'qwen2.5-vl-7b-instruct',
    name: 'Qwen2.5-VL 7B Instruct (vision)',
    description: 'Qwen’s vision-language model — image understanding + chat.',
    params: 7,
    vision: true,
    family: 'Qwen',
    reference: `${HF}/Qwen/Qwen2.5-VL-7B-Instruct`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'ggml-org/Qwen2.5-VL-7B-Instruct-GGUF' } },
      { role: 'mmproj', label: 'Vision projector', required: true, quantizable: true,
        source: { repo: 'ggml-org/Qwen2.5-VL-7B-Instruct-GGUF', match: 'mmproj' } },
    ],
  },
  {
    id: 'smolvlm2-2.2b-instruct',
    name: 'SmolVLM2 2.2B Instruct (vision)',
    description: 'HuggingFace’s small vision-language model — image understanding on modest hardware.',
    params: 2.2,
    vision: true,
    family: 'SmolLM',
    reference: `${HF}/HuggingFaceTB/SmolVLM2-2.2B-Instruct`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'ggml-org/SmolVLM2-2.2B-Instruct-GGUF' } },
      { role: 'mmproj', label: 'Vision projector', required: true, quantizable: true,
        source: { repo: 'ggml-org/SmolVLM2-2.2B-Instruct-GGUF', match: 'mmproj' } },
    ],
  },
];
