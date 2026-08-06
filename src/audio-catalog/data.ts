import type { AudioCatalogModel } from './types.js';

/**
 * Curated audio.cpp models. Only repo ids/paths are hardcoded — the actual
 * quantization files are resolved live via the HuggingFace Hub API (shared
 * `src/catalog/hf.ts`), same as the image and LLM catalogs.
 *
 * All entries below point into the audio.cpp project's own community GGUF
 * mono-repo (`audio-cpp/audio.cpp-gguf`, referenced from the project's own
 * docs), which hosts every family's packages under one repo in per-model
 * sub-folders — verified against the repo's real file listing, not guessed.
 * `family`/`task` match the exact `model_specs/<family>.json` filenames in
 * the audio.cpp repo, since these get written into `model.json` on install
 * and audiocpp_server needs them to pick the right loading code.
 *
 * Deliberately small to start (TTS + ASR + one voice-cloning-capable model)
 * — audio.cpp covers 40+ families; extend this list the same way the LLM/
 * image catalogs grew, one verified entry at a time.
 */
export const AUDIO_CATALOG: AudioCatalogModel[] = [
  {
    id: 'pocket-tts',
    name: 'PocketTTS (English)',
    description: 'Small, fast English TTS model — a good default for quick local testing.',
    family: 'pocket_tts',
    task: 'tts',
    reference: 'https://huggingface.co/audio-cpp/audio.cpp-gguf/tree/main/PocketTTS-GGUF/english',
    components: [
      {
        role: 'weights',
        label: 'Weights',
        required: true,
        quantizable: true,
        source: { repo: 'audio-cpp/audio.cpp-gguf', path: 'PocketTTS-GGUF/english' },
      },
    ],
  },
  {
    id: 'qwen3-tts',
    name: 'Qwen3-TTS (12Hz, 1.7B, Base)',
    description: "Alibaba's Qwen3-based voice-clone TTS model (16-codebook RVQ tokenizer, 12.5Hz frame rate).",
    family: 'qwen3_tts',
    task: 'tts',
    reference: 'https://huggingface.co/audio-cpp/audio.cpp-gguf/tree/main/Qwen3-TTS-12Hz-1.7B-Base-GGUF',
    components: [
      {
        role: 'weights',
        label: 'Weights',
        required: true,
        quantizable: true,
        source: { repo: 'audio-cpp/audio.cpp-gguf', path: 'Qwen3-TTS-12Hz-1.7B-Base-GGUF' },
      },
    ],
  },
  {
    id: 'chatterbox',
    name: 'Chatterbox (Multilingual)',
    description:
      'Voice-cloning TTS (character tokenizer -> AR -> S3Gen -> HiFT vocoder), 23 languages. ' +
      'Cloning-only, not plain text-to-speech — every request needs a reference voice WAV ' +
      '(voice_ref) via a registered voice preset (model.json\'s voicePresets/defaultVoicePreset), ' +
      'or task:"vc" for voice conversion. Confirmed against the real binary: it hard-rejects ' +
      'task:"tts" ("Chatterbox supports VoiceCloning and VoiceConversion") — audiocpp_server\'s own ' +
      'valid task enum includes "tts" generically, but Chatterbox\'s engine only implements "clon"/"vc".',
    family: 'chatterbox',
    task: 'clon',
    reference: 'https://huggingface.co/audio-cpp/audio.cpp-gguf/tree/main/Chatterbox-GGUF',
    components: [
      {
        role: 'weights',
        label: 'Weights',
        required: true,
        quantizable: true,
        source: { repo: 'audio-cpp/audio.cpp-gguf', path: 'Chatterbox-GGUF' },
      },
    ],
  },
  {
    id: 'qwen3-asr',
    name: 'Qwen3-ASR (0.6B)',
    description: 'Compact speech-to-text model — good default for quick local transcription testing.',
    family: 'qwen3_asr',
    task: 'asr',
    reference: 'https://huggingface.co/audio-cpp/audio.cpp-gguf/tree/main/Qwen3-ASR-0.6B-GGUF',
    components: [
      {
        role: 'weights',
        label: 'Weights',
        required: true,
        quantizable: true,
        source: { repo: 'audio-cpp/audio.cpp-gguf', path: 'Qwen3-ASR-0.6B-GGUF' },
      },
    ],
  },
];
