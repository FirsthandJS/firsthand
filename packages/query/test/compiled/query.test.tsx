/**
 * The hooks, used the way an application uses them.
 *
 * The assertions to read are the ones about *other* components: a mutation
 * invalidates a tag, and a component that never heard of the mutation shows the
 * new value. That is what tags are for, and it works because every component
 * asking for the same tags reads the same cells.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { component, provide, signal } from '@firsthandjs/dom';
import { cleanup, mount, tick } from '@firsthandjs/testing';
import {
  GraphQLContext,
  QueryClientContext,
  createQueryClient,
  parseGraphQL,
  tag,
  useGraphQL,
  useGraphQLMutation,
  useMutation,
  useQuery,
  useQueryClient,
  type GraphQLTransport,
  type QueryClient,
} from '@firsthandjs/query';

afterEach(cleanup);

/** Mounts `inner` under a provided client. */
function withClient(client: QueryClient, inner: () => unknown): ReturnType<typeof mount> {
  const Root = component(() => {
    provide(QueryClientContext, client);
    return inner() as never;
  });
  return mount(() => <Root />);
}

describe('useQuery', () => {
  it('shows pending, then the data, then reports it is no longer fetching', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    const Page = component(() => {
      const user = useQuery<string>(() => ({
        tags: [tag('user', { id: 1 })],
        fetch: () => Promise.resolve('Ada'),
      }));
      return (
        <p data-status={user.status.value} data-fetching={String(user.fetching.value)}>
          {user.data.value ?? 'nothing'}
        </p>
      );
    });

    const view = withClient(client, () => <Page />);
    expect(view.get('p').dataset['status']).toBe('pending');
    expect(view.text()).toBe('nothing');

    await tick();

    expect(view.get('p').dataset['status']).toBe('success');
    expect(view.get('p').dataset['fetching']).toBe('false');
    expect(view.text()).toBe('Ada');
  });

  it('follows a variable: a new id moves to a new entry', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    const id = signal(1);
    const fetcher = vi.fn((which: number) => Promise.resolve(`user ${String(which)}`));
    const setups = vi.fn();
    const Page = component(() => {
      setups();
      const user = useQuery<string>(() => {
        const current = id.value;
        return { tags: [tag('user', { id: current })], fetch: () => fetcher(current) };
      });
      return <p>{user.data.value ?? '…'}</p>;
    });

    const view = withClient(client, () => <Page />);
    await tick();
    expect(view.text()).toBe('user 1');

    id.value = 2;
    await tick();

    expect(view.text()).toBe('user 2');
    expect(fetcher).toHaveBeenCalledTimes(2);
    // The component was never re-created: only the cells it reads changed.
    expect(setups).toHaveBeenCalledTimes(1);
    expect(client.size).toBe(2);
  });

  it('serves two components from one request', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    const fetcher = vi.fn(() => Promise.resolve('shared'));
    const Page = component(() => {
      const value = useQuery<string>(() => ({ tags: [tag('thing')], fetch: fetcher }));
      return <span>{value.data.value ?? ''}</span>;
    });

    const view = withClient(client, () => (
      <div>
        <Page />
        <Page />
      </div>
    ));
    await tick();

    expect(view.all('span').map((node) => node.textContent)).toEqual(['shared', 'shared']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not fetch while it is disabled', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    const enabled = signal(false);
    const fetcher = vi.fn(() => Promise.resolve('late'));
    const Page = component(() => {
      const value = useQuery<string>(
        () => ({ tags: [tag('thing')], fetch: fetcher }),
        () => ({ enabled: enabled.value }),
      );
      return <p>{value.data.value ?? 'waiting'}</p>;
    });

    const view = withClient(client, () => <Page />);
    await tick();
    expect(fetcher).not.toHaveBeenCalled();
    expect(view.text()).toBe('waiting');

    enabled.value = true;
    await tick();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(view.text()).toBe('late');
  });

  it('refetches on demand, and shows the new value', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    let answer = 'first';
    const Page = component(() => {
      const value = useQuery<string>(() => ({
        tags: [tag('thing')],
        fetch: () => Promise.resolve(answer),
      }));
      return (
        <p>
          <button onClick={() => void value.refetch()}>reload</button>
          {value.data.value ?? ''}
        </p>
      );
    });

    const view = withClient(client, () => <Page />);
    await tick();
    expect(view.text()).toBe('reloadfirst');

    answer = 'second';
    view.get<HTMLButtonElement>('button').click();
    await tick();

    expect(view.text()).toBe('reloadsecond');
  });

  it('refetches by default, and honours the cache only when told to', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    const fetcher = vi.fn(() => Promise.resolve('value'));
    let refetch: ((options?: { force?: boolean }) => Promise<unknown>) | undefined;
    const Page = component(() => {
      const value = useQuery<string>(() => ({ tags: [tag('thing')], fetch: fetcher }));
      refetch = (options) => value.refetch(options);
      return <p>{value.data.value ?? ''}</p>;
    });

    withClient(client, () => <Page />);
    await tick();

    await refetch?.({ force: false });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await refetch?.();
    expect(fetcher).toHaveBeenCalledTimes(2);

    // An options object that says nothing must not change what it does.
    await refetch?.({});
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('refetches when a variable changes, and caches when it changes back', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    const page = signal(1);
    const fetcher = vi.fn((which: number) => Promise.resolve(`page ${String(which)}`));
    const Page = component(() => {
      // The tag says what this is about; the variables say which one it is.
      const rows = useQuery<string, { page: number }>(() => ({
        tags: [tag('rows')],
        variables: { page: page.value },
        fetch: ({ variables }) => fetcher(variables.page),
      }));
      return <p>{rows.data.value ?? '…'}</p>;
    });

    const view = withClient(client, () => <Page />);
    await tick();
    expect(view.text()).toBe('page 1');

    page.value = 2;
    await tick();
    expect(view.text()).toBe('page 2');
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Back to a page already fetched: the entry is still there.
    page.value = 1;
    await tick();
    expect(view.text()).toBe('page 1');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps queries with the same tags but different variables apart', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    const rows = (which: string) => ({
      tags: [tag('rows')],
      variables: { sort: which },
      fetch: () => Promise.resolve(which),
    });

    expect(await client.load(rows('asc'))).toBe('asc');
    expect(await client.load(rows('desc'))).toBe('desc');
    expect(client.size).toBe(2);

    // One tag still invalidates both, which is the point of tags.
    await client.invalidate(tag('rows'));
    expect(client.entry(rows('asc')).invalid).toBe(true);
    expect(client.entry(rows('desc')).invalid).toBe(true);
  });

  it('releases the entry when the component goes away', async () => {
    const client = createQueryClient({ cacheTime: 5 });
    const Page = component(() => {
      const value = useQuery<string>(() => ({
        tags: [tag('thing')],
        fetch: () => Promise.resolve('value'),
      }));
      return <p>{value.data.value ?? ''}</p>;
    });

    const view = withClient(client, () => <Page />);
    await tick();
    expect(client.size).toBe(1);

    view.unmount();
    await tick(20);

    expect(client.size).toBe(0);
  });

  it('reports an error to the view', async () => {
    const client = createQueryClient();
    const Page = component(() => {
      const value = useQuery<string>(() => ({
        tags: [tag('thing')],
        fetch: () => Promise.reject(new Error('no network')),
      }));
      return (
        <p>{value.status.value === 'error' ? (value.error.value as Error).message : 'fine'}</p>
      );
    });

    const view = withClient(client, () => <Page />);
    await tick();

    expect(view.text()).toBe('no network');
  });
});

