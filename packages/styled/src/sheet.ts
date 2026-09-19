/**
 * One stylesheet, one rule per distinct piece of CSS.
 *
 * Every rule this package emits is keyed by a hash of its own text, so the
 * same styles written by a hundred component instances are inserted once. The
 * sheet is append-only for as long as anything uses a rule, and each rule is
 * remembered as the node it became — so removing one is a reference, not a
 * search through the sheet for matching text.
 */

/**
 * Rules currently in the sheet, by key, with how many things want them.
 *
 * The count matters for global styles: two components may attach the same
 * global rule, and the first one to leave must not take it away from the
 * second. Scoped rules are inserted and never removed, so their count only
 * ever grows, which costs one integer.
 */
const inserted = new Map<string, { node: Text; count: number }>();
let sheet: HTMLStyleElement | null = null;

/**
 * A short, stable name for a piece of CSS.
 *
 * FNV-1a: four lines, no dependency, and a collision would mean two different
 * rules hashing the same — at which point the second is simply not inserted,
 * which is visible immediately rather than subtly wrong.
 */
export function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let at = 0; at < text.length; at++) {
    value ^= text.charCodeAt(at);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
}

function target(): HTMLStyleElement {
  if (sheet !== null && sheet.isConnected) {
    return sheet;
  }
  sheet = document.createElement('style');
  sheet.setAttribute('data-firsthand-styled', '');
  document.head.appendChild(sheet);
  return sheet;
}

/** Inserts a rule unless its key is already there. Returns whether it was new. */
export function insert(key: string, rule: string): boolean {
  const existing = inserted.get(key);
  if (existing !== undefined) {
    existing.count++;
    return false;
  }
  const node = document.createTextNode(rule);
  inserted.set(key, { node, count: 1 });
  target().appendChild(node);
  return true;
}

/** Removes a rule again, for `createGlobalStyle`'s disposal. */
export function remove(key: string): void {
  const entry = inserted.get(key);
  // Nothing to remove happens after `reset`, which is what a hot reload or a
  // test does between mounting and unmounting.
  if (entry === undefined) {
    return;
  }
  if (--entry.count > 0) {
    return;
  }
  inserted.delete(key);
  entry.node.remove();
}

/** Drops everything. For tests, and for a hot reload that wants a clean slate. */
export function reset(): void {
  inserted.clear();
  sheet?.remove();
  sheet = null;
}
