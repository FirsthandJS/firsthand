/**
 * What a resource is, and — mostly — what it refuses to do.
 *
 * The first test is the one this design exists for: two loaders sharing a
 * coarse tag are two resources. Under the scheme this replaced they were one,
 * and the second silently showed the first one's data.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRoot, provide, signal } from '@firsthandjs/core';
import { DataContext, createData, tag, useResource } from '@firsthandjs/data';

const settle = (ms = 20): Promise<void> => new Promise((wake) => setTimeout(wake, ms));

/** Runs `body` under a store, and disposes it afterwards. */
function inRoot<T>(body: () => T, store = createData()): { value: T; stop: () => void } {
  let value!: T;
  let stop = (): void => {};
  createRoot((dispose) => {
    stop = dispose;
    provide(DataContext, store);
    value = body();
  });
  return { value, stop };
}

describe('identity', () => {
  it('is the call site, so a coarse tag shared by two loaders is not a collision', async () => {
    const calls: string[] = [];
    const { value, stop } = inRoot(() => ({
      users: useResource(({ tags }) => {
        tags(tag('directory'));
        calls.push('users');
        return Promise.resolve(['Ada', 'Grace']);
      }),
      teams: useResource(({ tags }) => {
        tags(tag('directory'));
        calls.push('teams');
        return Promise.resolve(['Platform', 'Design']);
      }),
    }));

    await settle();

    expect(calls.sort()).toEqual(['teams', 'users']);
    expect(value.users.data.value).toEqual(['Ada', 'Grace']);
    expect(value.teams.data.value).toEqual(['Platform', 'Design']);
    stop();
  });
});

describe('dependencies', () => {
  it('are whatever the loader read, as in an effect', async () => {
    const id = signal(1);
    const asked: number[] = [];
    const { stop } = inRoot(() =>
      useResource(({ tags }) => {
        tags(tag('user', { id: id.value }));
        asked.push(id.value);
        return Promise.resolve(`user ${String(id.value)}`);
      }),
    );

    await settle();
    id.value = 2;
    await settle();

    expect(asked).toEqual([1, 2]);
    stop();
  });

  it('abort the run they superseded', async () => {
    const id = signal(1);
    const aborted: boolean[] = [];
    const { stop } = inRoot(() =>
      useResource(async ({ signal: abort }) => {
        const asked = id.value;
        await settle(40);
        aborted.push(abort.aborted);
        return asked;
      }),
    );

    await settle(10);
    id.value = 2;
    await settle(80);

    expect(aborted[0]).toBe(true);
    stop();
  });
});

describe('tags', () => {
  it('replace rather than accumulate, before and after the await', async () => {
    const store = createData();
    const runs: string[] = [];
    const { stop } = inRoot(
      () =>
        useResource(async ({ tags }) => {
          runs.push('run');
          tags(tag('user'));
          await settle(5);
          tags(tag('user'), tag('user', { id: 5 }));
          return 'Ada';
        }),
      store,
    );

    await settle(40);
    expect(runs).toHaveLength(1);

    // The precise tag now matches.
    await store.invalidate(tag('user', { id: 5 }));
    await settle(40);
    expect(runs).toHaveLength(2);

    // And so does the coarse one, because the run named both.
    await store.invalidate(tag('user'));
    await settle(40);
    expect(runs).toHaveLength(3);
    stop();
  });

  it('do not match once a run has replaced them', async () => {
    const store = createData();
    const runs: number[] = [];
    let which = 'first';
    const { stop } = inRoot(
      () =>
        useResource(({ tags }) => {
          runs.push(runs.length);
          tags(tag(which));
          return Promise.resolve(which);
        }),
      store,
    );

    await settle();
    which = 'second';
    await store.invalidate(tag('first'));
    await settle(40);
    expect(runs).toHaveLength(2);

    // It is about `second` now; `first` no longer reaches it.
    await store.invalidate(tag('first'));
    await settle(40);
    expect(runs).toHaveLength(2);
    stop();
  });
});

