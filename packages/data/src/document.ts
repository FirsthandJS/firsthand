/**
 * GraphQL, with the tags written where the query is.
 *
 * A `.graphql` file already says what it reads. Repeating that in TypeScript as
 * a cache key is how caches drift out of sync with the queries they hold, so
 * the tag assignment lives in the document, as directives:
 *
 * ```graphql
 * query User($id: ID!) @tag(name: "user", id: $id) @tag(name: "permissions") {
 *   user(id: $id) {
 *     id
 *     name
 *   }
 * }
 * ```
 *
 * and a mutation says what it breaks:
 *
 * ```graphql
 * mutation RenameUser($id: ID!, $name: String!)
 * @invalidates(name: "user", id: $id)
 * @invalidates(name: "users") {
 *   renameUser(id: $id, name: $name) {
 *     id
 *   }
 * }
 * ```
 *
 * `name` is the tag's name; every other argument is a tag variable. `$id` is
 * bound from the variables the call passes, so one directive covers every user.
 * A variable the call leaves out is dropped from the tag, which widens it —
 * `user(id: $id)` with no `id` means "every user", which is the right answer
 * for "I changed something and I do not know which one".
 *
 * The directives are **removed** from the document before it is sent. They are
 * instructions to the cache, not to the server, and a server that has not
 * declared them in its schema would reject the whole query — the same reason
 * Apollo strips `@connection`. Put them on the operation, or on a field if
 * that reads better; they are recognised and stripped wherever they appear.
 */
import { tag, type Tag, type TagVars, type Variables } from './tags.js';
// Type-only, so the build-time loader still pulls in nothing but this file.

/** A tag variable: either bound from a call's variables, or fixed. */
export type TagValue = { readonly variable: string } | { readonly literal: TagVars[string] };

export interface TagTemplate {
  readonly name: string;
  readonly vars: Readonly<Record<string, TagValue>>;
}

/**
 * A parsed operation, carrying what it returns and what it needs.
 *
 * `TData` and `TVariables` exist only in the type system — nothing writes
 * them, and `JSON.stringify` of a document does not mention them. They are
 * what lets `useGraphQL(NotesDocument)` know its own result type without a
 * type argument at the call site, once `@firsthandjs/data/codegen` has written
 * the declaration for the `.gql` file.
 */
export interface GraphQLDocument<
  TData = unknown,
  TVariables extends Variables = Record<string, never>,
> {
  /** What is sent to the server: the document with the tag directives removed. */
  readonly source: string;
  /** The operation name, or `''` for an anonymous operation. */
  readonly operation: string;
  readonly kind: 'query' | 'mutation' | 'subscription';
  readonly tags: readonly TagTemplate[];
  readonly invalidates: readonly TagTemplate[];
  /** Phantom: the shape this operation returns. Never present at runtime. */
  readonly data?: TData;
  /** Phantom: the variables this operation takes. Never present at runtime. */
  readonly variables?: TVariables;
}

/**
 * How a document's variables are passed: required when the operation has some,
 * omitted when it has none.
 *
 * A tuple rather than `variables?:` so that an operation with required
 * variables cannot be called without them, while one without may be called
 * with the document alone. The helper packages take this, which is what checks
 * a call against the schema it was generated from.
 */
export type DocumentArguments<TVariables extends Variables> =
  Record<string, never> extends TVariables ? [variables?: TVariables] : [variables: TVariables];

const DIRECTIVE = /^@(tag|invalidates)\b/;
const OPERATION = /\b(query|mutation|subscription)\b[^\S\n]*([A-Za-z_]\w*)?/;
const NAME = /^[_A-Za-z][_0-9A-Za-z]*/;

/** Thrown for a tag directive the cache cannot make sense of. */
export class FirsthandDirectiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirsthandDirectiveError';
  }
}

