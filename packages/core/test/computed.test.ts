import { describe, expect, it, vi } from 'vitest';
import { computed, createRoot, effect, signal } from '@/index.js';

describe('computed', () => {
  it('is lazy: it does not run until it is read', () => {
    const body = vi.fn(() => 1);
    createRoot((dispose) => {
      const value = computed(body);
      expect(body).not.toHaveBeenCalled();
      expect(value.value).toBe(1);
      expect(body).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it('memoises until a dependency changes', () => {
    const count = signal(2);
    const body = vi.fn(() => count.value * 2);
    createRoot((dispose) => {
      const doubled = computed(body);
      expect(doubled.value).toBe(4);
      expect(doubled.value).toBe(4);
      expect(body).toHaveBeenCalledTimes(1);
      count.value = 3;
      expect(doubled.value).toBe(6);
      expect(body).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('does not notify downstream when the recomputed value is unchanged', () => {
    const count = signal(1);
    const parity = computed(() => count.value % 2);
    const runs = vi.fn();
    createRoot((dispose) => {
      effect(() => {
        parity.value;
        runs();
      });
      expect(runs).toHaveBeenCalledTimes(1);
      count.value = 3; // still odd
      expect(runs).toHaveBeenCalledTimes(1);
      count.value = 2; // now even
      expect(runs).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('nests, and evaluates each level once per change', () => {
    const base = signal(1);
    const innerBody = vi.fn(() => base.value + 1);
    createRoot((dispose) => {
      const inner = computed(innerBody);
      const outerBody = vi.fn(() => inner.value * 10);
      const outer = computed(outerBody);
      expect(outer.value).toBe(20);
      base.value = 2;
      expect(outer.value).toBe(30);
      expect(innerBody).toHaveBeenCalledTimes(2);
      expect(outerBody).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('is glitch-free across a diamond', () => {
    const base = signal(1);
    const runs: number[] = [];
    createRoot((dispose) => {
      const left = computed(() => base.value + 1);
      const right = computed(() => base.value * 2);
      effect(() => {
        runs.push(left.value + right.value);
      });
      expect(runs).toEqual([4]);
      base.value = 2;
      // One run, with both branches consistent: (2+1) + (2*2) === 7
      expect(runs).toEqual([4, 7]);
      dispose();
    });
  });

  it('drops dependencies it no longer reads', () => {
    const use = signal(true);
    const a = signal('a');
    const b = signal('b');
    const body = vi.fn(() => (use.value ? a.value : b.value));
    createRoot((dispose) => {
      const picked = computed(body);
      expect(picked.value).toBe('a');
      b.value = 'B';
      expect(body).toHaveBeenCalledTimes(1);
      use.value = false;
      expect(picked.value).toBe('B');
      a.value = 'A';
      expect(picked.value).toBe('B');
      expect(body).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('peek() on a stale computed still returns a correct value', () => {
    const count = signal(1);
    createRoot((dispose) => {
      const doubled = computed(() => count.value * 2);
      expect(doubled.peek()).toBe(2);
      count.value = 5;
      expect(doubled.peek()).toBe(10);
      dispose();
    });
  });

  it('supports a custom equality', () => {
    const source = signal(1);
    const runs = vi.fn();
    createRoot((dispose) => {
      const rounded = computed(() => ({ v: source.value }), { equals: (a, b) => a.v === b.v });
      effect(() => {
        rounded.value;
        runs();
      });
      source.value = 1;
      expect(runs).toHaveBeenCalledTimes(1);
      source.value = 2;
      expect(runs).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('re-evaluating with an unchanged value keeps subscribers settled', () => {
    const source = signal(2);
    const derived = computed(() => source.value > 1);
    const runs = vi.fn();
    createRoot((dispose) => {
      effect(() => {
        derived.value;
        runs();
      });
      source.value = 3;
      expect(runs).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it('a pending computed whose inputs settle is not recomputed', () => {
    const source = signal(1);
    const parity = computed(() => source.value % 2);
    const inner = vi.fn(() => parity.value * 100);
    createRoot((dispose) => {
      const scaled = computed(inner);
      expect(scaled.value).toBe(100);
      source.value = 3; // parity unchanged -> scaled must stay memoised
      expect(scaled.value).toBe(100);
      expect(inner).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it('unsubscribes from sources that outlive its scope', () => {
    const global = signal(1);
    let derived!: { value: number };
    const body = vi.fn(() => global.value * 2);
    const stop = createRoot((dispose) => {
      derived = computed(body);
      derived.value;
      return dispose;
    });
    stop();
    global.value = 2;
    expect(body).toHaveBeenCalledTimes(1);
  });
});
