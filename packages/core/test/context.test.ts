import { describe, expect, it, vi } from 'vitest';
import {
  createContext,
  createRoot,
  effect,
  provide,
  signal,
  useContext,
  type Signal,
} from '../src/index.js';
import { FirsthandContextError } from '../src/errors.js';

type Theme = { mode: 'light' | 'dark' };

describe('context', () => {
  it('resolves a provided value from a nested scope', () => {
    const ThemeContext = createContext<Theme>();
    createRoot((dispose) => {
      provide(ThemeContext, { mode: 'dark' });
      createRoot(() => {
        createRoot(() => {
          expect(useContext(ThemeContext).value.mode).toBe('dark');
        });
      });
      dispose();
    });
  });

  it('is reactive when a cell is provided', () => {
    const ThemeContext = createContext<Theme>();
    const theme: Signal<Theme> = signal<Theme>({ mode: 'light' });
    const seen: string[] = [];
    createRoot((dispose) => {
      provide(ThemeContext, theme);
      createRoot(() => {
        const current = useContext(ThemeContext);
        effect(() => {
          seen.push(current.value.mode);
        });
      });
      theme.value = { mode: 'dark' };
      expect(seen).toEqual(['light', 'dark']);
      dispose();
    });
  });

  it('updates every consumer from one provider change', () => {
    const CountContext = createContext<number>();
    const count = signal(0);
    const runs = vi.fn();
    createRoot((dispose) => {
      provide(CountContext, count);
      for (let i = 0; i < 100; i++) {
        createRoot(() => {
          const value = useContext(CountContext);
          effect(() => {
            value.value;
            runs();
          });
        });
      }
      expect(runs).toHaveBeenCalledTimes(100);
      count.value = 1;
      expect(runs).toHaveBeenCalledTimes(200);
      dispose();
    });
  });

  it('lets a nested provider shadow an outer one', () => {
    const ThemeContext = createContext<Theme>();
    createRoot((dispose) => {
      provide(ThemeContext, { mode: 'light' });
      createRoot(() => {
        provide(ThemeContext, { mode: 'dark' });
        expect(useContext(ThemeContext).value.mode).toBe('dark');
        createRoot(() => {
          expect(useContext(ThemeContext).value.mode).toBe('dark');
        });
      });
      expect(useContext(ThemeContext).value.mode).toBe('light');
      dispose();
    });
  });

  it('keeps sibling scopes independent', () => {
    const Context = createContext<string>();
    createRoot((dispose) => {
      provide(Context, 'root');
      createRoot(() => {
        provide(Context, 'left');
        expect(useContext(Context).value).toBe('left');
      });
      createRoot(() => {
        expect(useContext(Context).value).toBe('root');
      });
      dispose();
    });
  });

  it('replacing a provided value in the same scope wins', () => {
    const Context = createContext<string>();
    createRoot((dispose) => {
      provide(Context, 'first');
      provide(Context, 'second');
      expect(useContext(Context).value).toBe('second');
      dispose();
    });
  });

  it('returns the default value when nobody provides one', () => {
    const Context = createContext<string>('fallback', 'Label');
    createRoot((dispose) => {
      expect(useContext(Context).value).toBe('fallback');
      // The fallback cell is created once and reused.
      expect(useContext(Context)).toBe(useContext(Context));
      dispose();
    });
    expect(useContext(Context).value).toBe('fallback');
  });

  it('throws for a context without a default and without a provider', () => {
    const Context = createContext<Theme>();
    createRoot((dispose) => {
      expect(() => useContext(Context)).toThrow(FirsthandContextError);
      dispose();
    });
  });

  it('stops resolving once the providing scope is disposed', () => {
    const Context = createContext<string>('fallback');
    let stop!: () => void;
    createRoot((dispose) => {
      stop = dispose;
      provide(Context, 'provided');
      expect(useContext(Context).value).toBe('provided');
    });
    stop();
    expect(useContext(Context).value).toBe('fallback');
  });

  it('warns when provide() is called with no scope to attach to', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const Context = createContext<string>('fallback', 'Standalone');
    provide(Context, 'ignored');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Standalone'));
    expect(useContext(Context).value).toBe('fallback');
    warn.mockRestore();
  });

  it('distinguishes tokens with the same shape', () => {
    const a = createContext<string>('a');
    const b = createContext<string>('b');
    createRoot((dispose) => {
      provide(a, 'from-a');
      expect(useContext(a).value).toBe('from-a');
      expect(useContext(b).value).toBe('b');
      dispose();
    });
  });
});
