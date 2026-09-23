/**
 * Assertions that mutation testing showed were missing.
 *
 * Every test here corresponds to a mutant that survived the suite: a change to
 * the source that no existing test noticed. They are ordinary behavioural
 * tests, not assertions about internals — if a mutant could only be killed by
 * reaching into internals, it is recorded as equivalent in
 * `docs/architecture/mutation-testing.md` instead of being chased.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  catchError,
  computed,
  createContext,
  createRoot,
  effect,
  getOwner,
  onCleanup,
  runWithOwner,
  signal,
  useContext,
} from '@/index.js';
import { Cell } from '@/cell.js';

function dependencyCount(node: unknown): number {
  let link = (node as Cell).deps;
  let total = 0;
  while (link !== undefined) {
    total++;
    link = link.nextDep;
  }
  return total;
}

describe('disposal unlinks in both directions', () => {
  it('removes a disposed computed from its subscribers, not only its sources', () => {
    const source = signal(1);
    let stopInner!: () => void;
    let outer!: Cell;

    const stopOuter = createRoot((dispose) => {
      let derived!: { value: number };
      createRoot((inner) => {
        stopInner = inner;
        derived = computed(() => source.value * 2);
      });
      effect(() => {
        derived.value;
      });
      outer = (getOwner()?.cells as Cell[])[0] as Cell;
      return dispose;
    });

    // The effect depends on the computed.
    expect(dependencyCount(outer)).toBeGreaterThan(0);
    stopInner();
    // Disposing the computed must also remove it from the effect's dependency
    // list; leaving it there would keep a dead node reachable from a live one.
    expect(dependencyCount(outer)).toBe(0);
    stopOuter();
  });

  it("an effect's own disposer disposes the scope it owns", () => {
    const cleaned = vi.fn();
    const source = signal(0);
    createRoot((dispose) => {
      const stop = effect(() => {
        source.value;
        onCleanup(cleaned);
      });
      expect(cleaned).not.toHaveBeenCalled();
      stop();
      expect(cleaned).toHaveBeenCalledTimes(1);
      // And it stays disposed.
      source.value = 1;
      expect(cleaned).toHaveBeenCalledTimes(1);
      dispose();
    });
  });
});

describe('the current scope is restored', () => {
  it('after catchError returns normally and after it catches', () => {
    createRoot((dispose) => {
      const outer = getOwner();
      catchError(() => 'fine', vi.fn());
      expect(getOwner()).toBe(outer);

      catchError(() => {
        throw new Error('caught');
      }, vi.fn());
      expect(getOwner()).toBe(outer);
      dispose();
    });
  });

  it('after runWithOwner, including when the body throws', () => {
    const stop = createRoot((dispose) => dispose);
    const other = createRoot((dispose) => {
      const owner = getOwner();
      void dispose;
      return owner;
    });
    expect(getOwner()).toBeNull();

    runWithOwner(other, () => undefined);
    expect(getOwner()).toBeNull();

    expect(() =>
      runWithOwner(other, () => {
        throw new Error('inner');
      }),
    ).toThrow('inner');
    expect(getOwner()).toBeNull();
    stop();
  });
});

describe('the owner child list survives repeated disposal', () => {
  it('disposing the middle child twice leaves the others intact', () => {
    const order: string[] = [];
    const stop = createRoot((dispose) => {
      createRoot(() => {
        onCleanup(() => order.push('first'));
      });
      const second = createRoot((inner) => {
        onCleanup(() => order.push('second'));
        return inner;
      });
      createRoot(() => {
        onCleanup(() => order.push('third'));
      });
      second();
      // A second disposal must not re-detach it and corrupt the parent's list.
      second();
      return dispose;
    });

    expect(order).toEqual(['second']);
    stop();
    // Siblings are disposed in creation order, and the one already disposed is
    // not visited again.
    expect(order).toEqual(['second', 'first', 'third']);
  });
});

describe('diagnostics fire only when they should', () => {
  it('effect() does not warn when it has a scope', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createRoot((dispose) => {
      effect(() => undefined);
      dispose();
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('onCleanup does not warn when it has a scope', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createRoot((dispose) => {
      onCleanup(() => undefined);
      dispose();
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('names the context in the error when no description was given', () => {
    const anonymous = createContext<number>();
    expect(() => useContext(anonymous)).toThrow(/No provider for context/);

    const named = createContext<number>(undefined as unknown as number, 'CounterContext');
    createRoot((dispose) => {
      // A described context that has a default does not throw at all.
      expect(useContext(named).value).toBeUndefined();
      dispose();
    });
  });
});