/** Where a string literal ends, so that a `@tag` inside one is left alone. */
function endOfString(source: string, start: number): number {
  if (source.startsWith('"""', start)) {
    const close = source.indexOf('"""', start + 3);
    return close === -1 ? source.length : close + 3;
  }
  let at = start + 1;
  while (at < source.length && source[at] !== '"') {
    // A backslash escapes whatever follows, including a closing quote.
    at += source[at] === '\\' ? 2 : 1;
  }
  return at + 1;
}

/** Where the balanced `(` opened at `start` closes. */
function endOfArguments(source: string, start: number): number {
  let depth = 0;
  let at = start;
  while (at < source.length) {
    const character = source[at];
    if (character === '"') {
      at = endOfString(source, at);
      continue;
    }
    if (character === '(' || character === '[' || character === '{') {
      depth++;
    } else if (character === ')' || character === ']' || character === '}') {
      depth--;
      if (depth === 0) {
        return at + 1;
      }
    }
    at++;
  }
  throw new FirsthandDirectiveError(`unclosed arguments in ${source.slice(start, start + 40)}`);
}

/**
 * A quoted value, unquoted.
 *
 * GraphQL's string escapes are JSON's, so this is `JSON.parse` rather than a
 * hand-written table that would get `\u00e9` wrong.
 */
function unquote(quoted: string, directive: string): string {
  try {
    return JSON.parse(quoted) as string;
  } catch {
    throw new FirsthandDirectiveError(`@${directive}: ${quoted} is not a valid string`);
  }
}

/**
 * Reads one directive's arguments.
 *
 * GraphQL separates arguments with whitespace, commas, or both, so this
 * tokenises rather than splitting. Values may be a variable, a string, a
 * number, a boolean, `null`, or a bare enum name.
 */
function parseArguments(raw: string, directive: string): Record<string, TagValue> {
  const vars: Record<string, TagValue> = {};
  let at = 0;
  const skipIgnored = (): void => {
    while (at < raw.length && /[\s,]/.test(raw[at] as string)) {
      at++;
    }
  };

  skipIgnored();
  while (at < raw.length) {
    const name = NAME.exec(raw.slice(at));
    if (name === null) {
      throw new FirsthandDirectiveError(
        `@${directive}: expected an argument name at "${raw.slice(at)}"`,
      );
    }
    at += name[0].length;
    skipIgnored();
    if (raw[at] !== ':') {
      throw new FirsthandDirectiveError(`@${directive}: argument ${name[0]} has no value`);
    }
    at++;
    skipIgnored();
    const read = readValue(raw, directive, at);
    vars[name[0]] = read.value;
    at = read.next;
    skipIgnored();
  }
  return vars;
}

/** Reads one argument value, and says where it ended. */
function readValue(raw: string, directive: string, at: number): { value: TagValue; next: number } {
  const character = raw[at];
  if (character === '$') {
    const name = NAME.exec(raw.slice(at + 1));
    if (name === null) {
      throw new FirsthandDirectiveError(`@${directive}: expected a variable name after $`);
    }
    return { value: { variable: name[0] }, next: at + 1 + name[0].length };
  }
  if (character === '"') {
    const end = endOfString(raw, at);
    const quoted = raw.slice(at, end);
    const literal = quoted.startsWith('"""')
      ? quoted.slice(3, -3).trim()
      : unquote(quoted, directive);
    return { value: { literal }, next: end };
  }
  if (character === '[' || character === '{') {
    // A tag variable is a scalar; a structured value is not one, and silently
    // stringifying it would produce a tag nobody could write a match for.
    throw new FirsthandDirectiveError(
      `@${directive}: a tag variable must be a scalar, not a list or object`,
    );
  }
  const word = /^[^\s,)]+/.exec(raw.slice(at));
  if (word === null) {
    throw new FirsthandDirectiveError(`@${directive}: expected a value`);
  }
  const text = word[0];
  const next = at + text.length;
  if (text === 'true' || text === 'false') {
    return { value: { literal: text === 'true' }, next };
  }
  if (text === 'null') {
    return { value: { literal: null }, next };
  }
  const asNumber = Number(text);
  return { value: { literal: Number.isNaN(asNumber) ? text : asNumber }, next };
}

