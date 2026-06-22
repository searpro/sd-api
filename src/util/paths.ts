import { resolve, relative, isAbsolute, basename } from 'node:path';
import { errors } from '../errors.js';

/**
 * Path-safety helpers (Spec section 5).
 *
 * Guards against directory traversal: every user-supplied name must resolve to
 * a path that stays inside the configured base directory.
 */

/** Reject obviously unsafe names before they ever touch the filesystem. */
export function assertSafeName(name: string): string {
  if (!name || typeof name !== 'string') {
    throw errors.invalidPath('Name must be a non-empty string');
  }
  if (name.includes('\0')) {
    throw errors.invalidPath('Name contains a null byte');
  }
  // A name is a single path segment: no separators, no traversal.
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw errors.invalidPath(`Name must not contain path separators or "..": ${name}`);
  }
  if (isAbsolute(name)) {
    throw errors.invalidPath(`Name must not be an absolute path: ${name}`);
  }
  return name;
}

/**
 * Resolve `name` inside `baseDir` and confirm the result does not escape it.
 * Returns the absolute, normalized path.
 */
export function safeResolve(baseDir: string, name: string): string {
  assertSafeName(name);
  const base = resolve(baseDir);
  const target = resolve(base, name);
  const rel = relative(base, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw errors.invalidPath(`Resolved path escapes base directory: ${name}`);
  }
  return target;
}

/** Defensive: strip any directory component a caller may have included. */
export function sanitizeBasename(name: string): string {
  return basename(name);
}
