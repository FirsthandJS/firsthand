import { describe, expect, it, vi } from 'vitest';
import { computed, createRoot, effect, signal, untrack } from '../src/index.js';
import { FirsthandReadonlyError } from '../src/errors.js';

describe('signal', () => {
  it('reads and writes a value', () => {
    const count = signal(0);
    expect(count.value).toBe(0);
    count.value = 3;
    expect(count.value).toBe(3);
  });

  it('holds any JavaScript value by reference', () => {
    const object = { nested: { deep: true } };
    const cell = signal(object);
    expect(cell.value).toBe(object);
    expect(cell.value.nested).toBe(object.nested);
  });

  it('does not notify when the new value is Object.is-equal', () => {
    const count = signal(0);
    const runs = vi.fn();
    createRoot((dispose) => {
      effect(() => {
        count.value;
        runs();
      });
      expect(runs).toHaveBeenCalledTimes(1);
      count.value = 0;
      expect(runs).toHaveBeenCalledTimes(1);
      count.value = 1;
      expect(runs).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('settles NaN, because equality is Object.is', () => {
    const cell = signal(Number.NaN);
    const runs = vi.fn();
    createRoot((dispose) => {
      effect(() => {
        cell.value;
        runs();
      });
      cell.value = Number.NaN;
      expect(runs).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it('notifies on every write when equals is false', () => {
    const items = signal<number[]>([], { equals: false });
    const runs = vi.fn();
    createRoot((dispose) => {
      effect(() => {
        items.value;
        runs();
      });
      const same = items.value;
      items.value = same;
      expect(runs).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('accepts a custom equality function', () => {
    const cell = signal({ id: 1, label: 'a' }, { equals: (a, b) => a.id === b.id });
    const runs = vi.fn();
    createRoot((dispose) => {
      effect(() => {
        cell.value;
        runs();
      });
      cell.value = { id: 1, label: 'b' };
      expect(runs).toHaveBeenCalledTimes(1);
      cell.value = { id: 2, label: 'b' };
      expect(runs).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('peek() reads without subscribing', () => {
    const count = signal(0);
    const runs = vi.fn();
    createRoot((dispose) => {
      effect(() => {
        count.peek();
        runs();
      });
      count.value = 1;
      expect(runs).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it('set() applies a functional update', () => {
    const count = signal(1);
    count.set((n) => n + 41);
    expect(count.value).toBe(42);
  });

  it('writes without subscribers do not schedule anything', () => {
    const lonely = signal(0);
    lonely.value = 1;
    expect(lonely.value).toBe(1);
  });

  it('a handler reading a signal always sees the current value', () => {
    const count = signal(0);
    const handler = (): number => count.value;
    count.value = 7;
    expect(handler()).toBe(7);
  });

  it('a value captured by ordinary JavaScript stays captured', () => {
    const count = signal(0);
    const snapshot = count.value;
    count.value = 7;
    expect(snapshot).toBe(0);
  });

  it('rejects writing to a computed', () => {
    const count = signal(1);
    createRoot((dispose) => {
      const doubled = computed(() => count.value * 2);
      expect(() => {
        (doubled as { value: number }).value = 4;
      }).toThrow(FirsthandReadonlyError);
      expect(() => {
        (doubled as unknown as { set(f: (n: number) => number): void }).set((n) => n + 1);
      }).toThrow(FirsthandReadonlyError);
      dispose();
    });
  });

  it('untrack reads without subscribing', () => {
    const a = signal(1);
    const b = signal(1);
    const runs = vi.fn();
    createRoot((dispose) => {
      effect(() => {
        a.value;
        untrack(() => b.value);
        runs();
      });
      b.value = 2;
      expect(runs).toHaveBeenCalledTimes(1);
      a.value = 2;
      expect(runs).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('untrack restores tracking even when the body throws', () => {
    const a = signal(1);
    const runs = vi.fn();
    createRoot((dispose) => {
      effect(() => {
        try {
          untrack(() => {
            throw new Error('inner');
          });
        } catch {
          /* observed below */
        }
        a.value;
        runs();
      });
      a.value = 2;
      expect(runs).toHaveBeenCalledTimes(2);
      dispose();
    });
  });
});
