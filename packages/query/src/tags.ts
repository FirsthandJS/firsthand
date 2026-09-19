/**
 * Tags.
 *
 * A cache key answers "is this the same request?". A tag answers "what is this
 * request *about*?", which is the question invalidation actually asks. React
 * Query conflates the two: the key is both the identity and the invalidation
 * handle, so invalidating everything about user 7 means knowing every key
 * prefix anyone wrote for user 7.
 *
 * Here a query carries as many tags as it likes — `user(id: 7)`, `users`,
 * `permissions(org: 3)` — and a mutation invalidates tags, not queries. A tag
 * with fewer variables matches more: `user` invalidates every user, `user(id:
 * 7)` invalidates exactly that one.
 */

/** Variables a tag may carry. Values are compared with `Object.is`. */
export type TagVars = Readonly<Record<string, string | number | boolean | null>>;

export interface Tag {
  readonly name: string;
  readonly vars: TagVars;
}

const NO_VARS: TagVars = Object.freeze({});

/** Builds a tag. `tag('user', { id })` is the usual shape. */
export function tag(name: string, vars: TagVars = NO_VARS): Tag {
  return { name, vars };
}

/**
 * A stable string for a tag: same tag, same string, whatever order the
 * variables were written in.
 */
export function tagKey(value: Tag): string {
  const names = Object.keys(value.vars).sort();
  if (names.length === 0) {
    return value.name;
  }
  let key = value.name;
  for (const name of names) {
    key += `\u0001${name}\u0002${String(value.vars[name])}`;
  }
  return key;
}

/**
 * Whether `pattern` covers `candidate`.
 *
 * Same name, and every variable the pattern names has the same value on the
 * candidate. Variables the pattern leaves out are wildcards — which is what
 * makes `tag('user')` mean "every user".
 */
export function tagMatches(pattern: Tag, candidate: Tag): boolean {
  if (pattern.name !== candidate.name) {
    return false;
  }
  for (const name of Object.keys(pattern.vars)) {
    if (!Object.is(pattern.vars[name], candidate.vars[name])) {
      return false;
    }
  }
  return true;
}

/** Whether any of `patterns` covers any of `tags`. */
export function anyTagMatches(patterns: readonly Tag[], tags: readonly Tag[]): boolean {
  for (const pattern of patterns) {
    for (const candidate of tags) {
      if (tagMatches(pattern, candidate)) {
        return true;
      }
    }
  }
  return false;
}

/** The default identity of a query: all of its tags, in a stable order. */
export function tagsKey(tags: readonly Tag[]): string {
  return tags.map(tagKey).sort().join('\u0003');
}
