import type { Config } from './config.js';
import type { SdWrapper } from './sd/wrapper.js';
import type { ModelManager } from './models/manager.js';
import type { JobManager } from './jobs/manager.js';
import type { CatalogManager } from './catalog/manager.js';
import type { DownloadManager } from './downloads/manager.js';
import type { LlamaServerManager } from './llm/server-manager.js';
import type { LlmModelManager, LlmComponentType } from './llm-models/manager.js';
import type { LlmCatalogManager } from './llm-catalog/manager.js';
import type { LogBuffer } from './logs/buffer.js';
import type { AudioServerManager } from './audio/server-manager.js';
import type { AudioModelManager, AudioComponentType } from './audio-models/manager.js';
import type { AudioCatalogManager } from './audio-catalog/manager.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    sd: SdWrapper;
    models: ModelManager;
    jobs: JobManager;
    catalog: CatalogManager;
    downloads: DownloadManager;
    llm: LlamaServerManager;
    llmModels: LlmModelManager;
    llmDownloads: DownloadManager<LlmComponentType>;
    llmCatalog: LlmCatalogManager;
    logs: LogBuffer;
    audio: AudioServerManager;
    audioModels: AudioModelManager;
    audioDownloads: DownloadManager<AudioComponentType>;
    audioCatalog: AudioCatalogManager;
  }
}
