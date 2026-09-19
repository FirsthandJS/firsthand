import { describe, expect, it, vi } from 'vitest';
import {
  catchError,
  computed,
  createRoot,
  effect,
  getOwner,
  onCleanup,
  runWithOwner,
  signal,
} from '../src/index.js';
import { reportUncaught } from '../src/dev.js';

describe('ownership and disposal', () => {
  it('createRoot returns the callback result', () => {
    expect(createRoot(() => 'value')).toBe('value');
  });

  it('disposes everything created inside it', () => {
    const source = signal(0);
    const runs = vi.fn();
    const cleaned = vi.fn();
    const stop = createRoot((dispose) => {
      effect(() => {
        source.value;
        runs();
      });
      onCleanup(cleaned);
      return dispose;
    });
    source.value = 1;
    expect(runs).toHaveBeenCalledTimes(2);
    stop();
    source.value = 2;
    expect(runs).toHaveBeenCalledTimes(2);
    expect(cleaned).toHaveBeenCalledTimes(1);
  });

  it('disposes nested scopes depth first', () => {
    const order: string[] = [];
    const stop = createRoot((dispose) => {
      onCleanup(() => order.push('outer'));
      createRoot(() => {
        onCleanup(() => order.push('inner'));
      });
      return dispose;
    });
    stop();
    expect(order).toEqual(['inner', 'outer']);
  });

  it('detaches a disposed child from the middle of its parent list', () => {
    const order: string[] = [];
    createRoot((disposeOuter) => {
      const first = createRoot((d) => {
        onCleanup(() => order.push('first'));
        return d;
      });
      const second = createRoot((d) => {
        onCleanup(() => order.push('second'));
        return d;
      });
      const third = createRoot((d) => {
        onCleanup(() => order.push('third'));
        return d;
      });
      second(); // middle
      expect(order).toEqual(['second']);
      first(); // head
      third(); // tail
      expect(order).toEqual(['second', 'first', 'third']);
      disposeOuter();
    });
    expect(order).toEqual(['second', 'first', 'third']);
  });

  it('disposing twice is harmless', () => {
    const cleaned = vi.fn();
    const stop = createRoot((dispose) => {
      onCleanup(cleaned);
      return dispose;
    });
    stop();
    stop();
    expect(cleaned).toHaveBeenCalledTimes(1);
  });

  it('getOwner reports the current scope, and null outside one', () => {
    expect(getOwner()).toBeNull();
    createRoot((dispose) => {
      expect(getOwner()).not.toBeNull();
      dispose();
    });
    expect(getOwner()).toBeNull();
  });

  it('runWithOwner re-establishes a scope for asynchronous continuations', async () => {
    const source = signal(0);
    const runs = vi.fn();
    let owner: ReturnType<typeof getOwner> = null;
    const stop = createRoot((dispose) => {
      owner = getOwner();
      return dispose;
    });
    await Promise.resolve();
    expect(getOwner()).toBeNull();
    runWithOwner(owner, () => {
      effect(() => {
        source.value;
        runs();
      });
    });
    source.value = 1;
    expect(runs).toHaveBeenCalledTimes(2);
    stop();
    source.value = 2;
    expect(runs).toHaveBeenCalledTimes(2);
  });

  it('warns when onCleanup is used with no scope to attach to', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onCleanup(() => {});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('outside any scope'));
    warn.mockRestore();
  });

  it('releases sources a disposed scope subscribed to', () => {
    const shared = signal(0);
    const body = vi.fn(() => shared.value);
    const stop = createRoot((dispose) => {
      const derived = computed(body);
      derived.value;
      return dispose;
    });
    stop();
    shared.value = 1;
    expect(body).toHaveBeenCalledTimes(1);
  });
});

describe('error boundaries', () => {
  it('catches errors thrown during setup', () => {
    const handler = vi.fn();
    createRoot((dispose) => {
      const result = catchError(() => {
        throw new Error('setup failed');
      }, handler);
      expect(result).toBeUndefined();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ message: 'setup failed' }));
      dispose();
    });
  });

  it('returns the value when nothing throws', () => {
    createRoot((dispose) => {
      expect(catchError(() => 7, vi.fn())).toBe(7);
      dispose();
    });
  });

  it('catches errors thrown by an effect under it', () => {
    const source = signal(0);
    const handler = vi.fn();
    createRoot((dispose) => {
      catchError(() => {
        effect(() => {
          if (source.value > 0) {
            throw new Error('effect failed');
          }
        });
      }, handler);
      source.value = 1;
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ message: 'effect failed' }));
      dispose();
    });
  });

  it('catches errors thrown by a cleanup', () => {
    const handler = vi.fn();
    createRoot((dispose) => {
      catchError(() => {
        createRoot((inner) => {
          onCleanup(() => {
            throw new Error('cleanup failed');
          });
          inner();
        });
      }, handler);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ message: 'cleanup failed' }));
      dispose();
    });
  });

  it('passes an error thrown by a handler to the boundary above', () => {
    const outer = vi.fn();
    createRoot((dispose) => {
      catchError(() => {
        catchError(
          () => {
            throw new Error('inner');
          },
          () => {
            throw new Error('handler failed');
          },
        );
      }, outer);
      expect(outer).toHaveBeenCalledWith(expect.objectContaining({ message: 'handler failed' }));
      dispose();
    });
  });

  it('reports an unhandled error globally instead of swallowing it', () => {
    const scheduled: (() => void)[] = [];
    const spy = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((cb: () => void) => void scheduled.push(cb));
    const error = new Error('nobody catches me');
    reportUncaught(error);
    expect(scheduled).toHaveLength(1);
    expect(() => scheduled[0]?.()).toThrow(error);
    spy.mockRestore();
  });

  it('sends an error with no boundary above it to the global reporter', () => {
    const scheduled: (() => void)[] = [];
    const spy = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((cb: () => void) => void scheduled.push(cb));
    const source = signal(0);
    createRoot((dispose) => {
      effect(() => {
        if (source.value > 0) {
          throw new Error('unhandled');
        }
      });
      source.value = 1;
      dispose();
    });
    expect(scheduled).toHaveLength(1);
    expect(() => scheduled[0]?.()).toThrow('unhandled');
    spy.mockRestore();
  });
});
