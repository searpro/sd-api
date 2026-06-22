import { mkdir, rm, chmod, readdir, stat, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import type { FastifyBaseLogger } from 'fastify';
import { selectAsset, type Accel, type ReleaseAsset } from './release.js';
import { errors } from '../errors.js';

const RELEASES_API = 'https://api.github.com/repos/leejet/stable-diffusion.cpp/releases';

// Candidate names of the CLI executable inside a release archive, in priority order.
const CLI_NAMES = ['sd-cli', 'sd-cli.exe', 'sd', 'sd.exe'];

export interface InstallerConfig {
  installDir: string;
  releaseTag: string; // "latest" or a specific tag
  accel: Accel;
}

export interface InstallResult {
  binaryPath: string;
  tag: string;
  asset: string;
}

interface GithubRelease {
  tag_name: string;
  assets: ReleaseAsset[];
}

/**
 * Downloads and installs a prebuilt stable-diffusion.cpp release matching the
 * host OS/arch. The whole archive is extracted in place because the CLI binary
 * depends on sibling shared libraries (e.g. libstable-diffusion.so).
 */
export class SdInstaller {
  constructor(
    private readonly config: InstallerConfig,
    private readonly log: FastifyBaseLogger,
  ) {}

  private apiHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'sd-api',
      Accept: 'application/vnd.github+json',
    };
    // A token raises the rate limit from 60 to 5000 req/hr and is optional.
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  private async fetchRelease(signal?: AbortSignal): Promise<GithubRelease> {
    const url =
      this.config.releaseTag === 'latest'
        ? `${RELEASES_API}/latest`
        : `${RELEASES_API}/tags/${encodeURIComponent(this.config.releaseTag)}`;
    const res = await fetch(url, { headers: this.apiHeaders(), signal });
    if (!res.ok) {
      const hint =
        res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0'
          ? ' (GitHub API rate limit exceeded — set GITHUB_TOKEN to raise it)'
          : '';
      throw errors.downloadFailed(
        `Failed to query release "${this.config.releaseTag}": HTTP ${res.status} ${res.statusText}${hint}`,
      );
    }
    return (await res.json()) as GithubRelease;
  }

  /** Recursively find the CLI executable within an extracted directory. */
  private async findBinary(dir: string): Promise<string | null> {
    const entries = await readdir(dir, { withFileTypes: true });
    // Prefer a direct hit in this directory.
    for (const name of CLI_NAMES) {
      const hit = entries.find((e) => e.isFile() && e.name === name);
      if (hit) return join(dir, hit.name);
    }
    // Otherwise descend.
    for (const e of entries) {
      if (e.isDirectory()) {
        const found = await this.findBinary(join(dir, e.name));
        if (found) return found;
      }
    }
    return null;
  }

  async install(signal?: AbortSignal): Promise<InstallResult> {
    const release = await this.fetchRelease(signal);
    const { asset, reason } = selectAsset(
      release.assets,
      process.platform,
      process.arch,
      this.config.accel,
    );
    this.log.info(
      { tag: release.tag_name, asset: asset.name, accel: reason },
      'selected stable-diffusion.cpp release asset',
    );
    return this.installAsset(asset, release.tag_name, signal);
  }

  /** Download a specific asset archive, extract it, and locate the CLI binary. */
  async installAsset(
    asset: ReleaseAsset,
    tag: string,
    signal?: AbortSignal,
  ): Promise<InstallResult> {
    // Download the archive to a temp file.
    const tmpZip = join(tmpdir(), `sd-cpp-${randomUUID()}.zip`);
    this.log.info({ url: asset.browser_download_url }, 'downloading release archive');
    const res = await fetch(asset.browser_download_url, {
      headers: { 'User-Agent': 'sd-api' },
      signal,
    });
    if (!res.ok || !res.body) {
      throw errors.downloadFailed(
        `Failed to download ${asset.name}: HTTP ${res.status} ${res.statusText}`,
      );
    }
    try {
      await pipeline(
        Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(tmpZip),
      );

      // Extract into a fresh per-tag directory so re-installs are clean.
      const targetDir = resolve(this.config.installDir, tag);
      const stagingDir = `${targetDir}.tmp-${randomUUID()}`;
      await mkdir(stagingDir, { recursive: true });
      try {
        new AdmZip(tmpZip).extractAllTo(stagingDir, /* overwrite */ true);
      } catch (err) {
        throw errors.downloadFailed(`Failed to extract ${asset.name}: ${(err as Error).message}`);
      }

      const binary = await this.findBinary(stagingDir);
      if (!binary) {
        throw errors.downloadFailed(
          `Archive ${asset.name} did not contain a known CLI executable (${CLI_NAMES.join(', ')})`,
        );
      }
      await chmod(binary, 0o755);

      // Atomically swap staging -> target.
      await rm(targetDir, { recursive: true, force: true });
      await rename(stagingDir, targetDir);

      // Recompute binary path under the final directory.
      const finalBinary = binary.replace(stagingDir, targetDir);
      await stat(finalBinary);

      this.log.info({ binaryPath: finalBinary }, 'stable-diffusion.cpp installed');
      return { binaryPath: finalBinary, tag, asset: asset.name };
    } finally {
      await rm(tmpZip, { force: true }).catch(() => {});
    }
  }
}
