import { mkdir, rm, chmod, readdir, stat, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import type { FastifyBaseLogger } from 'fastify';
import { selectAsset, type Accel, type ReleaseAsset } from '../sd/release.js';
import { errors } from '../errors.js';

// Candidate names of the server executable inside a release archive, in priority order.
const CLI_NAMES = ['audiocpp_server', 'audiocpp_server.exe'];

export interface AudioInstallerConfig {
  installDir: string;
  releaseTag: string; // "latest" or a specific tag
  accel: Accel;
  /**
   * "owner/repo" to query for releases. Defaults to upstream (0xShug0/audio.cpp),
   * which as of this writing only publishes Windows assets — override with a
   * fork/mirror that publishes Linux/macOS builds (e.g. via a CI workflow
   * running scripts/build_linux.sh) once one exists, no code change needed.
   */
  releasesRepo: string;
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
 * Downloads and installs a prebuilt audio.cpp release matching the host
 * OS/arch, structurally identical to LlamaInstaller/SdInstaller (stage,
 * extract, chmod, atomic rename) and reusing the same selectAsset() as-is.
 *
 * Unlike llama.cpp/stable-diffusion.cpp, upstream audio.cpp's releases (as
 * of this writing) are Windows-only (CPU/CUDA zips) — no Linux or macOS
 * prebuilt assets exist there yet, even though the project documents
 * `scripts/build_linux.sh` for a from-source build (confirmed working: it
 * produces a self-contained, dynamically-linked-against-only-glibc/libstdc++
 * binary — no sibling shared lib to manage, unlike sd-cli/llama-server).
 * Rather than adding a CMake-invoking installer (a much bigger, riskier
 * undertaking than "download a release zip"), `releasesRepo` is
 * configurable precisely so a fork/mirror that *does* publish Linux/macOS
 * builds (e.g. via CI running that same script) can be pointed at without a
 * code change — see SD_AUDIO_RELEASES_REPO in README.md.
 */
export class AudioInstaller {
  constructor(
    private readonly config: AudioInstallerConfig,
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

  private releasesApi(): string {
    return `https://api.github.com/repos/${this.config.releasesRepo}/releases`;
  }

  private async fetchRelease(signal?: AbortSignal): Promise<GithubRelease> {
    const base = this.releasesApi();
    const url =
      this.config.releaseTag === 'latest' ? `${base}/latest` : `${base}/tags/${encodeURIComponent(this.config.releaseTag)}`;
    const res = await fetch(url, { headers: this.apiHeaders(), signal });
    if (!res.ok) {
      const hint =
        res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0'
          ? ' (GitHub API rate limit exceeded — set GITHUB_TOKEN to raise it)'
          : '';
      throw errors.downloadFailed(
        `Failed to query ${this.config.releasesRepo} release "${this.config.releaseTag}": ` +
          `HTTP ${res.status} ${res.statusText}${hint}`,
      );
    }
    return (await res.json()) as GithubRelease;
  }

  /** Recursively find the server executable within an extracted directory. */
  private async findBinary(dir: string): Promise<string | null> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const name of CLI_NAMES) {
      const hit = entries.find((e) => e.isFile() && e.name === name);
      if (hit) return join(dir, hit.name);
    }
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
    let asset: ReleaseAsset;
    let reason: string;
    try {
      ({ asset, reason } = selectAsset(release.assets, process.platform, process.arch, this.config.accel));
    } catch (err) {
      throw errors.downloadFailed(
        `${(err as Error).message} — ${this.config.releasesRepo}@${release.tag_name} has no matching asset. ` +
          'Either point SD_AUDIO_RELEASES_REPO at a fork/mirror that publishes one for this platform, or build ' +
          'audiocpp_server from source (scripts/build_linux.sh in the audio.cpp repo) and point ' +
          'SD_AUDIO_BINARY_PATH at the result.',
      );
    }
    this.log.info({ tag: release.tag_name, asset: asset.name, accel: reason }, 'selected audio.cpp release asset');
    return this.installAsset(asset, release.tag_name, signal);
  }

  /** Download a specific asset archive, extract it, and locate the server binary. */
  async installAsset(asset: ReleaseAsset, tag: string, signal?: AbortSignal): Promise<InstallResult> {
    const tmpZip = join(tmpdir(), `audio-cpp-${randomUUID()}.zip`);
    this.log.info({ url: asset.browser_download_url }, 'downloading audio.cpp release archive');
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
          `Archive ${asset.name} did not contain a known server executable (${CLI_NAMES.join(', ')})`,
        );
      }
      await chmod(binary, 0o755);

      // Atomically swap staging -> target.
      await rm(targetDir, { recursive: true, force: true });
      await rename(stagingDir, targetDir);

      const finalBinary = binary.replace(stagingDir, targetDir);
      await stat(finalBinary);

      this.log.info({ binaryPath: finalBinary }, 'audio.cpp installed');
      return { binaryPath: finalBinary, tag, asset: asset.name };
    } finally {
      await rm(tmpZip, { force: true }).catch(() => {});
    }
  }
}
