/**
 * Order-independence of the pull phase.
 *
 * A write marks subscribers as *maybe* stale and lets each one resolve itself
 * when the queue reaches it. Resolution works by asking "is any dependency of
 * mine still marked stale?", and refreshing a dependency clears that mark — so
 * a subscriber that is checked *after* another one already refreshed a shared
 * dependency has to be told, at refresh time, that the value really did
 * change. These are the shapes where it matters.
 *
 * This was a real defect, found by building the router: a page subscribed to a
 * computed that a sibling had already pulled simply stopped updating. Nothing
 * in the existing suite had two subscribers on one computed where one of them
 * sat behind a second computed, which is exactly the missing case.
 */
import { describe, expect, it, vi } from 'vitest';
import { batch, computed, createRoot, effect, signal } from '../src/index.js';

describe('pull order', () => {
  it('notifies a subscriber checked after a shared computed was refreshed', () => {
    const source = signal(1);
    const shared = computed(() => source.value * 10);
    // Deliberately does not change when `shared` does, so resolving it leaves
    // the first effect clean and the shared computed already refreshed.
    const stable = computed(() => shared.value > 0);
    const seen: number[] = [];

    createRoot((dispose) => {
      effect(() => {
        stable.value;
      });
      effect(() => {
        seen.push(shared.value);
      });

      source.value = 2;

      expect(seen).toEqual([10, 20]);
      dispose();
    });
  });

  it('does not re-run a subscriber when the shared computed did not change', () => {
    const source = signal(1);
    // Changes only when the sign changes.
    const sign = computed(() => source.value > 0);
    const stable = computed(() => (sign.value ? 'plus' : 'minus'));
    const runs = vi.fn();

    createRoot((dispose) => {
      effect(() => {
        stable.value;
      });
      effect(() => {
        sign.value;
        runs();
      });

      source.value = 2;
      expect(runs).toHaveBeenCalledTimes(1);

      source.value = -1;
      expect(runs).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('holds for three subscribers, in either resolution order', () => {
    const source = signal(0);
    const shared = computed(() => source.value + 1);
    const throughComputed = computed(() => shared.value * 2);
    const first: number[] = [];
    const second: number[] = [];
    const third: number[] = [];

    createRoot((dispose) => {
      effect(() => {
        first.push(throughComputed.value);
      });
      effect(() => {
        second.push(shared.value);
      });
      effect(() => {
        third.push(throughComputed.value + shared.value);
      });

      source.value = 1;

      expect(first).toEqual([2, 4]);
      expect(second).toEqual([1, 2]);
      expect(third).toEqual([3, 6]);
      dispose();
    });
  });

  it('holds when the shared computed is read inside a batch', () => {
    const a = signal(1);
    const b = signal(1);
    const shared = computed(() => a.value + b.value);
    const stable = computed(() => shared.value > 0);
    const seen: number[] = [];

    createRoot((dispose) => {
      effect(() => {
        stable.value;
      });
      effect(() => {
        seen.push(shared.value);
      });

      batch(() => {
        a.value = 2;
        b.value = 3;
      });

      expect(seen).toEqual([2, 5]);
      dispose();
    });
  });

  it('holds when the later subscriber is already dirty in its own right', () => {
    const source = signal(1);
    const other = signal('a');
    const shared = computed(() => source.value * 10);
    const stable = computed(() => shared.value > 0);
    const seen: string[] = [];

    createRoot((dispose) => {
      effect(() => {
        stable.value;
      });
      effect(() => {
        seen.push(`${String(shared.value)}${other.value}`);
      });

      batch(() => {
        source.value = 2;
        other.value = 'b';
      });

      expect(seen).toEqual(['10a', '20b']);
      dispose();
    });
  });

  it('propagates through two levels of computed above the shared one', () => {
    const source = signal(1);
    const shared = computed(() => source.value * 10);
    const middle = computed(() => shared.value + 1);
    const top = computed(() => middle.value > 0);
    const seen: number[] = [];

    createRoot((dispose) => {
      effect(() => {
        top.value;
      });
      effect(() => {
        seen.push(middle.value);
      });

      source.value = 2;

      expect(seen).toEqual([11, 21]);
      dispose();
    });
  });
});
