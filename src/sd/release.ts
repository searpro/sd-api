/**
 * Selects the correct stable-diffusion.cpp release asset for the host
 * platform/architecture (and optional hardware acceleration backend).
 *
 * Release asset names embed drifting version numbers, e.g.:
 *   sd-master-b12098f-bin-Linux-Ubuntu-24.04-x86_64.zip
 *   sd-master-b12098f-bin-Darwin-macOS-15.7.7-arm64.zip
 *   sd-master-b12098f-bin-win-avx2-x64.zip
 * so matching is done by keyword/pattern rather than exact filename.
 */

export type Accel = 'cpu' | 'vulkan' | 'cuda' | 'rocm';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

const ACCEL_KEYWORDS: Record<Exclude<Accel, 'cpu'>, string[]> = {
  cuda: ['cuda', 'cu12'],
  rocm: ['rocm'],
  vulkan: ['vulkan'],
};

// Any of these in a name means the asset is an accelerated/aux build.
const ALL_ACCEL_KEYWORDS = ['cuda', 'cu12', 'cudart', 'rocm', 'vulkan'];

function osKeywords(platform: NodeJS.Platform): string[] {
  switch (platform) {
    case 'linux':
      return ['linux'];
    case 'darwin':
      return ['darwin', 'macos'];
    case 'win32':
      return ['win'];
    default:
      return [];
  }
}

function archKeywords(platform: NodeJS.Platform, arch: string): string[] {
  if (platform === 'win32') return ['x64'];
  if (arch === 'arm64') return ['arm64', 'aarch64'];
  if (arch === 'x64') return ['x86_64', 'amd64', 'x64'];
  return [arch];
}

/** Windows CPU builds come in AVX flavors; prefer the broadly-compatible avx2. */
const WIN_CPU_PREFERENCE = ['avx2', 'avx512', 'avx', 'noavx'];

export interface SelectionResult {
  asset: ReleaseAsset;
  reason: string;
}

export function selectAsset(
  assets: ReleaseAsset[],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  accel: Accel = 'cpu',
): SelectionResult {
  const os = osKeywords(platform);
  const archs = archKeywords(platform, arch);
  if (os.length === 0) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const lower = (a: ReleaseAsset) => a.name.toLowerCase();
  const isZip = (a: ReleaseAsset) => a.name.toLowerCase().endsWith('.zip');

  // 1. Narrow to OS + arch zip assets.
  let candidates = assets.filter((a) => {
    const n = lower(a);
    return isZip(a) && os.some((k) => n.includes(k)) && archs.some((k) => n.includes(k));
  });

  // The standalone "cudart-*" redistributable is never the binary we want.
  candidates = candidates.filter((a) => !lower(a).startsWith('cudart'));

  if (candidates.length === 0) {
    throw new Error(
      `No release asset found for ${platform}/${arch}. Available: ${assets
        .map((a) => a.name)
        .join(', ')}`,
    );
  }

  // 2. Apply acceleration preference.
  if (accel === 'cpu') {
    const cpuOnly = candidates.filter(
      (a) => !ALL_ACCEL_KEYWORDS.some((k) => lower(a).includes(k)),
    );
    if (cpuOnly.length > 0) candidates = cpuOnly;

    if (platform === 'win32') {
      for (const pref of WIN_CPU_PREFERENCE) {
        const match = candidates.find((a) => lower(a).includes(pref));
        if (match) return { asset: match, reason: `cpu/${pref}` };
      }
    }
    // Otherwise take the smallest (typically the plain CPU build).
    candidates.sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
    return { asset: candidates[0], reason: 'cpu' };
  }

  const keywords = ACCEL_KEYWORDS[accel];
  const accelMatch = candidates.filter((a) => keywords.some((k) => lower(a).includes(k)));
  if (accelMatch.length === 0) {
    throw new Error(
      `No "${accel}" build available for ${platform}/${arch}. Candidates: ${candidates
        .map((a) => a.name)
        .join(', ')}`,
    );
  }
  accelMatch.sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
  return { asset: accelMatch[0], reason: accel };
}
