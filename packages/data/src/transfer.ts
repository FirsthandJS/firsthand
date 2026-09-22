/**
 * Handing a server's answers to the browser.
 *
 * A resource has no key — it belongs to its call site, which is what ADR-0022
 * is about — so there is nothing to serialise it under. A **named** resource
 * does: `persist` is a name the application chose, and a name is exactly what
 * state transfer needs. So transfer is not a new concept here. It is the one
 * that was already there, pointed at a different destination:
 *
 * ```ts
 * // the server
 * const storage = createMemoryStorage();
 * const data = createData({ storage });
 * const body = await renderToStringAsync(() => <App />, {
 *   settle: () => data.settle(),
 * });
 * const page = `${body}<script>window.__FIRSTHAND_DATA__ = ${serialize(storage.dump())}</script>`;
 *
 * // the browser
 * const data = createData({ storage: createMemoryStorage(window.__FIRSTHAND_DATA__) });
 * hydrate(() => <App />, document.getElementById('app')!);
 * ```
 *
 * A resource without a `persist` name still renders on the server — it loads,
 * it settles, and its answer is in the markup. What it does not do is arrive
 * in the browser already answered, because there is nothing to put it under.
 * That is a decision the call site makes, in one word, and can see.
 */

import type { Storage } from './store.js';

export type MemoryStorage = Storage & {
  /** Everything held, as plain data, for putting in a page. */
  dump(): Record<string, unknown>;
  /** Puts a server's answers in. */
  seed(values: Record<string, unknown>): void;
  /** How many names are held. */
  readonly size: number;
};

/**
 * A storage that is a plain object and answers straight away.
 *
 * Answering straight away is the whole point: a resource seeded from here has
 * its value *during* the render that reads it, so the markup a server sends
 * carries data rather than a spinner, and the browser's first paint is that
 * same markup rather than a spinner replacing it.
 *
 * One per request on a server. It holds what that render produced and nothing
 * else, so nothing leaks from one visitor's page into another's.
 */
export function createMemoryStorage(initial?: Record<string, unknown>): MemoryStorage {
  const values = new Map<string, unknown>(initial === undefined ? [] : Object.entries(initial));
  return {
    get size(): number {
      return values.size;
    },
    read: (name: string): unknown => values.get(name),
    write: (name: string, data: unknown): void => {
      values.set(name, data);
    },
    clear: (): void => {
      values.clear();
    },
    dump: (): Record<string, unknown> => Object.fromEntries(values),
    seed: (next: Record<string, unknown>): void => {
      for (const name in next) {
        values.set(name, next[name]);
      }
    },
  };
}

/**
 * JSON for a `<script>` element.
 *
 * `JSON.stringify` alone is not safe there: a string containing `</script>`
 * closes the element, and `<!--` starts a comment the parser does not end
 * where you think. The characters are escaped as unicode, which JSON reads
 * back as themselves.
 */
export function serialize(value: unknown): string {
  return JSON.stringify(value).replace(UNSAFE, (one) => ESCAPES[one] as string);
}

const UNSAFE = /[<\u2028\u2029]/g;

const ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};
