import type { Config } from './config.js';
import type { SdWrapper } from './sd/wrapper.js';
import type { ModelManager } from './models/manager.js';
import type { JobManager } from './jobs/manager.js';
import type { CatalogManager } from './catalog/manager.js';
import type { DownloadManager } from './downloads/manager.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    sd: SdWrapper;
    models: ModelManager;
    jobs: JobManager;
    catalog: CatalogManager;
    downloads: DownloadManager;
  }
}
