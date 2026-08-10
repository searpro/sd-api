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
 * Covers TTS, ASR, voice cloning (Chatterbox), voice *design* from a text
 * caption (Qwen3-TTS-VoiceDesign, OmniVoice — task:"design", see the
 * `caption` field on POST /v1/audio/speech), built-in instructable preset
 * voices (Qwen3-TTS-CustomVoice), text-driven expressive/nonverbal cues
 * (OmniVoice's inline `[laughter]`/`[sigh]`/etc. tags, DramaBox's automatic
 * detection of narrative cues like laughs/whispers from plain text — no
 * tags needed), and native word-level transcription timestamps
 * (Parakeet-TDT — see `return_timestamps`/`word_timestamps` on
 * POST /v1/audio/transcriptions). audio.cpp covers 40+ families total;
 * extend this list the same way the LLM/image catalogs grew, one verified
 * entry at a time.
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
    description:
      'Compact speech-to-text model — good default for quick local transcription testing. Word ' +
      'timestamps need a separate Qwen3-ForcedAligner-0.6B model + a ' +
      '`qwen3_asr.forced_aligner_model_path` session option (not wired up by this catalog entry) ' +
      '— for out-of-the-box word-level timestamps use the parakeet-tdt entry below instead.',
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
  {
    id: 'qwen3-tts-voicedesign',
    name: 'Qwen3-TTS VoiceDesign (12Hz, 1.7B)',
    description:
      'Qwen3-TTS variant that designs a voice from a natural-language text description instead of ' +
      'cloning one from audio — pass an `instruct` (e.g. "a warm, low-pitched older man, speaking ' +
      'slowly") on POST /v1/audio/speech. Requires task:"vdes" (voice design — confirmed via ' +
      '`audiocpp_cli --help`\'s task enum, not the friendlier "design" name in the model\'s own ' +
      'doc metadata); the same checkpoint family also ships plain-tts ("qwen3-tts") and ' +
      'preset-voice ("qwen3-tts-customvoice") variants.',
    family: 'qwen3_tts',
    task: 'vdes',
    reference: 'https://huggingface.co/audio-cpp/audio.cpp-gguf/tree/main/Qwen3-TTS-12Hz-1.7B-VoiceDesign-GGUF',
    components: [
      {
        role: 'weights',
        label: 'Weights',
        required: true,
        quantizable: true,
        source: { repo: 'audio-cpp/audio.cpp-gguf', path: 'Qwen3-TTS-12Hz-1.7B-VoiceDesign-GGUF' },
      },
    ],
  },
  {
    id: 'qwen3-tts-customvoice',
    name: 'Qwen3-TTS CustomVoice (12Hz, 1.7B)',
    description:
      'Qwen3-TTS variant with built-in, instructable preset timbres — no reference audio or ' +
      'caption needed. List the packaged voice ids via GET /v1/audio/voices?model=<id> once ' +
      'installed, then select one per-request the same way as any other voice preset.',
    family: 'qwen3_tts',
    task: 'tts',
    reference: 'https://huggingface.co/audio-cpp/audio.cpp-gguf/tree/main/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF',
    components: [
      {
        role: 'weights',
        label: 'Weights',
        required: true,
        quantizable: true,
        source: { repo: 'audio-cpp/audio.cpp-gguf', path: 'Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF' },
      },
    ],
  },
  {
    id: 'omnivoice',
    name: 'OmniVoice',
    description:
      'Massively multilingual (600+ languages) zero-shot TTS from k2-fsa. Installed with task:"tts" ' +
      '(plain text-to-speech, broadest default) — switch to task:"clon" via PUT .../manifest for ' +
      'short-reference voice cloning, or task:"vdes" for text-instruction voice design (`instruct`). ' +
      'Regardless of task, inline nonverbal tags in the input text — `[laughter]`, `[sigh]`, ' +
      '`[surprise-ah]`, `[question-en]`, `[dissatisfaction-hnn]`, etc. — control mood/expression.',
    family: 'omnivoice',
    task: 'tts',
    reference: 'https://huggingface.co/audio-cpp/audio.cpp-gguf/tree/main/OmniVoice-GGUF',
    components: [
      {
        role: 'weights',
        label: 'Weights',
        required: true,
        quantizable: true,
        source: { repo: 'audio-cpp/audio.cpp-gguf', path: 'OmniVoice-GGUF' },
      },
    ],
  },
  {
    id: 'dramabox',
    name: 'DramaBox',
    description:
      'English expressive TTS/voice-cloning model (Gemma text conditioning + diffusion sampling, ' +
      '48kHz stereo). Automatically detects narrative/emotional cues directly from plain input ' +
      'text — laughs, sighs, whispers, throat-clears, voice cracks, and more — no special tags ' +
      'needed. Optional voice cloning via a `target_voice` reference WAV (note: a different field ' +
      'name than Chatterbox\'s `voice_ref` — register it as such in a voice preset\'s extra fields).',
    family: 'dramabox',
    task: 'tts',
    reference: 'https://huggingface.co/audio-cpp/audio.cpp-gguf/tree/main/DramaBox-GGUF',
    components: [
      {
        role: 'weights',
        label: 'Weights',
        required: true,
        quantizable: true,
        source: { repo: 'audio-cpp/audio.cpp-gguf', path: 'DramaBox-GGUF' },
      },
    ],
  },
  {
    id: 'parakeet-tdt',
    name: 'Parakeet-TDT (0.6B v3)',
    description:
      'NVIDIA FastConformer-TDT ASR, 25 European languages with automatic language detection. ' +
      'Natively supports word-level timestamps with no separate aligner model — set ' +
      '`return_timestamps`/`word_timestamps` on POST /v1/audio/transcriptions to get a per-word ' +
      '`words[]` array back (the best default for a whisperX-like word-timestamps workflow).',
    family: 'parakeet_tdt',
    task: 'asr',
    reference: 'https://huggingface.co/audio-cpp/audio.cpp-gguf/tree/main/Parakeet-TDT-0.6B-v3-GGUF',
    components: [
      {
        role: 'weights',
        label: 'Weights',
        required: true,
        quantizable: true,
        source: { repo: 'audio-cpp/audio.cpp-gguf', path: 'Parakeet-TDT-0.6B-v3-GGUF' },
      },
    ],
  },
];
