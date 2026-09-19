/**
 * Structural tests for the dependency graph itself: link reuse, duplicate
 * reads, reordering, unlinking from every position, and the invariant that a
 * disposed scope leaves no edges behind.
 */
import { describe, expect, it, vi } from 'vitest';
import { batch, computed, createRoot, effect, signal } from '../src/index.js';
import { Cell } from '../src/core.js';

/** Counts the subscribers a source currently has, by walking its list. */
function subscriberCount(source: unknown): number {
  let link = (source as Cell).subs;
  let n = 0;
  while (link !== undefined) {
    n++;
    link = link.nextSub;
  }
  return n;
}

/** Counts the dependencies a node currently has. */
function dependencyCount(node: unknown): number {
  let link = (node as Cell).deps;
  let n = 0;
  while (link !== undefined) {
    n++;
    link = link.nextDep;
  }
  return n;
}

describe('dependency edges', () => {
  it('reuses links when the dependency order is unchanged', () => {
    const a = signal(1);
    const b = signal(2);
    createRoot((dispose) => {
      const sum = computed(() => a.value + b.value);
      expect(sum.value).toBe(3);
      const firstLink = (sum as unknown as Cell).deps;
      a.value = 2;
      expect(sum.value).toBe(4);
      expect((sum as unknown as Cell).deps).toBe(firstLink);
      expect(dependencyCount(sum)).toBe(2);
      dispose();
    });
  });

  it('deduplicates a source read twice in a row', () => {
    const a = signal(1);
    createRoot((dispose) => {
      const doubled = computed(() => a.value + a.value);
      expect(doubled.value).toBe(2);
      expect(dependencyCount(doubled)).toBe(1);
      expect(subscriberCount(a)).toBe(1);
      dispose();
    });
  });

  it('deduplicates a source read twice out of order', () => {
    const a = signal(1);
    const b = signal(10);
    createRoot((dispose) => {
      const total = computed(() => a.value + b.value + a.value);
      expect(total.value).toBe(12);
      expect(dependencyCount(total)).toBe(2);
      expect(subscriberCount(a)).toBe(1);
      a.value = 2;
      expect(total.value).toBe(14);
      expect(dependencyCount(total)).toBe(2);
      dispose();
    });
  });

  it('handles a dependency order that changes between runs', () => {
    const flip = signal(false);
    const a = signal('a');
    const b = signal('b');
    createRoot((dispose) => {
      const joined = computed(() => (flip.value ? b.value + a.value : a.value + b.value));
      expect(joined.value).toBe('ab');
      expect(dependencyCount(joined)).toBe(3);
      flip.value = true;
      expect(joined.value).toBe('ba');
      expect(dependencyCount(joined)).toBe(3);
      expect(subscriberCount(a)).toBe(1);
      expect(subscriberCount(b)).toBe(1);
      dispose();
    });
  });

  it('shrinks the dependency list when fewer sources are read', () => {
    const many = signal(true);
    const a = signal(1);
    const b = signal(2);
    const c = signal(3);
    createRoot((dispose) => {
      const total = computed(() => (many.value ? a.value + b.value + c.value : a.value));
      expect(total.value).toBe(6);
      expect(dependencyCount(total)).toBe(4);
      many.value = false;
      expect(total.value).toBe(1);
      expect(dependencyCount(total)).toBe(2);
      expect(subscriberCount(b)).toBe(0);
      expect(subscriberCount(c)).toBe(0);
      dispose();
    });
  });

  it('unlinks subscribers from the head, middle and tail of a source', () => {
    const source = signal(0);
    createRoot((outer) => {
      const first = createRoot(
        (d) => (
          effect(() => {
            source.value;
          }),
          d
        ),
      );
      const second = createRoot(
        (d) => (
          effect(() => {
            source.value;
          }),
          d
        ),
      );
      const third = createRoot(
        (d) => (
          effect(() => {
            source.value;
          }),
          d
        ),
      );
      expect(subscriberCount(source)).toBe(3);
      second();
      expect(subscriberCount(source)).toBe(2);
      first();
      expect(subscriberCount(source)).toBe(1);
      third();
      expect(subscriberCount(source)).toBe(0);
      outer();
    });
  });

  it('leaves no edges behind after a scope is disposed', () => {
    const source = signal(0);
    const stop = createRoot((dispose) => {
      const derived = computed(() => source.value * 2);
      effect(() => {
        derived.value;
      });
      return dispose;
    });
    expect(subscriberCount(source)).toBe(1);
    stop();
    expect(subscriberCount(source)).toBe(0);
  });

  it('keeps a shared source alive for the scopes that still use it', () => {
    const source = signal(0);
    const runs = vi.fn();
    const keep = createRoot((dispose) => {
      effect(() => {
        source.value;
        runs();
      });
      return dispose;
    });
    const drop = createRoot((dispose) => {
      effect(() => {
        source.value;
      });
      return dispose;
    });
    drop();
    source.value = 1;
    expect(runs).toHaveBeenCalledTimes(2);
    expect(subscriberCount(source)).toBe(1);
    keep();
    expect(subscriberCount(source)).toBe(0);
  });

  it('does not walk past a computed whose value did not change', () => {
    const source = signal(3);
    const downstream = vi.fn();
    createRoot((dispose) => {
      const clamped = computed(() => Math.min(source.value, 2));
      effect(() => {
        clamped.value;
        downstream();
      });
      batch(() => {
        source.value = 4;
        source.value = 5;
      });
      // The source changed twice, but the clamped value stayed at 2.
      expect(downstream).toHaveBeenCalledTimes(1);
      source.value = 1;
      expect(downstream).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('propagates through a chain of computeds', () => {
    const source = signal(0);
    const seen: number[] = [];
    createRoot((dispose) => {
      const a = computed(() => source.value + 1);
      const b = computed(() => a.value + 1);
      const c = computed(() => b.value + 1);
      effect(() => {
        seen.push(c.value);
      });
      source.value = 1;
      expect(seen).toEqual([3, 4]);
      dispose();
    });
  });

  it('handles a source gaining subscribers after it already had one', () => {
    const source = signal(0);
    createRoot((dispose) => {
      effect(() => {
        source.value;
      });
      expect(subscriberCount(source)).toBe(1);
      effect(() => {
        source.value;
      });
      expect(subscriberCount(source)).toBe(2);
      dispose();
      expect(subscriberCount(source)).toBe(0);
    });
  });

  it('unlinks a disposed computed from the subscribers that still hold it', () => {
    const source = signal(1);
    const runs = vi.fn();
    let dropInner!: () => void;
    const stopOuter = createRoot((outer) => {
      let derived!: { value: number };
      createRoot((inner) => {
        dropInner = inner;
        derived = computed(() => source.value * 2);
      });
      effect(() => {
        derived.value;
        runs();
      });
      return outer;
    });
    expect(runs).toHaveBeenCalledTimes(1);
    dropInner();
    // The outer effect was subscribed to the computed; disposal must remove
    // that edge from both ends, not just from the computed's side.
    expect(subscriberCount(source)).toBe(0);
    source.value = 2;
    expect(runs).toHaveBeenCalledTimes(1);
    stopOuter();
  });

  it('an effect that reads nothing is never re-run', () => {
    const runs = vi.fn();
    const unrelated = signal(0);
    createRoot((dispose) => {
      effect(() => {
        runs();
      });
      unrelated.value = 1;
      expect(runs).toHaveBeenCalledTimes(1);
      dispose();
    });
  });
});
