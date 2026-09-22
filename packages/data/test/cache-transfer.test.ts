/**
 * The cache as the place a server's answers have names.
 *
 * `dump` and `seed` exist because the transport's cache is the one part of the
 * data layer that is keyed — a resource is not, deliberately (ADR-0022) — so
 * it is the only place an answer can be handed from one process to another
 * without inventing an identity for it.
 */
import { describe, expect, it } from 'vitest';
import { createCacheClient } from '@/index.js';

const request = { signal: new AbortController().signal, force: false, tags: () => undefined };

describe('dumping a cache', () => {
  it('is empty when the cache is', () => {
    expect(createCacheClient().dump()).toEqual({});
  });

  it('is empty without a ttl, because a run that answered kept nothing', async () => {
    const cache = createCacheClient();
    await cache.read('a', () => Promise.resolve('x'))(request);
    expect(cache.dump()).toEqual({});
  });

  it('holds what was written', () => {
    const cache = createCacheClient();
    cache.write('a', 1);
    expect(cache.dump()).toEqual({ a: 1 });
  });

  it('leaves out what is still on its way', async () => {
    const cache = createCacheClient({ ttl: 1000 });
    let answer!: (value: string) => void;
    const produce = cache.read('a', () => new Promise<string>((done) => (answer = done)));
    const out = produce(request);
    expect(cache.dump()).toEqual({});
    answer('x');
    await out;
    expect(cache.dump()).toEqual({ a: 'x' });
  });

  it('holds an answer that is no longer fresh, because a handover is not a read', () => {
    let clock = 0;
    const cache = createCacheClient({ ttl: 10, now: () => clock });
    cache.write('a', 1);
    clock = 20;
    expect(cache.peek('a')).toBeUndefined();
    expect(cache.dump()).toEqual({ a: 1 });
  });
});

describe('seeding a cache', () => {
  it('serves what a server produced without running anything', () => {
    const cache = createCacheClient();
    cache.seed({ a: 1 });
    expect(cache.peek('a')).toBe(1);
  });

  it('adds to what is there', () => {
    const cache = createCacheClient();
    cache.write('a', 1);
    cache.seed({ b: 2 });
    expect(cache.dump()).toEqual({ a: 1, b: 2 });
  });
});

describe('waiting for a cache', () => {
  it('returns at once when nothing is running', async () => {
    await expect(createCacheClient().settle()).resolves.toBeUndefined();
  });

  it('waits for what is running, and steps over what is not', async () => {
    const cache = createCacheClient();
    cache.write('settled', 1);
    let done = false;
    void cache.read('a', async () => {
      await Promise.resolve();
      done = true;
      return 'x';
    })(request);
    await cache.settle();
    expect(done).toBe(true);
  });

  it('counts a producer that failed as one that finished', async () => {
    const cache = createCacheClient();
    void cache
      .read('a', () => Promise.reject(new Error('no')))(request)
      .catch(() => undefined);
    await expect(cache.settle()).resolves.toBeUndefined();
  });

  it('stops after the passes it was given rather than never', async () => {
    const cache = createCacheClient();
    void cache.read('a', () => new Promise<string>(() => undefined))(request);
    const first = await Promise.race([
      cache.settle(1).then(() => 'settled'),
      Promise.resolve('still waiting'),
    ]);
    expect(first).toBe('still waiting');
  });
});