interface Found {
  readonly tags: TagTemplate[];
  readonly invalidates: TagTemplate[];
  /** The document with every tag directive removed. */
  readonly stripped: string;
}

/**
 * Walks the document once, collecting the cache's directives and removing them.
 *
 * A hand-written scanner rather than a GraphQL parser: a parser is several
 * times the size of this whole package, and all this needs to know is where
 * strings and comments are, so that a `@tag` inside one is left alone.
 */
function scan(source: string): Found {
  const tags: TagTemplate[] = [];
  const invalidates: TagTemplate[] = [];
  let stripped = '';
  let at = 0;
  let kept = 0;

  while (at < source.length) {
    const character = source[at];
    if (character === '"') {
      at = endOfString(source, at);
      continue;
    }
    if (character === '#') {
      const newline = source.indexOf('\n', at);
      at = newline === -1 ? source.length : newline;
      continue;
    }
    if (character !== '@') {
      at++;
      continue;
    }
    const directive = DIRECTIVE.exec(source.slice(at));
    if (directive === null) {
      at++;
      continue;
    }

    let end = at + directive[0].length;
    let args = '';
    // Whitespace between the directive name and its arguments is legal.
    let probe = end;
    while (probe < source.length && /\s/.test(source[probe] as string)) {
      probe++;
    }
    if (source[probe] === '(') {
      const close = endOfArguments(source, probe);
      args = source.slice(probe + 1, close - 1);
      end = close;
    }

    const vars = parseArguments(args, directive[1] as string);
    const named = vars['name'];
    if (named === undefined || !('literal' in named) || typeof named.literal !== 'string') {
      throw new FirsthandDirectiveError(
        `@${directive[1] as string} needs a literal name, as in @${directive[1] as string}(name: "user", id: $id)`,
      );
    }
    delete vars['name'];
    (directive[1] === 'tag' ? tags : invalidates).push({ name: named.literal, vars });

    // The whitespace in front of the directive goes with it, so that removing
    // one leaves the document as if it had never been written rather than
    // dotted with double spaces and blank lines.
    let from = at;
    while (from > kept && /\s/.test(source[from - 1] as string)) {
      from--;
    }
    stripped += source.slice(kept, from);
    kept = end;
    at = end;
  }

  return { tags, invalidates, stripped: stripped + source.slice(kept) };
}

/**
 * Reads a document's tag directives and returns it without them.
 *
 * Malformed directives throw. With the `@firsthandjs/data/vite` loader that
 * happens at build time, which is where a typo in a cache instruction should
 * be found.
 */
export function parseGraphQL<TData = unknown, TVariables extends Variables = Record<string, never>>(
  source: string,
): GraphQLDocument<TData, TVariables> {
  const { tags, invalidates, stripped } = scan(source);
  // Comments cannot name the operation, so they are removed before looking
  // for it — otherwise `# the mutation below` would be mistaken for one.
  const operation = OPERATION.exec(stripped.replace(/#[^\n]*/g, ''));
  return {
    source: stripped,
    operation: operation?.[2] ?? '',
    kind: (operation?.[1] ?? 'query') as GraphQLDocument['kind'],
    tags,
    invalidates,
  };
}

/** Binds tag templates against a call's variables. */
export function resolveTags(templates: readonly TagTemplate[], variables: Variables): Tag[] {
  return templates.map((template) => {
    const vars: Record<string, TagVars[string]> = {};
    for (const [name, value] of Object.entries(template.vars)) {
      if ('literal' in value) {
        vars[name] = value.literal;
        continue;
      }
      const bound = variables[value.variable];
      // An absent variable widens the tag rather than producing `user(id:
      // undefined)`, which would match nothing.
      if (bound !== undefined && bound !== null) {
        vars[name] = typeof bound === 'object' ? JSON.stringify(bound) : (bound as string);
      }
    }
    return tag(template.name, vars);
  });
}
