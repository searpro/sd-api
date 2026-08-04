import type { LlmCatalogModel } from './types.js';

const HF = 'https://huggingface.co';

/**
 * Curated catalog of popular open-weight LLMs with quantized GGUF releases,
 * for use with `llama-server` (see src/llm/). Repos are verified to exist and
 * carry real .gguf files; the actual file/quant listing is resolved **live**
 * via the HuggingFace Hub API (src/catalog/hf.ts, shared with the
 * image-model catalog) — no filenames are hardcoded here, only repo ids.
 *
 * Two deployment tiers (see `tier` on each entry, defaults to 'both'):
 *   - **mac**: fits comfortably in ~24GB unified memory (M-series) at a
 *     reasonable quant.
 *   - **cloud**: needs a real GPU (typically 80GB-class) — usually a large
 *     total-parameter MoE with a small *active*-parameter count, which is
 *     what actually drives inference cost/speed (`activeParams`).
 * Most entries work fine either way and are tagged 'both'.
 *
 * Every entry here was checked against a real, at-least-one-single-.gguf-file
 * quant (not only shard-split "-00001-of-000NN" releases) — this app's
 * download infrastructure only fetches one file per component, so a
 * shard-only model would silently install as a truncated, unusable bundle.
 * (This ruled out some otherwise-excellent options, e.g. MiniMax-M2, whose
 * GGUF releases are shard-split at every quant level except an unusably
 * low-bit ternary one — worth reconsidering once multi-shard downloads are
 * supported.)
 *
 * Sourced primarily from ggml-org's, bartowski's, and unsloth's GGUF
 * conversions — the most consistently up-to-date/complete quantizer accounts
 * on HF for llama.cpp, and (for ggml-org specifically) the strongest signal
 * that mainline `llama.cpp` actually supports the architecture, since that
 * org is the project's own account. Vision-language entries pair a `gguf`
 * weights component with an `mmproj` vision-projector component from the
 * same repo.
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

  // ---- Added 2026-08: current-generation, resource-efficient picks for
  // dual cloud-GPU-production / Mac-M4-24GB-dev deployment. Verified against
  // mainline llama.cpp support (ggml-org publishes the GGUF itself, or the
  // upstream PR is confirmed merged) and against a real single-file quant
  // (not shard-only) as of research time — see the file header for the full
  // methodology. ----

  // ---- OpenAI gpt-oss — Apache-2.0, native MXFP4 quantization, the
  // reference "high quality, low cost" pair: 20b for Mac/dev, 120b for a
  // single 80GB-class cloud GPU at near o4-mini-level reasoning. ----
  {
    id: 'gpt-oss-20b',
    name: 'gpt-oss 20B',
    description:
      'OpenAI’s open-weight reasoning model, MoE (3.6B active). Near o3-mini quality, ' +
      'runs in ~16GB — the reference pick for local/dev use.',
    params: 21,
    activeParams: 3.6,
    tier: 'both',
    family: 'gpt-oss',
    reference: `${HF}/openai/gpt-oss-20b`,
    components: [
      { role: 'gguf', label: 'Weights (native MXFP4)', required: true, quantizable: false,
        source: { repo: 'ggml-org/gpt-oss-20b-GGUF', match: 'MXFP4' } },
    ],
  },
  {
    id: 'gpt-oss-120b',
    name: 'gpt-oss 120B',
    description:
      'OpenAI’s open-weight reasoning model, MoE (5.1B active). Near o4-mini quality on a ' +
      'single 80GB-class GPU — strong quality-per-dollar for production.',
    params: 117,
    activeParams: 5.1,
    tier: 'cloud',
    family: 'gpt-oss',
    reference: `${HF}/openai/gpt-oss-120b`,
    components: [
      { role: 'gguf', label: 'Weights (native MXFP4)', required: true, quantizable: false,
        source: { repo: 'ggml-org/gpt-oss-120b-GGUF', match: 'MXFP4' } },
    ],
  },

  // ---- Google Gemma 4 — natively multimodal (text/image/audio on the
  // smaller variants), released April 2026. ----
  {
    id: 'gemma-4-12b-it',
    name: 'Gemma 4 12B Instruct (vision + audio)',
    description:
      'Google’s newest Gemma, unified multimodal (text, image, audio) in one checkpoint, ' +
      '256K context. Excellent Mac-dev general-purpose pick.',
    params: 12,
    vision: true,
    tier: 'both',
    family: 'Gemma',
    reference: `${HF}/google/gemma-4-12B-it`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'ggml-org/gemma-4-12B-it-GGUF' } },
      { role: 'mmproj', label: 'Vision projector', required: true, quantizable: true,
        source: { repo: 'ggml-org/gemma-4-12B-it-GGUF', match: 'mmproj' } },
    ],
  },
  {
    id: 'gemma-4-26b-a4b-it',
    name: 'Gemma 4 26B-A4B Instruct (vision, MoE)',
    description:
      'Sparse MoE Gemma 4 — 25B total but only 3.8B active, "almost as fast as a 4B model" ' +
      'per Google, while retaining image understanding. Great quality-per-cost on Mac or cloud.',
    params: 25.2,
    activeParams: 3.8,
    vision: true,
    tier: 'both',
    family: 'Gemma',
    reference: `${HF}/google/gemma-4-26B-A4B-it`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'ggml-org/gemma-4-26B-A4B-it-GGUF' } },
      { role: 'mmproj', label: 'Vision projector', required: true, quantizable: true,
        source: { repo: 'ggml-org/gemma-4-26B-A4B-it-GGUF', match: 'mmproj' } },
    ],
  },

  // ---- Alibaba Qwen3.6 — newest Qwen generation (hybrid Gated-DeltaNet +
  // MoE attention), vision-capable, tuned for agentic coding. ----
  {
    id: 'qwen3.6-35b-a3b',
    name: 'Qwen3.6 35B-A3B (vision, agentic coding)',
    description:
      'Newest Qwen generation: hybrid linear-attention/MoE architecture, built-in vision ' +
      'encoder, tuned for agentic coding/tool use. 35B total, only 3B active — reviewed as ' +
      'beating larger "frontier" models at a fraction of the inference cost.',
    params: 35,
    activeParams: 3,
    vision: true,
    tier: 'both',
    family: 'Qwen',
    reference: `${HF}/Qwen/Qwen3.6-35B-A3B`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'ggml-org/Qwen3.6-35B-A3B-GGUF' } },
      { role: 'mmproj', label: 'Vision projector', required: true, quantizable: true,
        source: { repo: 'ggml-org/Qwen3.6-35B-A3B-GGUF', match: 'mmproj' } },
    ],
  },

  // ---- Zhipu / Z.ai GLM — "Flash" tier models are their explicitly
  // efficiency-optimized releases; independently reviewed as beating
  // gpt-oss-20b in the same weight class. ----
  {
    id: 'glm-4.7-flash',
    name: 'GLM-4.7 Flash',
    description:
      'Zhipu’s efficiency-focused release — 30B total, 3B active MoE, reviewed as the ' +
      'strongest model in its class for lightweight coding/agent deployment.',
    params: 30,
    activeParams: 3,
    tier: 'both',
    family: 'GLM',
    reference: `${HF}/zai-org/GLM-4.7-Flash`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'ggml-org/GLM-4.7-Flash-GGUF' } },
    ],
  },
  {
    id: 'glm-4.6v-flash',
    name: 'GLM-4.6V Flash (vision)',
    description: 'Zhipu’s compact, low-latency vision-language model — good Mac-dev vision pick.',
    params: 9,
    vision: true,
    tier: 'both',
    family: 'GLM',
    reference: `${HF}/zai-org/GLM-4.6V-Flash`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'ggml-org/GLM-4.6V-Flash-GGUF' } },
      { role: 'mmproj', label: 'Vision projector', required: true, quantizable: true,
        source: { repo: 'ggml-org/GLM-4.6V-Flash-GGUF', match: 'mmproj' } },
    ],
  },
  {
    id: 'glm-4.6v',
    name: 'GLM-4.6V (vision, cloud)',
    description:
      'Zhipu’s cloud-scale vision-language MoE (106B total, ~12B active) — native tool-calling ' +
      'multimodal reasoning. Only a single-file Q4_K_M quant is offered here (this repo’s ' +
      'larger quants are shard-split, which this app can’t yet download as one piece).',
    params: 106,
    activeParams: 12,
    vision: true,
    tier: 'cloud',
    family: 'GLM',
    reference: `${HF}/zai-org/GLM-4.6V`,
    components: [
      { role: 'gguf', label: 'Weights (Q4_K_M only)', required: true, quantizable: false,
        source: { repo: 'ggml-org/GLM-4.6V-GGUF', match: 'Q4_K_M' } },
      { role: 'mmproj', label: 'Vision projector', required: true, quantizable: true,
        source: { repo: 'ggml-org/GLM-4.6V-GGUF', match: 'mmproj' } },
    ],
  },

  // ---- NVIDIA Nemotron 3 Nano — efficient MoE tuned for agentic/tool-use
  // workloads, competitive with larger dense models. ----
  {
    id: 'nemotron-3-nano-30b-a3b',
    name: 'NVIDIA Nemotron 3 Nano 30B-A3B',
    description: 'NVIDIA’s efficient MoE (30B total, 3B active) — strong agentic/tool-use performance for its cost.',
    params: 30,
    activeParams: 3,
    tier: 'both',
    family: 'Nemotron',
    reference: `${HF}/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'ggml-org/NVIDIA-Nemotron-3-Nano-30B-A3B-GGUF' } },
    ],
  },

  // ---- Qwen3-Next — hybrid attention + high-sparsity MoE, matches the
  // much larger Qwen3-235B-A22B on many benchmarks at a fraction of the
  // active-parameter cost; excels at very long context. Cloud-tier by size,
  // but exceptionally cheap to run for what it delivers. ----
  {
    id: 'qwen3-next-80b-a3b-instruct',
    name: 'Qwen3-Next 80B-A3B Instruct',
    description:
      'Hybrid-attention high-sparsity MoE (80B total, ~3B active) — matches Qwen3-235B-A22B on ' +
      'many benchmarks with far higher throughput, especially past 32K context (native 256K).',
    params: 80,
    activeParams: 3,
    tier: 'cloud',
    family: 'Qwen',
    reference: `${HF}/Qwen/Qwen3-Next-80B-A3B-Instruct`,
    components: [
      { role: 'gguf', label: 'Weights', required: true, quantizable: true,
        source: { repo: 'unsloth/Qwen3-Next-80B-A3B-Instruct-GGUF' } },
    ],
  },
];
