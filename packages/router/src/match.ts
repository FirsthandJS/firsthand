/**
 * Path matching and route ranking.
 *
 * The rules are react-router's, because a router that matches *almost* like the
 * one people know is worse than one that matches differently on purpose:
 *
 * - a segment beginning with `:` is a parameter,
 * - a trailing `*` is a splat, captured as the `*` parameter,
 * - a parameter may end with `?` to make that segment optional,
 * - routes are ranked, not tried in order, so the most specific match wins
 *   regardless of how the array happens to be sorted.
 *
 * Matching is done on a pre-compiled regular expression per pattern, built once
 * when the route tree is first walked.
 */

/** Captured parameters, including `*` for a splat. */
export type Params = Readonly<Record<string, string>>;

/**
 * Same keys, same values.
 *
 * Every navigation builds a fresh params object, so identity would report a
 * change whenever anything in the URL moved; this reports one only when the
 * parameters did.
 */
export function sameParams(a: Params, b: Params): boolean {
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((name) => a[name] === b[name]);
}

/** Flattens an intersection so editors show one object rather than `A & B`. */
export type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** The parameters one path segment contributes. */
type SegmentParams<S extends string> = S extends `:${infer Name}?`
  ? { readonly [K in Name]?: string }
  : S extends `:${infer Name}`
    ? { readonly [K in Name]: string }
    : S extends `*`
      ? { readonly '*': string }
      : // A static segment contributes nothing.
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        {};

/**
 * The parameters a path declares, read from the path itself.
 *
 * `ParamsOf<'users/:id/files/*'>` is `{ id: string; '*': string }`. Nothing
 * has to be declared twice: the route table already says what the path is.
 */
export type ParamsOf<Path extends string> = Path extends `${infer Head}/${infer Rest}`
  ? SegmentParams<Head> & ParamsOf<Rest>
  : SegmentParams<Path>;

export type Pattern = {
  readonly source: string;
  readonly regex: RegExp;
  readonly keys: readonly string[];
  /** Higher wins. Static segments beat dynamic ones, which beat a splat. */
  readonly score: number;
  /** Whether the pattern must consume the whole path. */
  readonly end: boolean;
};

const STATIC = 10;
const DYNAMIC = 6;
const OPTIONAL = 4;
const SPLAT = 1;
const INDEX = 2;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Splits a path into segments, ignoring empty ones from leading/double slashes. */
export function segments(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

/**
 * Compiles a path pattern.
 *
 * `end` is false for a parent route in a nested tree: it has to match a prefix
 * so that its children can match the rest.
 */
export function compilePattern(path: string, end: boolean): Pattern {
  const parts = segments(path);
  const keys: string[] = [];
  let score = parts.length === 0 ? INDEX : 0;
  let source = '';

  for (const part of parts) {
    if (part === '*') {
      keys.push('*');
      score += SPLAT;
      source += '(?:/(.*))?';
      continue;
    }
    if (part.startsWith(':')) {
      const optional = part.endsWith('?');
      keys.push(part.slice(1, optional ? -1 : undefined));
      score += optional ? OPTIONAL : DYNAMIC;
      source += optional ? '(?:/([^/]+))?' : '/([^/]+)';
      continue;
    }
    score += STATIC;
    source += `/${escape(part)}`;
  }

  const regex = new RegExp(`^${source}${end ? '/?$' : '(?=/|$)'}`, 'i');
  return { source: path, regex, keys, score, end };
}

/** Runs a compiled pattern against a pathname. */
export function matchPattern(
  pattern: Pattern,
  pathname: string,
): { params: Params; consumed: string } | null {
  const found = pattern.regex.exec(pathname);
  if (found === null) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.keys.length; i++) {
    const value = found[i + 1];
    if (value !== undefined) {
      params[pattern.keys[i] as string] = decodeURIComponent(value);
    }
  }
  return { params, consumed: found[0] };
}

/** Normalises a pathname: always a leading slash, never a trailing one. */
export function normalizePath(pathname: string): string {
  const joined = `/${segments(pathname).join('/')}`;
  return joined;
}
