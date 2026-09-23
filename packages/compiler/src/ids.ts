/**
 * A short, stable identifier for a module (ADR-0004).
 *
 * Derived from the package name and the module path relative to the project, so
 * it survives minification — unlike `Function.name` — and stays the same across
 * builds, unlike a runtime counter.
 *
 * The hash is FNV-1a rather than SHA-256, which is what this used to be. Not
 * for speed: `node:crypto` was the only thing in this package a browser does
 * not have, and the playground compiles TSX in a browser tab. What the value
 * has to be is *the same every time* for one input, and thirty-two bits of it
 * — which is what eight hex characters are, and what truncating SHA-256 gave
 * as well, so the chance of two modules colliding is exactly what it was. It
 * is an identity, never a checksum and never a secret.
 */

/** FNV-1a, 64-bit, over the UTF-8 bytes. */
function hash(text: string): bigint {
  const PRIME = 1099511628211n;
  const MASK = 0xffffffffffffffffn;
  let value = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(text)) {
    value = ((value ^ BigInt(byte)) * PRIME) & MASK;
  }
  return value;
}

export function stableId(packageName: string, filename: string): string {
  const normalised = filename
    .split(String.fromCharCode(92))
    .join('/')
    .replace(/^(?:.*\/)?(?:src|lib)\//, '');
  // The low thirty-two bits: in FNV-1a the high ones move least.
  return (hash(`${packageName}:${normalised}`) & 0xffffffffn).toString(16).padStart(8, '0');
}
