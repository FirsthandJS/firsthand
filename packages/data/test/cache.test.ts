/**
 * The cache: lifetimes, sharing, and the invalidation that reaches through.
 *
 * It is one cache for two jobs — the fetch client's answers and an algorithm
 * of your own — so every test here is written against the second, which is the
 * one with nothing else in the way.
 */
import { describe, expect, it, vi } from 'vitest';
import { createCacheClient, stableKey, type DataRequest } from '@firsthandjs/data';

const ask = (force = false): DataRequest => ({
  signal: new AbortController().signal,
  force,
});

/** A producer that counts its runs and answers what it was told to. */
function counted<T>(answer: T, delay = 0) {
  const calls: DataRequest[] = [];
  const produce = async (request: DataRequest): Promise<T> => {
    calls.push(request);
    if (delay > 0) {
      await new Promise((wake) => setTimeout(wake, delay));
    }
    return answer;
  };
  return { calls, produce };
}

describe('createCacheClient', () => {
  it('runs the producer, and with no lifetime keeps nothing', async () => {
    const cache = createCacheClient();
    const { calls, produce } = counted('once');

    await expect(cache.read('k', produce)(ask())).resolves.toBe('once');
    await expect(cache.read('k', produce)(ask())).resolves.toBe('once');

    expect(calls).toHaveLength(2);
    // Nothing is held: the entry existed only while the run was in flight.
    expect(cache.size).toBe(0);
  });

  it('serves a fresh answer without running the producer again', async () => {
    let now = 1000;
    const cache = createCacheClient({ ttl: 100, now: () => now });
    const { calls, produce } = counted('kept');

    await cache.read('k', produce)(ask());
    now = 1050;
    await expect(cache.read('k', produce)(ask())).resolves.toBe('kept');
    expect(calls).toHaveLength(1);

    // And asks again once the lifetime is over.
    now = 1200;
    await cache.read('k', produce)(ask());
    expect(calls).toHaveLength(2);
  });

  it('shares one run between callers that overlap, at any lifetime', async () => {
    const cache = createCacheClient();
    const { calls, produce } = counted('shared', 5);

    const both = await Promise.all([
      cache.read('k', produce)(ask()),
      cache.read('k', produce)(ask()),
    ]);

    expect(both).toEqual(['shared', 'shared']);
    // Two callers, one request: this is deduplication, and it lives here
    // rather than in the store, because here is where identity is known.
    expect(calls).toHaveLength(1);
  });

  it('lets an invalidation reach through: `force` drops what is held', async () => {
    const cache = createCacheClient({ ttl: 10_000 });
    const { calls, produce } = counted('fresh');

    await cache.read('k', produce)(ask());
    await cache.read('k', produce)(ask(true));

    expect(calls).toHaveLength(2);
    expect(calls[1]?.force).toBe(true);
  });

  it('keeps one run alive while anybody is still waiting for it', async () => {
    const cache = createCacheClient();
    const { calls, produce } = counted('slow', 10);
    const leaving = new AbortController();

    const gone = cache.read('k', produce)({ signal: leaving.signal, force: false });
    const staying = cache.read('k', produce)(ask());
    leaving.abort();

    // The one that left gets the answer anyway; the point is that the run was
    // not cancelled under the one that stayed.
    await expect(staying).resolves.toBe('slow');
    await expect(gone).resolves.toBe('slow');
    expect(calls[0]?.signal.aborted).toBe(false);
  });

  it('ends the run when the last waiter leaves', async () => {
    const cache = createCacheClient();
    const { calls, produce } = counted('nobody', 20);
    const alone = new AbortController();

    const asked = cache.read('k', produce)({ signal: alone.signal, force: false });
    alone.abort();
    await asked;

    expect(calls[0]?.signal.aborted).toBe(true);
  });

  it('keeps nothing when a run that was already forgotten then fails', async () => {
    const cache = createCacheClient({ ttl: 10_000 });
    // A producer that fails *because* it was aborted, which is what a real one
    // does: the entry it belonged to is gone by then, and it must not write
    // itself back over whatever took its place.
    const produce = (request: DataRequest): Promise<string> =>
      new Promise((_, fail) => {
        request.signal.addEventListener('abort', () => fail(new Error('aborted')));
      });

    const asked = cache.read('k', produce)(ask());
    cache.forget('k');
    cache.write('k', 'written since');

    await expect(asked).rejects.toThrow('aborted');
    expect(cache.peek('k')).toBe('written since');
  });

  it('does not keep a failure: the next caller asks again', async () => {
    const cache = createCacheClient({ ttl: 10_000 });
    const produce = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('back');

    await expect(cache.read('k', produce)(ask())).rejects.toThrow('offline');
    await expect(cache.read('k', produce)(ask())).resolves.toBe('back');
    expect(cache.size).toBe(1);
  });

  it('stays out of an action’s way: run, not served, not kept', async () => {
    const cache = createCacheClient({ ttl: 10_000 });
    const { calls, produce } = counted('done');
    cache.write('k', 'from a read');

    // What an action hands a client: it changes something. Even with a fresh
    // entry sitting there under the same key, the producer runs…
    const changing: DataRequest = {
      signal: new AbortController().signal,
      force: true,
      mutating: true,
    };
    await expect(cache.read('k', produce)(changing)).resolves.toBe('done');
    expect(calls).toHaveLength(1);

    // …and what it answered is not kept: a write is not a representation, so
    // the next read must not be given it.
    expect(cache.peek('k')).toBe('from a read');
  });

  it('forgets one key, and everything', async () => {
    const cache = createCacheClient({ ttl: 10_000 });
    const { calls, produce } = counted('kept');

    await cache.read('a', produce)(ask());
    await cache.read('b', produce)(ask());
    expect(cache.size).toBe(2);

    cache.forget('a');
    expect(cache.size).toBe(1);
    await cache.read('a', produce)(ask());
    expect(calls).toHaveLength(3);

    cache.forget();
    expect(cache.size).toBe(0);
  });

  it('drops the entry read longest ago when it is full', async () => {
    const cache = createCacheClient({ ttl: 10_000, max: 2 });
    const { produce } = counted('kept');

    await cache.read('a', produce)(ask());
    await cache.read('b', produce)(ask());
    // Reading `a` again makes `b` the oldest.
    await cache.read('a', produce)(ask());
    await cache.read('c', produce)(ask());

    expect(cache.peek('b')).toBeUndefined();
    expect(cache.peek('a')).toBe('kept');
    expect(cache.peek('c')).toBe('kept');
  });

  it('takes a value written by hand, and keeps it without a lifetime', () => {
    const cache = createCacheClient();
    cache.write('pushed', { id: 7 });

    // A value handed over is not an answer that might already be stale.
    expect(cache.peek('pushed')).toEqual({ id: 7 });
  });

  it('reads back a value written by hand rather than running the producer', async () => {
    const cache = createCacheClient({ ttl: 1000 });
    const { calls, produce } = counted('asked');
    cache.write('k', 'written');

    await expect(cache.read('k', produce)(ask())).resolves.toBe('written');
    expect(calls).toHaveLength(0);
  });

  it('says nothing is there when it has expired', () => {
    let now = 1000;
    const cache = createCacheClient({ ttl: 50, now: () => now });
    cache.write('k', 'kept');

    now = 1100;
    expect(cache.peek('k')).toBeUndefined();
    expect(cache.peek('never-written')).toBeUndefined();
  });

  it('builds a key that does not depend on how the value was written', () => {
    // The whole point: two objects that mean the same request must key the
    // same, and two that do not must not.
    expect(stableKey({ a: 1, b: [2, 'x'] })).toBe(stableKey({ b: [2, 'x'], a: 1 }));
    expect(stableKey({ page: 1 })).not.toBe(stableKey({ page: 2 }));
    // `undefined` and absent are the same thing to a server.
    expect(stableKey({ a: 1, b: undefined })).toBe(stableKey({ a: 1 }));
    // A date is a date, not `{}` — the object branch would make every one of
    // them one key.
    expect(stableKey(new Date('2026-01-01'))).not.toBe(stableKey(new Date('2026-02-01')));
    expect(stableKey(undefined)).toBe('undefined');
    expect(stableKey(null)).toBe('null');
    expect(stableKey('x')).toBe('"x"');
  });

  /**
   * Two requests that are not the same request must not share an answer.
   *
   * A key that collides is worse than a key that misses: a miss costs a
   * request, and a collision serves one caller the other one's data. Every
   * case here used to collide, because `JSON.stringify` answers `null` for
   * anything it has no syntax for and `undefined` — as a value of type
   * `string` — for anything it refuses outright.
   */
  describe('a key that has to stay distinct', () => {
    it('keeps the numbers JSON has no syntax for apart', () => {
      const keys = [stableKey(NaN), stableKey(Infinity), stableKey(-Infinity), stableKey(null)];

      expect(new Set(keys).size).toBe(4);
      expect(stableKey(NaN)).toBe('NaN');
    });

    it('keeps a Map, a Set and a plain object apart', () => {
      const keys = [
        stableKey(new Map([['a', 1]])),
        stableKey(new Set(['a'])),
        stableKey({ a: 1 }),
        stableKey(/a/u),
      ];

      expect(new Set(keys).size).toBe(4);
    });

    it('reads what is inside a Map and a Set, in a stable order', () => {
      expect(
        stableKey(
          new Map([
            ['a', 1],
            ['b', 2],
          ]),
        ),
      ).toBe(
        stableKey(
          new Map([
            ['b', 2],
            ['a', 1],
          ]),
        ),
      );
      expect(stableKey(new Map([['a', 1]]))).not.toBe(stableKey(new Map([['a', 2]])));
      expect(stableKey(new Set([1, 2]))).toBe(stableKey(new Set([2, 1])));
      expect(stableKey(new Set([1]))).not.toBe(stableKey(new Set([2])));
    });

    it('tells two regular expressions apart, flags included', () => {
      expect(stableKey(/a/u)).not.toBe(stableKey(/b/u));
      expect(stableKey(/a/u)).not.toBe(stableKey(/a/giu));
    });

    it('keys a BigInt instead of throwing on it', () => {
      expect(stableKey(1n)).toBe('1n');
      // Not the number 1: a server told `1` and told `1n` was told two
      // different things.
      expect(stableKey(1n)).not.toBe(stableKey(1));
    });

    it('gives a function and a symbol an identity rather than one shared key', () => {
      const one = (): void => undefined;
      const other = (): void => undefined;

      expect(stableKey(one)).toBe(stableKey(one));
      expect(stableKey(one)).not.toBe(stableKey(other));
      expect(stableKey(Symbol('a'))).not.toBe(stableKey(Symbol('a')));
      // And none of them is `undefined`, which is what they all used to be.
      expect(stableKey(one)).not.toBe('undefined');
    });

    it('survives a value that contains itself', () => {
      const self: Record<string, unknown> = { page: 1 };
      self['self'] = self;

      // A stack overflow is not an answer a caller can act on either.
      expect(stableKey(self)).toBe('{page:1,self:[cycle]}');
    });

    it('treats the same object twice as two ordinary occurrences', () => {
      const shared = { a: 1 };

      // Not a cycle: nothing here contains itself, and keying the second one
      // as `[cycle]` would make two different requests look alike.
      expect(stableKey({ one: shared, other: shared })).toBe(
        stableKey({ one: shared, other: { a: 1 } }),
      );
    });
  });

  it('aborts what is in flight when the entry is forgotten', async () => {
    const cache = createCacheClient({ ttl: 1000 });
    const { calls, produce } = counted('late', 20);

    const asked = cache.read('k', produce)(ask());
    cache.forget('k');
    await asked;

    expect(calls[0]?.signal.aborted).toBe(true);
    // And the answer that arrived late is not kept: the entry it belonged to
    // is gone, and writing it back would resurrect what was just forgotten.
    expect(cache.peek('k')).toBeUndefined();
  });
});
