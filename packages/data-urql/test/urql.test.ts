/**
 * The urql binding, against a stub of the two methods it touches.
 *
 * A stub rather than the real client, because that is the claim: this package
 * knows three names and nothing else, so there is nothing a version bump could
 * break that a stub would not also catch.
 */
import { describe, expect, it } from 'vitest';
import { parseGraphQL, tag } from '@firsthandjs/data';
import { urqlLoader, type UrqlLike } from '@firsthandjs/data-urql';

const context = {
  signal: new AbortController().signal,
  force: false,
  tags: () => {},
};

/** Records what the client was asked for, and answers. */
function stub(answer: unknown = { ok: true }, error?: unknown) {
  const seen: { method: string; document: string; variables: unknown; options: unknown }[] = [];
  const respond = (method: string) => (document: string, variables: unknown, options: unknown) => {
    seen.push({ method, document, variables, options });
    return { toPromise: () => Promise.resolve({ data: answer, error }) };
  };
  return {
    seen,
    client: { query: respond('query'), mutation: respond('mutation') } as unknown as UrqlLike,
  };
}

describe('urqlLoader', () => {
  it('sends a query through `query`, and a mutation through `mutation`', async () => {
    const { seen, client } = stub();
    const load = urqlLoader(client);

    await load(parseGraphQL('query Ok { ok }'))(context);
    await load(parseGraphQL('mutation Go { go }'))(context);

    expect(seen.map((entry) => entry.method)).toEqual(['query', 'mutation']);
  });

  it('declares the tags the document carries, bound to the variables', async () => {
    const { client } = stub();
    const declared: unknown[] = [];
    // Typed as the codegen would type it, which is what makes the variables of
    // the call checkable at all.
    const document = parseGraphQL<unknown, { id: number }>(
      'query User($id: ID!) @tag(name: "user", id: $id) { user(id: $id) { id } }',
    );

    await urqlLoader(client)(document, { id: 5 })({
      ...context,
      tags: (...tags) => declared.push(...tags),
    });

    expect(declared).toEqual([tag('user', { id: 5 })]);
  });

  it('turns `force` into a policy that reaches past a cache', async () => {
    const { seen, client } = stub();
    const load = urqlLoader(client)(parseGraphQL('query Ok { ok }'));

    await load(context);
    await load({ ...context, force: true });

    expect(seen.map((entry) => (entry.options as { requestPolicy: string }).requestPolicy)).toEqual(
      ['cache-first', 'network-only'],
    );
  });

  it('hands over the abort signal', async () => {
    const { seen, client } = stub();
    const controller = new AbortController();

    await urqlLoader(client)(parseGraphQL('query Ok { ok }'))({
      ...context,
      signal: controller.signal,
    });

    expect(
      (seen[0]?.options as { fetchOptions: { signal: AbortSignal } }).fetchOptions.signal,
    ).toBe(controller.signal);
  });

  it('throws what the client reports, so it lands in `error`', async () => {
    const { client } = stub(undefined, new Error('network'));

    await expect(urqlLoader(client)(parseGraphQL('query Ok { ok }'))(context)).rejects.toThrow(
      'network',
    );
  });

  it("declares a mutation's `@invalidates`, so an action can pass them straight on", async () => {
    const { client } = stub();
    const declared: unknown[] = [];
    const document = parseGraphQL<unknown, { id: number }>(
      'mutation Rename($id: ID!) @invalidates(name: "user", id: $id) @invalidates(name: "users") { rename(id: $id) { id } }',
    );

    await urqlLoader(client)(document, { id: 5 })({
      ...context,
      tags: (...tags) => declared.push(...tags),
    });

    expect(declared).toEqual([tag('user', { id: 5 }), tag('users')]);
  });

  it('sends the document with its directives already removed', async () => {
    const { seen, client } = stub();
    const document = parseGraphQL('query Ok @tag(name: "ok") { ok }');

    await urqlLoader(client)(document)(context);

    expect(seen[0]?.document).not.toContain('@tag');
  });
});
