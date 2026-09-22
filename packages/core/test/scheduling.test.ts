import { describe, expect, it, vi } from 'vitest';
import { batch, catchError, createRoot, effect, signal } from '@/index.js';
import { FirsthandCycleError } from '@/errors.js';

describe('scheduling (ADR-0006)', () => {
  it('updates synchronously: no await is needed after a write', () => {
    const count = signal(0);
    let observed = -1;
    createRoot((dispose) => {
      effect(() => {
        observed = count.value;
      });
      count.value = 1;
      expect(observed).toBe(1);
      dispose();
    });
  });

  it('batch() collapses several writes into one run', () => {
    const a = signal(0);
    const b = signal(0);
    const runs = vi.fn();
    createRoot((dispose) => {
      effect(() => {
        a.value;
        b.value;
        runs();
      });
      batch(() => {
        a.value = 1;
        b.value = 1;
        expect(runs).toHaveBeenCalledTimes(1); // not yet flushed
      });
      expect(runs).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('nested batches flush once, at the outermost exit', () => {
    const count = signal(0);
    const runs = vi.fn();
    createRoot((dispose) => {
      effect(() => {
        count.value;
        runs();
      });
      batch(() => {
        count.value = 1;
        batch(() => {
          count.value = 2;
        });
        expect(runs).toHaveBeenCalledTimes(1);
      });
      expect(runs).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('batch() returns the callback result and flushes even when it throws', () => {
    const count = signal(0);
    const runs = vi.fn();
    createRoot((dispose) => {
      effect(() => {
        count.value;
        runs();
      });
      expect(batch(() => 42)).toBe(42);
      expect(() =>
        batch(() => {
          count.value = 1;
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(runs).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('queues each effect at most once per flush', () => {
    const a = signal(0);
    const runs = vi.fn();
    createRoot((dispose) => {
      effect(() => {
        a.value;
        a.value;
        runs();
      });
      a.value = 1;
      expect(runs).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('skips effects disposed during the flush that produced them', () => {
    const source = signal(0);
    const late = vi.fn();
    createRoot((dispose) => {
      const stops: (() => void)[] = [];
      effect(() => {
        source.value;
        stops.forEach((stop) => {
          stop();
        });
      });
      stops.push(
        effect(() => {
          source.value;
          late();
        }),
      );
      expect(late).toHaveBeenCalledTimes(1);
      source.value = 1;
      expect(late).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it('throws FirsthandCycleError instead of hanging on a self-invalidating effect', () => {
    const count = signal(0);
    expect(() =>
      createRoot((dispose) => {
        effect(() => {
          count.value = count.value + 1;
        });
        dispose();
      }),
    ).toThrow(FirsthandCycleError);
  }, 60_000);

  it('does not let an error boundary swallow a cycle', () => {
    const count = signal(0);
    const handler = vi.fn();
    expect(() =>
      createRoot((dispose) => {
        catchError(() => {
          effect(() => {
            count.value = count.value + 1;
          });
        }, handler);
        dispose();
      }),
    ).toThrow(FirsthandCycleError);
    expect(handler).not.toHaveBeenCalled();
  }, 60_000);
});
