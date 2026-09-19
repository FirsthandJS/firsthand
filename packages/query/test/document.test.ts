/**
 * Reading tag directives out of a GraphQL document, and the build-time loader.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createGraphQLTransport,
  FirsthandDirectiveError,
  FirsthandGraphQLError,
  FirsthandHttpError,
  json,
  parseGraphQL,
  resolveTags,
  tag,
} from '@firsthandjs/query';
import { graphql } from '@firsthandjs/query/vite';

const USER = `
query User($id: ID!) @tag(name: "user", id: $id) @tag(name: "permissions") {
  user(id: $id) {
    id
    name
  }
}
`;

describe('parseGraphQL', () => {
  it('reads the operation and its tags', () => {
    const document = parseGraphQL(USER);
    expect(document.operation).toBe('User');
    expect(document.kind).toBe('query');
    expect(document.tags).toEqual([
      { name: 'user', vars: { id: { variable: 'id' } } },
      { name: 'permissions', vars: {} },
    ]);
    expect(document.invalidates).toEqual([]);
  });

  it('removes the directives from what will be sent', () => {
    const { source } = parseGraphQL(USER);
    expect(source).not.toContain('@tag');
    // And leaves the rest of the document exactly as it was.
    expect(source).toContain('query User($id: ID!)');
    expect(source).toContain('user(id: $id)');
    expect(source.replace(/\s+/g, ' ').trim()).toBe(
      'query User($id: ID!) { user(id: $id) { id name } }',
    );
  });

  it('reads what a mutation invalidates', () => {
    const document = parseGraphQL(`
      mutation RenameUser($id: ID!, $name: String!)
      @invalidates(name: "user", id: $id)
      @invalidates(name: "users") {
        renameUser(id: $id, name: $name) { id }
      }
    `);
    expect(document.kind).toBe('mutation');
    expect(document.operation).toBe('RenameUser');
    expect(document.invalidates).toEqual([
      { name: 'user', vars: { id: { variable: 'id' } } },
      { name: 'users', vars: {} },
    ]);
    expect(document.source).not.toContain('@invalidates');
  });

  it('accepts a directive on a field as well as on the operation', () => {
    const document = parseGraphQL(`
      query Mixed($id: ID!) {
        user(id: $id) @tag(name: "user", id: $id) {
          name
        }
      }
    `);
    expect(document.tags).toEqual([{ name: 'user', vars: { id: { variable: 'id' } } }]);
    expect(document.source).toContain('user(id: $id) {');
  });

  it('leaves other directives alone', () => {
    const document = parseGraphQL(`
      query Flagged($full: Boolean!) @tag(name: "user") {
        user { name details @include(if: $full) { bio } }
      }
    `);
    expect(document.tags).toHaveLength(1);
    expect(document.source).toContain('@include(if: $full)');
  });

  it('accepts literal arguments as well as variables', () => {
    const document = parseGraphQL(`
      query Report @tag(name: "report", kind: "monthly", draft: false, limit: 20, owner: null, mode: FAST) {
        report { id }
      }
    `);
    expect(document.tags[0]?.vars).toEqual({
      kind: { literal: 'monthly' },
      draft: { literal: false },
      limit: { literal: 20 },
      owner: { literal: null },
      mode: { literal: 'FAST' },
    });
  });

  it('accepts arguments separated by whitespace alone', () => {
    const document = parseGraphQL('query Q @tag(name: "a" id: $id kind: "x") { q }');
    expect(document.tags[0]).toEqual({
      name: 'a',
      vars: { id: { variable: 'id' }, kind: { literal: 'x' } },
    });
  });

  it('accepts whitespace between the directive and its arguments', () => {
    expect(parseGraphQL('query Q @tag ( name: "a" ) { q }').tags[0]?.name).toBe('a');
  });

  it('accepts a block string and escapes in a string', () => {
    const document = parseGraphQL(
      'query Q @tag(name: "a", block: """ boxed """, quoted: "say \\"hi\\"") { q }',
    );
    expect(document.tags[0]?.vars).toEqual({
      block: { literal: 'boxed' },
      quoted: { literal: 'say "hi"' },
    });
  });

  it('reads the escapes a GraphQL string allows', () => {
    const document = parseGraphQL(
      'query Q @tag(name: "a", lines: "one\\ntwo\\tthree", unicode: "caf\\u00e9") { q }',
    );
    expect(document.tags[0]?.vars).toEqual({
      lines: { literal: 'one\ntwo\tthree' },
      unicode: { literal: 'café' },
    });
  });

  it('reads a comment that runs to the end of the document', () => {
    expect(parseGraphQL('query Q @tag(name: "a") { q } # trailing').tags[0]?.name).toBe('a');
  });

  it('ignores a directive inside a string or a comment', () => {
    const document = parseGraphQL(`
      # @tag(name: "commented-out")
      query Q($note: String = "@tag(name: \\"quoted\\")") @tag(name: "real") {
        q(note: $note)
      }
    `);
    expect(document.tags).toEqual([{ name: 'real', vars: {} }]);
  });

  it('ignores a directive inside a block string', () => {
    const document = parseGraphQL(
      'query Q($note: String = """ @tag(name: "inside") """) @tag(name: "real") { q }',
    );
    expect(document.tags).toEqual([{ name: 'real', vars: {} }]);
  });

  it('is not confused by the word "mutation" in a comment or a tag name', () => {
    const document = parseGraphQL(`
      # the mutation this replaces
      query Log @tag(name: "mutation-log") { log }
    `);
    expect(document.kind).toBe('query');
    expect(document.operation).toBe('Log');
    expect(document.tags[0]?.name).toBe('mutation-log');
  });

  it('handles an anonymous operation and a subscription', () => {
    expect(parseGraphQL('{ me { id } }').operation).toBe('');
    expect(parseGraphQL('{ me { id } }').kind).toBe('query');
    expect(parseGraphQL('subscription Ticks { ticks }').kind).toBe('subscription');
    expect(parseGraphQL('query { me { id } }').operation).toBe('');
  });

  it('tolerates an unterminated string rather than looping', () => {
    expect(parseGraphQL('query Q($a: String = "open) { q }').tags).toEqual([]);
    expect(parseGraphQL('query Q($a: String = """open) { q }').tags).toEqual([]);
  });
});

describe('a malformed directive', () => {
  const failing = (source: string): unknown => {
    try {
      parseGraphQL(source);
      return null;
    } catch (error: unknown) {
      return error;
    }
  };

  it('needs a literal name', () => {
    expect(failing('query Q @tag(id: $id) { q }')).toBeInstanceOf(FirsthandDirectiveError);
    expect(failing('query Q @tag { q }')).toBeInstanceOf(FirsthandDirectiveError);
    expect(failing('query Q @tag(name: $dynamic) { q }')).toBeInstanceOf(FirsthandDirectiveError);
    expect(failing('query Q @tag(name: 7) { q }')).toBeInstanceOf(FirsthandDirectiveError);
    expect((failing('query Q @invalidates(id: $id) { q }') as Error).message).toContain(
      '@invalidates(name: "user", id: $id)',
    );
  });

  it('needs its arguments to be name/value pairs', () => {
    expect(failing('query Q @tag(name: "a", 7) { q }')).toBeInstanceOf(FirsthandDirectiveError);
    expect(failing('query Q @tag(name: "a", id) { q }')).toBeInstanceOf(FirsthandDirectiveError);
    expect(failing('query Q @tag(name: "a", id: ) { q }')).toBeInstanceOf(FirsthandDirectiveError);
    expect(failing('query Q @tag(name: "a", id: $) { q }')).toBeInstanceOf(FirsthandDirectiveError);
  });

  it('rejects a structured tag variable', () => {
    expect((failing('query Q @tag(name: "a", filter: { x: 1 }) { q }') as Error).message).toContain(
      'scalar',
    );
    expect(failing('query Q @tag(name: "a", ids: [1, 2]) { q }')).toBeInstanceOf(
      FirsthandDirectiveError,
    );
  });

  it('rejects an invalid string escape', () => {
    expect((failing('query Q @tag(name: "a", bad: "\\q") { q }') as Error).message).toContain(
      'not a valid string',
    );
  });

  it('rejects unclosed arguments', () => {
    expect((failing('query Q @tag(name: "a" { q }') as Error).message).toContain('unclosed');
  });
});

describe('resolveTags', () => {
  const templates = parseGraphQL(USER).tags;

  it('binds variables from the call', () => {
    expect(resolveTags(templates, { id: 7 })).toEqual([tag('user', { id: 7 }), tag('permissions')]);
  });

  it('widens the tag when the variable is missing', () => {
    expect(resolveTags(templates, {})).toEqual([tag('user'), tag('permissions')]);
    expect(resolveTags(templates, { id: null })).toEqual([tag('user'), tag('permissions')]);
  });

  it('serialises an object variable rather than dropping it', () => {
    expect(resolveTags(templates, { id: { nested: true } })).toEqual([
      tag('user', { id: '{"nested":true}' }),
      tag('permissions'),
    ]);
  });

  it('keeps literal arguments as they were written', () => {
    const literal = parseGraphQL('query R @tag(name: "report", kind: "monthly") { r }').tags;
    expect(resolveTags(literal, {})).toEqual([tag('report', { kind: 'monthly' })]);
  });
});

describe('the GraphQL transport', () => {
  const document = parseGraphQL(USER);

  it('posts the stripped document and returns the data', async () => {
    const send = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { user: { id: '7' } } }))),
    );
    const transport = createGraphQLTransport({
      url: '/graphql',
      headers: { authorization: 'Bearer t' },
      fetch: send as unknown as typeof fetch,
    });

    const data = await transport(document, { id: 7 }, { signal: new AbortController().signal });

    expect(data).toEqual({ user: { id: '7' } });
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/graphql');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer t');
    const body = JSON.parse(init.body as string) as { query: string; operationName: string };
    // The server never sees the cache's directives.
    expect(body.query).not.toContain('@tag');
    expect(body.operationName).toBe('User');
    expect(JSON.parse(init.body as string)).toMatchObject({ variables: { id: 7 } });
  });

  it('reads headers per request when they are a function', async () => {
    let token = 'first';
    const send = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: null }))));
    const transport = createGraphQLTransport({
      url: '/graphql',
      headers: () => ({ authorization: token }),
      fetch: send as unknown as typeof fetch,
    });
    const signal = new AbortController().signal;

    await transport(document, {}, { signal });
    token = 'second';
    await transport(document, {}, { signal });

    const headers = send.mock.calls.map(
      (call) =>
        ((call as unknown as [string, RequestInit])[1].headers as Record<string, string>)[
          'authorization'
        ],
    );
    expect(headers).toEqual(['first', 'second']);
  });

  it('omits the operation name for an anonymous document', async () => {
    const send = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: 1 }))));
    const transport = createGraphQLTransport({
      url: '/graphql',
      fetch: send as unknown as typeof fetch,
    });

    await transport(parseGraphQL('{ me }'), {}, { signal: new AbortController().signal });

    const body = JSON.parse(
      (send.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>;
    expect('operationName' in body).toBe(false);
  });

  it('turns GraphQL errors into one thrown error', async () => {
    const transport = createGraphQLTransport({
      url: '/graphql',
      fetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ errors: [{ message: 'nope' }, { message: 'also' }] })),
        )) as unknown as typeof fetch,
    });

    await expect(transport(document, {}, { signal: new AbortController().signal })).rejects.toThrow(
      FirsthandGraphQLError,
    );
    await expect(transport(document, {}, { signal: new AbortController().signal })).rejects.toThrow(
      'nope; also',
    );
  });

  it('falls back to the global fetch', () => {
    // Constructing it must not require a fetch to be passed.
    expect(typeof createGraphQLTransport({ url: '/graphql' })).toBe('function');
  });
});

describe('the JSON fetcher', () => {
  it('parses a body and passes the abort signal through', async () => {
    const send = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ id: 7 }))));
    vi.stubGlobal('fetch', send);
    const controller = new AbortController();

    const data = await json<{ id: number }>('/api/user')({ signal: controller.signal });

    expect(data).toEqual({ id: 7 });
    expect((send.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(
      controller.signal,
    );
    vi.unstubAllGlobals();
  });

  it('treats an empty body as no body', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 204 })));
    await expect(
      json('/api/thing')({ signal: new AbortController().signal }),
    ).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('throws for a failed status, carrying the parsed body', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ message: 'gone' }), { status: 404 })),
    );

    const failed = await json('/api/missing')({ signal: new AbortController().signal }).catch(
      (error: unknown) => error,
    );

    expect(failed).toBeInstanceOf(FirsthandHttpError);
    expect((failed as FirsthandHttpError).status).toBe(404);
    expect((failed as FirsthandHttpError).url).toBe('/api/missing');
    expect((failed as FirsthandHttpError).body).toEqual({ message: 'gone' });
    expect((failed as FirsthandHttpError).message).toBe('HTTP 404 for /api/missing');
    vi.unstubAllGlobals();
  });
});

describe('the .graphql loader', () => {
  it('turns a document into its parsed form', () => {
    const plugin = graphql();
    const result = plugin.transform(USER, '/src/user.graphql');

    expect(result).not.toBeNull();
    const document = JSON.parse(
      (result as { code: string }).code.replace('export default ', '').replace(/;$/, ''),
    ) as { operation: string; source: string; tags: { name: string }[] };
    expect(document.operation).toBe('User');
    expect(document.tags.map((template) => template.name)).toEqual(['user', 'permissions']);
    expect(document.source).not.toContain('@tag');
  });

  it('fails the build for a malformed directive', () => {
    expect(() => graphql().transform('query Q @tag(id: $id) { q }', '/src/a.graphql')).toThrow(
      FirsthandDirectiveError,
    );
  });

  it('accepts .gql and a query suffix, and ignores everything else', () => {
    const plugin = graphql();
    expect(plugin.transform('{ a }', '/src/a.gql')).not.toBeNull();
    expect(plugin.transform('{ a }', '/src/a.graphql?raw')).not.toBeNull();
    expect(plugin.transform('const a = 1;', '/src/a.ts')).toBeNull();
    expect(plugin.name).toBe('firsthand-graphql');
    expect(plugin.enforce).toBe('pre');
  });
});
