import { describe, it, expect } from 'vitest';
import { selectAsset, type ReleaseAsset } from '../src/sd/release.js';

// Real asset list from a leejet/stable-diffusion.cpp release.
const ASSETS: ReleaseAsset[] = [
  { name: 'cudart-sd-bin-win-cu12-x64.zip', browser_download_url: 'u', size: 563452046 },
  { name: 'sd-master-b12098f-bin-Darwin-macOS-15.7.7-arm64.zip', browser_download_url: 'u', size: 48667032 },
  { name: 'sd-master-b12098f-bin-Linux-Ubuntu-24.04-x86_64-rocm-7.13.0.zip', browser_download_url: 'u', size: 239783107 },
  { name: 'sd-master-b12098f-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip', browser_download_url: 'u', size: 44501106 },
  { name: 'sd-master-b12098f-bin-Linux-Ubuntu-24.04-x86_64.zip', browser_download_url: 'u', size: 25203299 },
  { name: 'sd-master-b12098f-bin-win-avx-x64.zip', browser_download_url: 'u', size: 21212249 },
  { name: 'sd-master-b12098f-bin-win-avx2-x64.zip', browser_download_url: 'u', size: 21225943 },
  { name: 'sd-master-b12098f-bin-win-avx512-x64.zip', browser_download_url: 'u', size: 21244548 },
  { name: 'sd-master-b12098f-bin-win-cuda12-x64.zip', browser_download_url: 'u', size: 352543400 },
  { name: 'sd-master-b12098f-bin-win-noavx-x64.zip', browser_download_url: 'u', size: 21204823 },
  { name: 'sd-master-b12098f-bin-win-vulkan-x64.zip', browser_download_url: 'u', size: 42310553 },
];

describe('selectAsset', () => {
  it('picks the plain CPU build on Linux x64', () => {
    const { asset } = selectAsset(ASSETS, 'linux', 'x64', 'cpu');
    expect(asset.name).toBe('sd-master-b12098f-bin-Linux-Ubuntu-24.04-x86_64.zip');
  });

  it('picks the vulkan build on Linux when requested', () => {
    const { asset } = selectAsset(ASSETS, 'linux', 'x64', 'vulkan');
    expect(asset.name).toContain('vulkan');
  });

  it('picks the rocm build on Linux when requested', () => {
    const { asset } = selectAsset(ASSETS, 'linux', 'x64', 'rocm');
    expect(asset.name).toContain('rocm');
  });

  it('picks the arm64 build on macOS', () => {
    const { asset } = selectAsset(ASSETS, 'darwin', 'arm64', 'cpu');
    expect(asset.name).toBe('sd-master-b12098f-bin-Darwin-macOS-15.7.7-arm64.zip');
  });

  it('prefers avx2 for Windows CPU and never the cudart redistributable', () => {
    const { asset } = selectAsset(ASSETS, 'win32', 'x64', 'cpu');
    expect(asset.name).toBe('sd-master-b12098f-bin-win-avx2-x64.zip');
    expect(asset.name).not.toContain('cudart');
  });

  it('picks the cuda build on Windows when requested', () => {
    const { asset } = selectAsset(ASSETS, 'win32', 'x64', 'cuda');
    expect(asset.name).toBe('sd-master-b12098f-bin-win-cuda12-x64.zip');
  });

  it('throws when no asset matches the platform', () => {
    expect(() => selectAsset(ASSETS, 'linux', 'arm64', 'cpu')).toThrow();
  });

  it('throws when an unavailable accel is requested', () => {
    expect(() => selectAsset(ASSETS, 'darwin', 'arm64', 'cuda')).toThrow();
  });
});
