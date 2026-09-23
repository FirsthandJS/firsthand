/**
 * Tasks: async work that cannot outlive the scope it was started from.
 *
 * The bug this exists to remove is the one nothing reports — an `await`
 * resumes with no owner, so a continuation from a component that has gone
 * away still writes to a signal, and the write lands silently on nobody.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  catchError,
  createRoot,
  effect,
  getOwner,
  onCleanup,
  signal,
  task,
  useContext,
  createContext,
  provide,
} from '@firsthandjs/core';

const tick = (ms = 0): Promise<void> => new Promise((wake) => setTimeout(wake, ms));

describe('a task', () => {
  it('hands back what its body produced', async () => {
    let handle!: ReturnType<typeof task<string>>;
    const stop = createRoot((dispose) => {
      handle = task(async ({ resume }) => await resume('done'));
      return dispose;
    });

    await expect(handle.promise).resolves.toBe('done');
    stop();
  });

  it('stops at the next resume once its scope is disposed', async () => {
    const wrote = vi.fn();
    let handle!: ReturnType<typeof task<void>>;
    const stop = createRoot((dispose) => {
      handle = task(async ({ resume }) => {
        await resume(tick(20));
        wrote();
      });
      return dispose;
    });

    stop();
    await handle.promise;

    // The continuation was already queued when the scope went away. This is
    // exactly the write that used to land on a disposed component.
    expect(wrote).not.toHaveBeenCalled();
  });

  it('aborts its signal when the scope goes away, so the request ends too', () => {
    let seen!: AbortSignal;
    const stop = createRoot((dispose) => {
      task(async ({ signal: abort, resume }) => {
        seen = abort;
        await resume(tick(20));
      });
      return dispose;
    });

    expect(seen.aborted).toBe(false);
    stop();
    expect(seen.aborted).toBe(true);
  });

  it('resolves to undefined when it was superseded', async () => {
    let handle!: ReturnType<typeof task<string>>;
    const stop = createRoot((dispose) => {
      handle = task(async ({ resume }) => {
        await resume(tick(20));
        return 'late';
      });
      return dispose;
    });

    stop();
    await expect(handle.promise).resolves.toBeUndefined();
  });
});

describe('a task under an effect', () => {
  it('is superseded by the next run, so only the newest answer commits', async () => {
    const id = signal(1);
    const committed: number[] = [];
    const delays: Record<number, number> = { 1: 40, 2: 5 };

    const stop = createRoot((dispose) => {
      effect(() => {
        const current = id.value;
        task(async ({ resume }) => {
          await resume(tick(delays[current]));
          committed.push(current);
        });
      });
      return dispose;
    });

    // The slow first run is still out when the second starts. Without
    // supersession it would answer last and overwrite the newer value — the
    // classic out-of-order write.
    id.value = 2;
    await tick(80);

    expect(committed).toEqual([2]);
    stop();
  });

  it('needs no bookkeeping of its own, because clearScope already does it', async () => {
    const aborts: boolean[] = [];
    const run = signal(0);

    const stop = createRoot((dispose) => {
      effect(() => {
        run.value;
        task(async ({ signal: abort, resume }) => {
          onCleanup(() => aborts.push(abort.aborted));
          await resume(tick(20));
        });
      });
      return dispose;
    });

    run.value = 1;
    await tick(5);

    // The first task's cleanup ran when the effect re-ran, and it ran with the
    // task already aborted.
    expect(aborts).toEqual([true]);
    stop();
  });
});

describe('the scope a task carries', () => {
  it('is established for the body before its first await', () => {
    let inside: unknown;
    const stop = createRoot((dispose) => {
      task(() => {
        inside = getOwner();
        return Promise.resolve();
      });
      return dispose;
    });

    expect(inside).not.toBeNull();
    stop();
  });

  it('is reachable after an await through run(), which is where context lives', async () => {
    const Theme = createContext<string>();
    let seen: string | undefined;

    const stop = createRoot((dispose) => {
      provide(Theme, 'dark');
      task(async ({ resume, run }) => {
        await resume(tick(5));
        // Without this the read would happen with no owner at all.
        run(() => {
          seen = useContext(Theme).value;
        });
      });
      return dispose;
    });

    await tick(20);
    expect(seen).toBe('dark');
    stop();
  });

  it('ends when the work ends, so a per-click task does not pile up', async () => {
    const cleaned = vi.fn();
    let handle!: ReturnType<typeof task<void>>;
    const stop = createRoot((dispose) => {
      handle = task(async ({ resume, run }) => {
        run(() => {
          onCleanup(cleaned);
        });
        await resume(tick(5));
      });
      return dispose;
    });

    await handle.promise;
    expect(cleaned).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('an error inside a task', () => {
  it('reaches the boundary above it, where an effect error would have gone', async () => {
    const caught: unknown[] = [];
    let handle!: ReturnType<typeof task<void>>;

    const stop = createRoot((dispose) => {
      catchError(
        () => {
          handle = task(async ({ resume }) => {
            await resume(tick(5));
            throw new Error('broken');
          });
        },
        (error) => caught.push(error),
      );
      return dispose;
    });

    await handle.promise;
    expect(caught).toHaveLength(1);
    expect((caught[0] as Error).message).toBe('broken');
    stop();
  });

  it('never rejects, so a caller that ignores the promise is safe', async () => {
    let handle!: ReturnType<typeof task<void>>;
    const stop = createRoot((dispose) => {
      catchError(
        () => {
          handle = task(() => Promise.reject(new Error('nope')));
        },
        () => {},
      );
      return dispose;
    });

    await expect(handle.promise).resolves.toBeUndefined();
    stop();
  });

  it('is not reported when the task was merely superseded', async () => {
    const caught: unknown[] = [];
    let handle!: ReturnType<typeof task<void>>;

    const stop = createRoot((dispose) => {
      catchError(
        () => {
          handle = task(async ({ resume }) => {
            await resume(tick(20));
          });
        },
        (error) => caught.push(error),
      );
      return dispose;
    });

    stop();
    await handle.promise;

    // Supersession is the system working; it is not an error anyone has to
    // handle.
    expect(caught).toEqual([]);
  });
});

describe('a task with nowhere to belong', () => {
  it('says so, because nothing will ever abort it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handle = task(async ({ resume }) => await resume('orphan'));

    await expect(handle.promise).resolves.toBe('orphan');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('outside any scope'));
    warn.mockRestore();
  });
});

describe('aborting a task by hand', () => {
  it('stops it at the next resume, as a disposed scope would', async () => {
    const wrote = vi.fn();
    let handle!: ReturnType<typeof task<void>>;
    const stop = createRoot((dispose) => {
      handle = task(async ({ resume }) => {
        await resume(tick(20));
        wrote();
      });
      return dispose;
    });

    handle.abort();
    await handle.promise;

    expect(wrote).not.toHaveBeenCalled();
    stop();
  });
});

describe('a body that throws before it suspends', () => {
  it('reaches the boundary, and still hands back a promise', async () => {
    const caught: unknown[] = [];
    let handle!: ReturnType<typeof task<void>>;

    const stop = createRoot((dispose) => {
      catchError(
        () => {
          handle = task(() => {
            throw new Error('at once');
          });
        },
        (error) => caught.push(error),
      );
      return dispose;
    });

    // It threw before returning a promise at all, so there is no rejection to
    // attach to — the task still has to answer.
    await expect(handle.promise).resolves.toBeUndefined();
    expect((caught[0] as Error).message).toBe('at once');
    stop();
  });
});