describe('invalidation', () => {
  it('reaches only what carries a matching tag', async () => {
    const store = createData();
    const calls = { five: 0, seven: 0, list: 0 };
    const { stop } = inRoot(
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
        list: useResource(({ tags }) => {
          tags(tag('users'));
          calls.list++;
          return Promise.resolve(['five', 'seven']);
        }),
      }),
      store,
    );

    await settle();
    await store.invalidate(tag('user', { id: 5 }));
    await settle();

    expect(calls).toEqual({ five: 2, seven: 1, list: 1 });
    stop();
  });

  it('tells the loader why it is running, so it can reach past a transport cache', async () => {
    const store = createData();
    const forced: boolean[] = [];
    const { stop } = inRoot(
      () =>
        useResource(({ tags, force }) => {
          tags(tag('thing'));
          forced.push(force);
          return Promise.resolve('value');
        }),
      store,
    );

    await settle();
    await store.invalidate(tag('thing'));
    await settle();

    expect(forced).toEqual([false, true]);
    stop();
  });

  it('is not lost when it arrives before the tags are known', async () => {
    const store = createData();
    const runs: boolean[] = [];
    const { stop } = inRoot(
      () =>
        useResource(async ({ tags, force }) => {
          runs.push(force);
          // The id is only known after the answer, which is the whole case.
          await settle(40);
          tags(tag('user', { id: 5 }));
          return 'Ada';
        }),
      store,
    );

    await settle(10);
    // Sent while the first run is still out: nothing carries this tag yet.
    void store.invalidate(tag('user', { id: 5 }));
    await settle(120);

    // It ran again once the tags existed, rather than keeping an answer that
    // had already been declared stale.
    expect(runs).toEqual([false, true]);
    stop();
  });
});

describe('a failing loader', () => {
  it('reports through `error` and leaves the resource usable', async () => {
    const store = createData();
    const { value, stop } = inRoot(
      () => useResource(() => Promise.reject(new Error('offline'))),
      store,
    );

    await settle();

    expect(value.status.value).toBe('error');
    expect((value.error.value as Error).message).toBe('offline');
    expect(value.data.value).toBeUndefined();
    stop();
  });
});

describe('reload', () => {
  it('runs again, forced', async () => {
    const forced: boolean[] = [];
    const { value, stop } = inRoot(() =>
      useResource(({ force }) => {
        forced.push(force);
        return Promise.resolve('value');
      }),
    );

    await settle();
    await value.reload();

    expect(forced).toEqual([false, true]);
    stop();
  });
});

describe('leaving', () => {
  it('aborts what is in flight and stops answering', async () => {
    const store = createData();
    const seen: boolean[] = [];
    const { stop } = inRoot(
      () =>
        useResource(async ({ signal: abort }) => {
          await settle(40);
          seen.push(abort.aborted);
          return 'late';
        }),
      store,
    );

    await settle(10);
    stop();
    await settle(80);

    expect(seen[0]).toBe(true);
    expect(store.size).toBe(0);
    stop();
  });
});

describe('the store', () => {
  it('counts what is alive, and clear empties it', async () => {
    const store = createData();
    const { stop } = inRoot(
      () => ({
        a: useResource(() => Promise.resolve(1)),
        b: useResource(() => Promise.resolve(2)),
      }),
      store,
    );

    await settle();
    expect(store.size).toBe(2);

    store.clear();
    expect(store.size).toBe(0);
    stop();
  });

  it('reports an invalidation that matched nothing as matching nothing', async () => {
    const store = createData();
    const run = vi.fn(() => Promise.resolve('value'));
    const { stop } = inRoot(
      () =>
        useResource(({ tags }) => {
          tags(tag('thing'));
          return run();
        }),
      store,
    );

    await settle();
    await store.invalidate(tag('something-else'));
    await settle();

    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });
});
