/** Resolved on-disk paths for a downloadable component. */
export interface ComponentPaths {
  dir: string;
  finalPath: string;
  /** Partial-download file (resume target). */
  tmpPath: string;
  /** Sidecar JSON holding resume metadata (url, total). */
  metaPath: string;
}

/**
 * Where a downloadable artifact's files live on disk, for a given domain
 * (image-model components, LLM weights, ...). `DownloadManager` is generic
 * over this so its resume/progress/cancel logic — the hard, tested part —
 * is shared across domains instead of duplicated.
 */
export interface ComponentPathResolver<TType extends string = string> {
  resolveComponentPaths(model: string, type: TType, name: string): Promise<ComponentPaths>;
  /** Derive a download filename from an explicit name or the URL's last segment. */
  fileNameFor(url: string, explicit?: string): string;
}
