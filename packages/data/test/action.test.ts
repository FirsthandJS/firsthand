/**
 * Actions, the bridges, and keeping something between visits.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRoot, provide } from '@firsthandjs/core';
import {
  DataContext,
  createData,
  fromObservable,
  fromPromise,
  tag,
  useAction,
  useInvalidate,
  useResource,
  type DataStore,
} from '@firsthandjs/data';

const settle = (ms = 20): Promise<void> => new Promise((wake) => setTimeout(wake, ms));

function inRoot<T>(body: () => T, store: DataStore = createData()): { value: T; stop: () => void } {
  let value!: T;
  let stop = (): void => {};
  createRoot((dispose) => {
    stop = dispose;
    provide(DataContext, store);
    value = body();
  });
  return { value, stop };
}

describe('an action', () => {
  it('invalidates what the server says it changed', async () => {
    const store = createData();
    const calls = { five: 0, seven: 0 };
    const { value, stop } = inRoot(
      () => ({
        five: useResource(({ tags }) => {
          tags(tag('user', { id: 5 }));
          calls.five++;
          return Promise.resolve('five');
        }),
        seven: useResource(({ tags }) => {
          tags(tag('user', { id: 7 }));
          calls.seven++;
          return Promise.resolve('seven');
        }),
        // The caller knows a name; only the server knows which id that is.
        rename: useAction(async (input: { name: string }, { invalidates }) => {
          const answer = { id: 5, name: input.name, tags: [tag('user', { id: 5 })] };
          await settle(5);
          invalidates(...answer.tags);
          return answer;
        }),
      }),
      store,
    );

    await settle();
    await value.rename.run({ name: 'ada' });
    await settle();

    expect(calls).toEqual({ five: 2, seven: 1 });
    stop();
  });

  it('reports a failure without rejecting', async () => {
    const { value, stop } = inRoot(() => useAction(() => Promise.reject(new Error('refused'))));

    const result = await value.run(undefined);

    expect(result).toBeUndefined();
    expect(value.status.value).toBe('error');
    expect((value.error.value as Error).message).toBe('refused');
    stop();
  });

  it('holds its result', async () => {
    const { value, stop } = inRoot(() => useAction((input: number) => Promise.resolve(input * 2)));

    await value.run(21);

    expect(value.data.value).toBe(42);
    expect(value.status.value).toBe('success');
    stop();
  });
});

describe('fromObservable', () => {
  it('turns what a source pushes into a resource', () => {
    let push: ((value: string) => void) | undefined;
    const { value, stop } = inRoot(() =>
      fromObservable<string>({
        subscribe: (observer) => {
          push = observer.next;
          return () => {};
        },
      }),
    );

    expect(value.status.value).toBe('loading');
    push?.('first');
    expect(value.data.value).toBe('first');
    push?.('second');
    expect(value.data.value).toBe('second');
    stop();
  });

  it('takes an unsubscribe object as well as a function', () => {
    const unsubscribe = vi.fn();
    const { value, stop } = inRoot(() =>
      fromObservable<string>({ subscribe: () => ({ unsubscribe }) }),
    );

    value.dispose();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    stop();
  });

  it('reports an error the source pushes', () => {
    let fail: ((error: unknown) => void) | undefined;
    const { value, stop } = inRoot(() =>
      fromObservable<string>({
        subscribe: (observer) => {
          fail = observer.error;
          return () => {};
        },
      }),
    );

    fail?.(new Error('stream closed'));

    expect(value.status.value).toBe('error');
    stop();
  });

  it('reloads through the source when it can', async () => {
    const reload = vi.fn(() => Promise.resolve());
    const { value, stop } = inRoot(() =>
      fromObservable<string>({ subscribe: () => () => {} }, { reload }),
    );

    await value.reload();

    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does nothing on reload when the source cannot', async () => {
    const { value, stop } = inRoot(() => fromObservable<string>({ subscribe: () => () => {} }));

    await expect(value.reload()).resolves.toBeUndefined();
    stop();
  });

  it('unsubscribes when the scope goes', () => {
    const unsubscribe = vi.fn();
    const { stop } = inRoot(() => fromObservable<string>({ subscribe: () => unsubscribe }));

    stop();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('fromPromise', () => {
  it('is a resource with no tags and no dependencies', async () => {
    const { value, stop } = inRoot(() => fromPromise(() => Promise.resolve('once')));

    await settle();

    expect(value.data.value).toBe('once');
    stop();
  });
});

describe('persistence', () => {
  const memory = (seed: Record<string, unknown> = {}) => {
    const kept = new Map<string, unknown>(Object.entries(seed));
    return {
      kept,
      read: (name: string) => kept.get(name),
      write: (name: string, data: unknown) => void kept.set(name, data),
      clear: () => void kept.clear(),
    };
  };

  it('shows what was kept before the loader answers', async () => {
    const storage = memory({ profile: 'from storage' });
    const store = createData({ storage });
    const seen: (string | undefined)[] = [];
    const { value, stop } = inRoot(
      () =>
        useResource(
          async () => {
            await settle(60);
            return 'from the network';
          },
          { persist: 'profile' },
        ),
      store,
    );

    await settle(20);
    seen.push(value.data.value);
    await settle(80);
    seen.push(value.data.value);

    expect(seen).toEqual(['from storage', 'from the network']);
    stop();
  });

  it('writes after a successful run, under the name', async () => {
    const storage = memory();
    const store = createData({ storage });
    const { stop } = inRoot(
      () => useResource(() => Promise.resolve('fresh'), { persist: 'profile' }),
      store,
    );

    await settle();

    expect([...storage.kept.entries()]).toEqual([['profile', 'fresh']]);
    stop();
  });

  it('keeps nothing for a resource that was not named', async () => {
    const storage = memory();
    const store = createData({ storage });
    const { stop } = inRoot(() => useResource(() => Promise.resolve('fresh')), store);

    await settle();

    expect(storage.kept.size).toBe(0);
    stop();
  });

  it('does not overwrite an answer that arrived first', async () => {
    const store = createData({
      storage: {
        read: async () => {
          await settle(60);
          return 'stored, and late';
        },
        write: () => {},
      },
    });
    const { value, stop } = inRoot(
      () => useResource(() => Promise.resolve('from the network'), { persist: 'profile' }),
      store,
    );

    await settle(120);

    expect(value.data.value).toBe('from the network');
    stop();
  });

  it('cannot break a resource by failing', async () => {
    const store = createData({
      storage: {
        read: () => Promise.reject(new Error('quota')),
        write: () => {
          throw new Error('quota');
        },
        clear: () => {
          throw new Error('quota');
        },
      },
    });
    const { value, stop } = inRoot(
      () => useResource(() => Promise.resolve('fine'), { persist: 'profile' }),
      store,
    );

    await settle(40);

    expect(value.data.value).toBe('fine');
    expect(() => store.clear()).not.toThrow();
    stop();
  });

  it('is emptied by clear, because that is what a sign-out means', async () => {
    const storage = memory();
    const store = createData({ storage });
    const { stop } = inRoot(
      () => useResource(() => Promise.resolve('secret'), { persist: 'profile' }),
      store,
    );

    await settle();
    expect(storage.kept.size).toBe(1);

    store.clear();

    expect(storage.kept.size).toBe(0);
    stop();
  });
});

describe('the edges', () => {
  it('invalidates through the store the component is under', async () => {
    const store = createData();
    let runs = 0;
    const { value, stop } = inRoot(
      () => ({
        thing: useResource(({ tags }) => {
          tags(tag('thing'));
          runs++;
          return Promise.resolve('value');
        }),
        invalidate: useInvalidate(),
      }),
      store,
    );

    await settle();
    await value.invalidate(tag('thing'));
    await settle();

    expect(runs).toBe(2);
    stop();
  });

  it('says nothing more once the resource has been disposed', async () => {
    const { value, stop } = inRoot(() => useResource(() => Promise.resolve('value')));

    await settle();
    value.dispose();

    await expect(value.reload()).resolves.toBeUndefined();
    stop();
  });

  it('drops a failure that lands after the run was superseded', async () => {
    const store = createData();
    const { value, stop } = inRoot(
      () =>
        useResource(async ({ signal: abort }) => {
          await settle(40);
          if (abort.aborted) {
            throw new Error('too late');
          }
          return 'value';
        }),
      store,
    );

    await settle(10);
    void value.reload();
    await settle(120);

    // The superseded run threw; the resource is not in error because of it.
    expect(value.status.value).toBe('success');
    stop();
  });

  it('drops an action that was superseded while it was out', async () => {
    const { value, stop } = inRoot(() =>
      useAction(async (input: string) => {
        await settle(40);
        return input;
      }),
    );

    const first = value.run('one');
    await settle(5);
    const second = value.run('two');

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBe('two');
    stop();
  });
});

describe('devtools', () => {
  it('reports a tag the way a person writes it', async () => {
    const seen: { event: string; tags: readonly string[] }[] = [];
    const hook = {
      attached: true,
      label: () => {},
      cause: () => {},
      root: () => {},
      component: () => {},
      running: () => {},
      part: () => {},
      query: (event: string, _key: string, tags: readonly string[]) => seen.push({ event, tags }),
    };
    (globalThis as { __FIRSTHAND_DEVTOOLS__?: unknown }).__FIRSTHAND_DEVTOOLS__ = hook;

    const store = createData();
    const { stop } = inRoot(
      () =>
        useResource(({ tags }) => {
          tags(tag('user', { id: 5 }), tag('directory'));
          return Promise.resolve('Ada');
        }),
      store,
    );
    await settle();
    await store.invalidate(tag('user', { id: 5 }));
    await settle();

    delete (globalThis as { __FIRSTHAND_DEVTOOLS__?: unknown }).__FIRSTHAND_DEVTOOLS__;

    const invalidated = seen.find((entry) => entry.event === 'invalidated');
    expect(invalidated?.tags).toEqual(['user(id: 5)', 'directory']);
    stop();
  });

  it('drops an action failure that lands after the action was superseded', async () => {
    const { value, stop } = inRoot(() =>
      useAction(async (input: string) => {
        await settle(40);
        throw new Error(input);
      }),
    );

    const first = value.run('one');
    await settle(5);
    const second = value.run('two');

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    // The first failure was dropped; the visible error is the second's.
    expect((value.error.value as Error).message).toBe('two');
    stop();
  });
});
