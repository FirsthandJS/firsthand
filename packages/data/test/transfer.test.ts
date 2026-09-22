/**
 * Answers that cross the wire.
 *
 * A server renders with data, writes what it learned into a page, and the
 * browser starts from that rather than from nothing. The storage is what
 * carries it, and the only thing it has to do differently from any other
 * storage is answer **now** — a value that arrives a microtask later arrives
 * after the render that needed it.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRoot } from '@firsthandjs/core';
import {
  createData,
  createMemoryStorage,
  serialize,
  useResource,
  DataContext,
} from '@/index.js';
import { provide } from '@firsthandjs/core';

describe('a memory storage', () => {
  it('starts empty', () => {
    const storage = createMemoryStorage();
    expect(storage.size).toBe(0);
    expect(storage.read?.('a')).toBeUndefined();
  });

  it('starts from what it was given', () => {
    const storage = createMemoryStorage({ a: 1 });
    expect(storage.size).toBe(1);
    expect(storage.read?.('a')).toBe(1);
  });

  it('keeps what is written and hands it all back', () => {
    const storage = createMemoryStorage();
    storage.write?.('a', 1);
    storage.write?.('b', 2);
    expect(storage.dump()).toEqual({ a: 1, b: 2 });
  });

  it('takes answers in without losing the ones already there', () => {
    const storage = createMemoryStorage({ a: 1 });
    storage.seed({ b: 2 });
    expect(storage.dump()).toEqual({ a: 1, b: 2 });
  });

  it('forgets everything when a sign-out says to', () => {
    const storage = createMemoryStorage({ a: 1 });
    storage.clear?.();
    expect(storage.size).toBe(0);
  });
});

describe('what a page carries', () => {
  it('cannot close the script element it is written into', () => {
    expect(serialize({ note: '</script>' })).toBe('{"note":"\\u003c/script>"}');
  });

  it('escapes the line separators JSON allows and JavaScript does not', () => {
    expect(serialize('a\u2028b\u2029c')).toBe('"a\\u2028b\\u2029c"');
  });

  it('reads back as what it was', () => {
    const value = { a: 1, b: ['</b>', null, '\u2028'] };
    expect(JSON.parse(serialize(value))).toEqual(value);
  });
});

describe('a named resource with a storage that answers at once', () => {
  it('has its value during the run that created it', () => {
    const storage = createMemoryStorage({ greeting: 'hello' });
    const store = createData({ storage });
    createRoot((dispose) => {
      provide(DataContext, store);
      const greeting = useResource(() => Promise.resolve('later'), { persist: 'greeting' });
      expect(greeting.data.peek()).toBe('hello');
      dispose();
    });
  });

  it('treats a storage that throws as a storage with nothing in it', () => {
    const store = createData({
      storage: {
        read: () => {
          throw new Error('no');
        },
      },
    });
    createRoot((dispose) => {
      provide(DataContext, store);
      const greeting = useResource(() => Promise.resolve('later'), { persist: 'greeting' });
      expect(greeting.data.peek()).toBeUndefined();
      dispose();
    });
  });

  it('still waits for a storage that answers later', async () => {
    const store = createData({
      storage: { read: () => Promise.resolve('hello') },
    });
    await createRoot(async (dispose) => {
      provide(DataContext, store);
      const greeting = useResource(() => new Promise<string>(() => undefined), {
        persist: 'greeting',
      });
      expect(greeting.data.peek()).toBeUndefined();
      await Promise.resolve();
      await Promise.resolve();
      expect(greeting.data.peek()).toBe('hello');
      dispose();
    });
  });

  it('drops what a storage says after the loader has answered', async () => {
    const store = createData({
      storage: { read: () => Promise.resolve('stale') },
    });
    await createRoot(async (dispose) => {
      provide(DataContext, store);
      const greeting = useResource(() => Promise.resolve('fresh'), { persist: 'greeting' });
      await store.settle();
      expect(greeting.data.peek()).toBe('fresh');
      dispose();
    });
  });

  it('treats a rejected read as an empty one', async () => {
    const store = createData({
      storage: { read: () => Promise.reject(new Error('no')) },
    });
    await createRoot(async (dispose) => {
      provide(DataContext, store);
      const greeting = useResource(() => Promise.resolve('fresh'), { persist: 'greeting' });
      await Promise.resolve();
      expect(greeting.error.peek()).toBeUndefined();
      await store.settle();
      expect(greeting.data.peek()).toBe('fresh');
      dispose();
    });
  });
});

describe('waiting for a store', () => {
  it('returns at once when nothing is loading', async () => {
    const store = createData();
    await expect(store.settle()).resolves.toBeUndefined();
  });

  it('waits for what is out', async () => {
    const store = createData();
    let answered = false;
    await createRoot(async (dispose) => {
      provide(DataContext, store);
      useResource(async () => {
        await Promise.resolve();
        answered = true;
        return 'x';
      });
      await store.settle();
      expect(answered).toBe(true);
      dispose();
    });
  });

  it('stops after the passes it was given rather than never', async () => {
    const store = createData();
    const load = vi.fn(() => new Promise<string>(() => undefined));
    await createRoot(async (dispose) => {
      provide(DataContext, store);
      useResource(load);
      // One pass: it looks, finds something out, and this resolves only
      // because the race below does.
      const settled = await Promise.race([
        store.settle(1).then(() => 'settled'),
        Promise.resolve('still waiting'),
      ]);
      expect(settled).toBe('still waiting');
      dispose();
    });
  });
});
