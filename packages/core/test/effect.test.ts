import { describe, expect, it, vi } from 'vitest';
import { batch, computed, createRoot, effect, onCleanup, signal } from '@/index.js';

describe('effect', () => {
  it('runs immediately and on every relevant change', () => {
    const count = signal(0);
    const seen: number[] = [];
    createRoot((dispose) => {
      effect(() => {
        seen.push(count.value);
      });
      count.value = 1;
      count.value = 2;
      expect(seen).toEqual([0, 1, 2]);
      dispose();
    });
  });

  it('stops running after its disposer is called', () => {
    const count = signal(0);
    const runs = vi.fn();
    createRoot((dispose) => {
      const stop = effect(() => {
        count.value;
        runs();
      });
      stop();
      count.value = 1;
      expect(runs).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it('runs the returned cleanup before each re-run and on disposal', () => {
    const count = signal(0);
    const cleanups: number[] = [];
    createRoot((dispose) => {
      effect(() => {
        const seen = count.value;
        return () => cleanups.push(seen);
      });
      count.value = 1;
      expect(cleanups).toEqual([0]);
      dispose();
      expect(cleanups).toEqual([0, 1]);
    });
  });

  it('accepts a body that returns nothing', () => {
    const count = signal(0);
    createRoot((dispose) => {
      effect(() => {
        count.value;
      });
      count.value = 1;
      dispose();
    });
    expect(count.value).toBe(1);
  });

  it('runs onCleanup callbacks in reverse registration order', () => {
    const order: string[] = [];
    createRoot((dispose) => {
      effect(() => {
        onCleanup(() => order.push('first'));
        onCleanup(() => order.push('second'));
      });
      dispose();
    });
    expect(order).toEqual(['second', 'first']);
  });

  it('re-observes dependencies on each run, so conditional reads drop them', () => {
    const use = signal(true);
    const a = signal(1);
    const b = signal(1);
    const runs = vi.fn();
    createRoot((dispose) => {
      effect(() => {
        if (use.value) {
          a.value;
        } else {
          b.value;
        }
        runs();
      });
      b.value = 2;
      expect(runs).toHaveBeenCalledTimes(1);
      a.value = 2;
      expect(runs).toHaveBeenCalledTimes(2);
      use.value = false;
      expect(runs).toHaveBeenCalledTimes(3);
      a.value = 3;
      expect(runs).toHaveBeenCalledTimes(3);
      b.value = 3;
      expect(runs).toHaveBeenCalledTimes(4);
      dispose();
    });
  });

  it('nests: an inner effect is disposed when the outer one re-runs', () => {
    const outerSource = signal(0);
    const innerSource = signal(0);
    const innerRuns = vi.fn();
    createRoot((dispose) => {
      effect(() => {
        outerSource.value;
        effect(() => {
          innerSource.value;
          innerRuns();
        });
      });
      expect(innerRuns).toHaveBeenCalledTimes(1);
      innerSource.value = 1;
      expect(innerRuns).toHaveBeenCalledTimes(2);
      outerSource.value = 1; // recreates the inner effect
      expect(innerRuns).toHaveBeenCalledTimes(3);
      innerSource.value = 2; // only the new inner effect reacts
      expect(innerRuns).toHaveBeenCalledTimes(4);
      dispose();
      innerSource.value = 3;
      expect(innerRuns).toHaveBeenCalledTimes(4);
    });
  });

  it('a write from inside an effect is processed in the same flush', () => {
    const source = signal(0);
    const mirror = signal(0);
    const seen: number[] = [];
    createRoot((dispose) => {
      effect(() => {
        mirror.value = source.value * 2;
      });
      effect(() => {
        seen.push(mirror.value);
      });
      source.value = 3;
      expect(seen).toEqual([0, 6]);
      dispose();
    });
  });

  it('keeps a stable handler identity across updates', () => {
    const count = signal(0);
    const handlers: (() => number)[] = [];
    createRoot((dispose) => {
      effect(() => {
        count.value;
      });
      const handler = (): number => count.value;
      handlers.push(handler, handler);
      count.value = 5;
      expect(handlers[0]).toBe(handlers[1]);
      expect(handlers[0]?.()).toBe(5);
      dispose();
    });
  });

  it('reads through a computed chain without extra runs', () => {
    const base = signal(1);
    const runs = vi.fn();
    createRoot((dispose) => {
      const a = computed(() => base.value + 1);
      const b = computed(() => a.value + 1);
      effect(() => {
        b.value;
        runs();
      });
      batch(() => {
        base.value = 2;
        base.value = 3;
      });
      expect(runs).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('warns when created outside any scope, because nothing would dispose it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = effect(() => {});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('outside any scope'));
    stop();
    warn.mockRestore();
  });
});