describe('useMutation', () => {
  it('invalidates tags, and a component that never heard of it updates', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    let stored = 'Ada';
    const Reader = component(() => {
      const user = useQuery<string>(() => ({
        tags: [tag('user', { id: 1 })],
        fetch: () => Promise.resolve(stored),
      }));
      return <p id="reader">{user.data.value ?? ''}</p>;
    });
    const Writer = component(() => {
      const rename = useMutation<string, string>({
        mutate: (name) => {
          stored = name;
          return Promise.resolve(name);
        },
        invalidates: (_result, name) => [tag('user', { id: name === 'gone' ? 2 : 1 })],
      });
      return (
        <button id="rename" onClick={() => void rename.mutate('Grace')}>
          rename
        </button>
      );
    });

    const view = withClient(client, () => (
      <div>
        <Reader />
        <Writer />
      </div>
    ));
    await tick();
    expect(view.get('#reader').textContent).toBe('Ada');

    view.get<HTMLButtonElement>('#rename').click();
    await tick();

    // Nothing connected the two components but the tag.
    expect(view.get('#reader').textContent).toBe('Grace');
  });

  it('invalidates several queries at once', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    const calls = { one: 0, two: 0 };
    const One = component(() => {
      const value = useQuery<number>(() => ({
        tags: [tag('user', { id: 1 }), tag('users')],
        fetch: () => Promise.resolve(++calls.one),
      }));
      return <i id="one">{String(value.data.value ?? 0)}</i>;
    });
    const Two = component(() => {
      const value = useQuery<number>(() => ({
        tags: [tag('users')],
        fetch: () => Promise.resolve(++calls.two),
      }));
      return <i id="two">{String(value.data.value ?? 0)}</i>;
    });
    const Writer = component(() => {
      const save = useMutation<undefined, undefined>({
        mutate: () => Promise.resolve(undefined),
        invalidates: [tag('users')],
      });
      return <button onClick={() => void save.mutate(undefined)}>save</button>;
    });

    const view = withClient(client, () => (
      <div>
        <One />
        <Two />
        <Writer />
      </div>
    ));
    await tick();
    expect([view.get('#one').textContent, view.get('#two').textContent]).toEqual(['1', '1']);

    view.get<HTMLButtonElement>('button').click();
    await tick();

    expect([view.get('#one').textContent, view.get('#two').textContent]).toEqual(['2', '2']);
  });

  it('reports status, calls the callbacks and resets', async () => {
    const client = createQueryClient();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const states: string[] = [];
    let handle: ReturnType<typeof useMutation<string, string>> | undefined;
    const Writer = component(() => {
      const save = useMutation<string, string>({
        mutate: (input) =>
          input === 'bad' ? Promise.reject(new Error('no')) : Promise.resolve(input),
        onSuccess,
        onError,
      });
      handle = save;
      return <p>{save.status.value}</p>;
    });

    const view = withClient(client, () => <Writer />);
    states.push(view.text());

    const good = handle?.mutate('fine');
    states.push(view.text());
    expect(await good).toBe('fine');
    expect(view.text()).toBe('success');
    expect(onSuccess).toHaveBeenCalledWith('fine', 'fine');
    expect(handle?.data.value).toBe('fine');

    expect(await handle?.mutate('bad')).toBeUndefined();
    expect(view.text()).toBe('error');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(handle?.fetching.value).toBe(false);

    handle?.reset();
    expect(view.text()).toBe('idle');
    expect(handle?.data.value).toBeUndefined();
    expect(states).toEqual(['idle', 'pending']);
  });
});

