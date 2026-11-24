/**
 * Three defects reported against 0.12.2 from an editor built on Firsthand: a
 * parts list, a selected part, and an inspector for it inside a conditional.
 *
 * 1. A computed answered with its cached value after a computed it reads had
 *    been refreshed by a reader that was not subscribed to it yet.
 * 2. An effect owned by another one could run before its owner, which was
 *    about to dispose it — so it ran against data that no longer existed.
 * 3. A computed that threw while an effect was being checked escaped the
 *    flush: past `catchError`, out of the signal write, and with every effect
 *    still in the queue left stale and therefore never scheduled again.
 *
 * Each `describe` below is one of them, with the shapes from the report.
 */
import { describe, expect, it } from 'vitest';
import {
  adoptEffect,
  batch,
  createOwner,
  catchError,
  computed,
  createRoot,
  effect,
  FirsthandCycleError,
  signal,
} from '@/index.js';

type Part = { id: string; name: string };

describe('a refresh by a reader that is not subscribed yet', () => {
  it('tells the one existing subscriber after a plain read', () => {
    const s = signal(1);
    const a = computed(() => s.value);
    const b = computed(() => a.value * 10);

    expect(b.value).toBe(10);
    s.value = 2;
    expect(a.value).toBe(2);
    expect(b.value).toBe(20);
  });

  it('tells the one existing subscriber after a peek', () => {
    const s = signal(1);
    const a = computed(() => s.value);
    const b = computed(() => a.value * 10);

    expect(b.value).toBe(10);
    s.value = 2;
    expect(a.peek()).toBe(2);
    expect(b.value).toBe(20);
  });

  it('re-runs an effect behind it when the peek happens inside a batch', () => {
    const s = signal(1);
    const a = computed(() => s.value);
    const b = computed(() => a.value * 10);
    const seen: number[] = [];

    createRoot((dispose) => {
      effect(() => void seen.push(b.value));
      batch(() => {
        s.value = 2;
        a.peek();
      });
      expect(seen).toEqual([10, 20]);
      dispose();
    });
  });

  it('shows the new selection after a condition switched off and on again', () => {
    const parts = signal<Part[]>([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    const id = signal<string | null>('a');
    const selected = computed(() => parts.value.find((p) => p.id === id.value));
    const name = computed(() => selected.value?.name ?? '-');
    const has = computed(() => id.value !== null && selected.value !== undefined);
    const shown: string[] = [];

    createRoot((dispose) => {
      effect(() => {
        if (has.value) {
          effect(() => void shown.push(name.value));
        }
      });
      id.value = null;
      id.value = 'b';
      expect(shown).toEqual(['A', 'B']);
      dispose();
    });
  });
});

/** The editor's shape: a conditional part, and an unrelated one beside it. */
function editor(): {
  parts: ReturnType<typeof signal<Part[]>>;
  id: ReturnType<typeof signal<string | null>>;
  log: string[];
  errors: unknown[];
  dispose: () => void;
} {
  const parts = signal<Part[]>([{ id: 'a', name: 'A' }]);
  const id = signal<string | null>('a');
  const selected = computed(() => parts.value.find((p) => p.id === id.value));
  // Only valid while something is selected, which is what the condition says.
  const name = computed(() => (selected.value as Part).name);
  const has = computed(() => id.value !== null && selected.value !== undefined);
  const log: string[] = [];
  const errors: unknown[] = [];
  const dispose = createRoot((dispose) => {
    catchError(
      () => {
        effect(() => {
          log.push(`parent:${has.value}`);
          if (has.value) {
            effect(() => void log.push(`child:${name.value}`));
          }
        });
        effect(() => void log.push(`count:${parts.value.length}`));
      },
      (error) => errors.push(error),
    );
    return dispose;
  });
  return { parts, id, log, errors, dispose };
}

describe('an owner runs before the effects it owns', () => {
  it('disposes the child before it can run, when the edges are in creation order', () => {
    const { parts, log, errors, dispose } = editor();
    log.length = 0;
    parts.value = [];
    expect(log).toEqual(['parent:false', 'count:0']);
    expect(errors).toEqual([]);
    dispose();
  });

  it('disposes the child before it can run, after the condition was re-acquired', () => {
    const { parts, id, log, errors, dispose } = editor();
    id.value = null;
    id.value = 'a';
    log.length = 0;
    parts.value = [];
    expect(log).toEqual(['parent:false', 'count:0']);
    expect(errors).toEqual([]);
    dispose();
  });

  it('settles an owner two levels up before the grandchild', () => {
    const source = signal(1);
    const late = computed(() => source.value);
    // Stays linked to `late` while nothing reads it, which is what lets its
    // edge outlive the grandparent's.
    const inner = computed(() => late.value);
    const gate = signal(true);
    const log: string[] = [];

    createRoot((dispose) => {
      effect(() => {
        if (gate.value && late.value < 2) {
          effect(() => {
            effect(() => void log.push(`grandchild:${inner.value}`));
          });
        }
      });
      // Off and on again: the grandparent's edge to `late` is now the newest,
      // so the grandchild is notified first.
      gate.value = false;
      gate.value = true;
      log.length = 0;
      source.value = 2;
      expect(log).toEqual([]);
      dispose();
    });
  });
});

describe('an error while an effect is checked', () => {
  it('reaches the boundary instead of the write', () => {
    const source = signal(1);
    const broken = computed(() => {
      if (source.value === 2) {
        throw new Error('broken');
      }
      return source.value;
    });
    const doubled = computed(() => broken.value * 2);
    const errors: unknown[] = [];
    const seen: number[] = [];

    createRoot((dispose) => {
      catchError(
        () => {
          effect(() => void seen.push(doubled.value));
        },
        (error) => errors.push(error),
      );
      expect(() => {
        source.value = 2;
      }).not.toThrow();
      expect(errors).toHaveLength(1);
      // The effect still depends on what threw, so it recovers with it.
      source.value = 3;
      expect(seen).toEqual([2, 6]);
      dispose();
    });
  });

  it('leaves the other effects of that flush running, then and later', () => {
    const source = signal(1);
    const broken = computed(() => {
      if (source.value === 2) {
        throw new Error('broken');
      }
      return source.value;
    });
    const behind = computed(() => broken.value);
    const errors: unknown[] = [];
    const log: string[] = [];

    createRoot((dispose) => {
      catchError(
        () => {
          effect(() => void log.push(`broken:${behind.value}`));
          effect(() => void log.push(`fine:${source.value}`));
        },
        (error) => errors.push(error),
      );
      log.length = 0;
      source.value = 2;
      expect(log).toEqual(['fine:2']);
      source.value = 3;
      expect(log).toEqual(['fine:2', 'broken:3', 'fine:3']);
      expect(errors).toHaveLength(1);
      dispose();
    });
  });

  it('rethrows the same error on every read until a source changes', () => {
    const source = signal(1);
    let runs = 0;
    const broken = computed(() => {
      runs++;
      if (source.value === 2) {
        throw new Error('broken');
      }
      return source.value;
    });
    expect(broken.value).toBe(1);
    source.value = 2;
    expect(() => broken.value).toThrow('broken');
    expect(() => broken.peek()).toThrow('broken');
    expect(runs).toBe(2);
    source.value = 4;
    expect(broken.value).toBe(4);
    expect(runs).toBe(3);
  });

  it('keeps an error but not a cycle, which belongs to the write', () => {
    const trigger = signal(0);
    const count = signal(0);

    createRoot((dispose) => {
      // Invalidates itself on every run once triggered: a genuine cycle.
      effect(() => {
        if (trigger.value > 0) {
          count.value = count.value + 1;
        }
      });
      const writes = computed(() => {
        trigger.value = 1;
        return true;
      });
      expect(() => writes.value).toThrow(FirsthandCycleError);
      dispose();
    });
  });

  it('runs neither a zombie child nor freezes the editor', () => {
    const { parts, id, log, errors, dispose } = editor();
    id.value = null;
    id.value = 'a';
    log.length = 0;
    expect(() => {
      parts.value = [];
    }).not.toThrow();
    parts.value = [{ id: 'b', name: 'B' }];
    id.value = 'b';
    expect(log).toEqual(['parent:false', 'count:0', 'count:1', 'parent:true', 'child:B']);
    expect(errors).toEqual([]);
    dispose();
  });
});

describe('adopting the running effect', () => {
  it('adopts an effect, and neither a computed nor nothing', () => {
    const outside = createOwner(null);
    adoptEffect(outside);
    expect(outside.effect).toBeNull();

    const underComputed = createOwner(null);
    computed(() => {
      adoptEffect(underComputed);
      return 0;
    }).value;
    expect(underComputed.effect).toBeNull();

    const underEffect = createOwner(null);
    createRoot((dispose) => {
      effect(() => {
        adoptEffect(underEffect);
      });
      dispose();
    });
    expect(underEffect.effect).not.toBeNull();
  });
});
