import { createHash } from 'node:crypto';

/**
 * A short, stable identifier for a module (ADR-0004).
 *
 * Derived from the package name and the module path relative to the project, so
 * it survives minification — unlike `Function.name` — and stays the same across
 * builds, unlike a runtime counter.
 */
export function stableId(packageName: string, filename: string): string {
  const normalised = filename
    .split(String.fromCharCode(92))
    .join('/')
    .replace(/^(?:.*\/)?(?:src|lib)\//, '');
  return createHash('sha256').update(`${packageName}:${normalised}`).digest('hex').slice(0, 8);
}