describe('useQueryClient', () => {
  it('hands back the provided client', () => {
    const client = createQueryClient();
    let seen: QueryClient | undefined;
    const Page = component(() => {
      seen = useQueryClient();
      return <p>ok</p>;
    });
    withClient(client, () => <Page />);
    expect(seen).toBe(client);
  });
});

describe('GraphQL', () => {
  const USER = `
    query User($id: ID!) @tag(name: "user", id: $id) { user(id: $id) { name } }
  `;
  const RENAME = `
    mutation Rename($id: ID!, $name: String!) @invalidates(name: "user", id: $id) {
      rename(id: $id, name: $name) { name }
    }
  `;

  /** Mounts under both a client and a transport. */
  function withGraphQL(
    client: QueryClient,
    transport: GraphQLTransport,
    inner: () => unknown,
  ): ReturnType<typeof mount> {
    const Root = component(() => {
      provide(QueryClientContext, client);
      provide(GraphQLContext, transport);
      return inner() as never;
    });
    return mount(() => <Root />);
  }

  it('takes its tags from the document and its data from the transport', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    // The types live on the document, the way the codegen plugin writes them.
    const document = parseGraphQL<{ user: { name: string } }, { id: number }>(USER);
    const transport = vi.fn(() => Promise.resolve({ user: { name: 'Ada' } }));
    const Page = component(() => {
      const user = useGraphQL(document, () => ({ id: 1 }));
      return <p>{user.data.value?.user.name ?? ''}</p>;
    });

    const view = withGraphQL(client, transport, () => <Page />);
    await tick();

    expect(view.text()).toBe('Ada');
    expect(
      client.entry({ tags: [tag('user', { id: 1 })], fetch: () => Promise.resolve(null) }).tags,
    ).toEqual([tag('user', { id: 1 })]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('invalidates what its `@invalidates` directive names', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    const names = ['Ada', 'Grace'];
    let index = 0;
    const transport: GraphQLTransport = (document, variables) => {
      if (document.kind === 'mutation') {
        return Promise.resolve({ rename: variables });
      }
      return Promise.resolve({ user: { name: names[Math.min(index++, 1)] } });
    };
    const Reader = component(() => {
      const user = useGraphQL(
        parseGraphQL<{ user: { name: string } }, { id: number }>(USER),
        () => ({ id: 1 }),
      );
      return <p id="name">{user.data.value?.user.name ?? ''}</p>;
    });
    const Writer = component(() => {
      const rename = useGraphQLMutation(
        parseGraphQL<unknown, { id: number; name: string }>(RENAME),
      );
      return <button onClick={() => void rename.mutate({ id: 1, name: 'Grace' })}>rename</button>;
    });

    const view = withGraphQL(client, transport, () => (
      <div>
        <Reader />
        <Writer />
      </div>
    ));
    await tick();
    expect(view.get('#name').textContent).toBe('Ada');

    view.get<HTMLButtonElement>('button').click();
    await tick();

    expect(view.get('#name').textContent).toBe('Grace');
  });

  it('lets a mutation override what it invalidates', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    let served = 0;
    const transport: GraphQLTransport = (document) =>
      document.kind === 'mutation'
        ? Promise.resolve({ ok: true })
        : Promise.resolve({ count: ++served });
    const Reader = component(() => {
      // No variables: the document may be given on its own.
      const value = useGraphQL(
        parseGraphQL<{ count: number }>('query Count @tag(name: "counter") { count }'),
      );
      return <i id="count">{String(value.data.value?.count ?? 0)}</i>;
    });
    const Writer = component(() => {
      const bump = useGraphQLMutation(parseGraphQL('mutation Bump { bump }'), {
        invalidates: [tag('counter')],
      });
      return <button onClick={() => void bump.mutate({})}>bump</button>;
    });

    const view = withGraphQL(client, transport, () => (
      <div>
        <Reader />
        <Writer />
      </div>
    ));
    await tick();
    expect(view.get('#count').textContent).toBe('1');

    view.get<HTMLButtonElement>('button').click();
    await tick();

    expect(view.get('#count').textContent).toBe('2');
  });

  it('defaults its variables to none', async () => {
    const client = createQueryClient();
    const transport = vi.fn(() => Promise.resolve({ me: 'you' }));
    const Page = component(() => {
      const me = useGraphQL(parseGraphQL<{ me: string }>('{ me }'));
      return <p>{me.data.value?.me ?? ''}</p>;
    });

    const view = withGraphQL(client, transport, () => <Page />);
    await tick();

    expect(view.text()).toBe('you');
  });
});
