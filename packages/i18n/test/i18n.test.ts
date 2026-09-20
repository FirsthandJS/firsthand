/**
 * Making a translation function reactive.
 *
 * The tests use a stand-in with i18next's shape rather than i18next itself:
 * the package deliberately has no dependency on it, and what is being asserted
 * is the wiring, not somebody else's library. `integrations/i18n` drives the
 * real thing in a real browser.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, effect } from '@firsthandjs/core';
import { fromI18next, translator, type I18nextLike } from '@firsthandjs/i18n';

let stop: (() => void) | null = null;
const inRoot = <T>(body: () => T): T =>
  createRoot((dispose) => {
    stop = dispose;
    return body();
  });

afterEach(() => {
  stop?.();
  stop = null;
});

/**
 * An i18next-shaped instance.
 *
 * Including the resource store, because that is where i18next announces a
 * resource change — a fake without one would let a bug through, which is
 * exactly what happened before the real library was tested against.
 */
function emitter() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    on: (event: string, handler: () => void): void => {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
    },
    off: (event: string, handler: () => void): void => {
      listeners.get(event)?.delete(handler);
    },
    emit: (event: string): void => {
      for (const handler of listeners.get(event) ?? []) {
        handler();
      }
    },
    count: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  };
}

function fake(dictionary: Record<string, Record<string, string>>, language = 'en') {
  const events = emitter();
  const store = emitter();
  const instance = {
    language,
    t: (key: string) => dictionary[instance.language]?.[key] ?? key,
    on: events.on,
    off: events.off,
    store,
    emit: events.emit,
    counts: () => events.count() + store.count(),
  };
  return instance;
}

describe('a translation that follows the language', () => {
  it('re-reads when the language changes', () => {
    const i18n = fake({ en: { greeting: 'Hello' }, de: { greeting: 'Hallo' } });
    const { t } = fromI18next(i18n as unknown as I18nextLike<typeof i18n.t>);
    const seen: unknown[] = [];

    inRoot(() => {
      effect(() => {
        seen.push(t('greeting'));
      });
    });
    expect(seen).toEqual(['Hello']);

    i18n.language = 'de';
    i18n.emit('languageChanged');

    expect(seen).toEqual(['Hello', 'Hallo']);
  });

  it('re-reads when a namespace arrives late', () => {
    // The bug this exists for: a backend loads a namespace after the first
    // render, and without this the key stays rendered as itself forever.
    const dictionary: Record<string, Record<string, string>> = { en: {} };
    const i18n = fake(dictionary);
    const { t } = fromI18next(i18n as unknown as I18nextLike<typeof i18n.t>);
    const seen: unknown[] = [];

    inRoot(() => {
      effect(() => {
        seen.push(t('greeting'));
      });
    });
    expect(seen).toEqual(['greeting']); // missing, so the key itself

    dictionary['en'] = { greeting: 'Hello' };
    i18n.emit('loaded');

    expect(seen).toEqual(['greeting', 'Hello']);
  });

  it('re-reads when a resource is added by hand', () => {
    const dictionary: Record<string, Record<string, string>> = { en: {} };
    const i18n = fake(dictionary);
    const { t } = fromI18next(i18n as unknown as I18nextLike<typeof i18n.t>);
    const seen: unknown[] = [];

    inRoot(() => {
      effect(() => {
        seen.push(t('greeting'));
      });
    });

    dictionary['en'] = { greeting: 'Hello' };
    i18n.store.emit('added');

    expect(seen).toEqual(['greeting', 'Hello']);
  });

  it('exposes the current language as a cell', () => {
    const i18n = fake({ en: {}, de: {} });
    const { language } = fromI18next(i18n as unknown as I18nextLike<typeof i18n.t>);
    const seen: string[] = [];

    inRoot(() => {
      effect(() => {
        seen.push(language.value);
      });
    });
    expect(seen).toEqual(['en']);

    i18n.language = 'de';
    i18n.emit('languageChanged');

    expect(seen).toEqual(['en', 'de']);
  });

  it('passes arguments through untouched', () => {
    const translate = vi.fn((key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}:${JSON.stringify(options)}`,
    );
    const { t } = translator({
      translate,
      language: () => 'en',
      subscribe: () => () => undefined,
    });

    expect(t('greeting', { name: 'Ada' })).toBe('greeting:{"name":"Ada"}');
    expect(translate).toHaveBeenCalledWith('greeting', { name: 'Ada' });
  });
});

describe('what it subscribes, and what it lets go', () => {
  it('listens on the instance and on the store, and stops on both', () => {
    const i18n = fake({ en: {} });
    const { dispose } = fromI18next(i18n as unknown as I18nextLike<typeof i18n.t>);
    // `languageChanged` and `loaded` on the instance; `added` and `removed`
    // on the store.
    expect(i18n.counts()).toBe(4);

    dispose();
    expect(i18n.counts()).toBe(0);
  });

  it('works with an instance that has no store at all', () => {
    const i18n = fake({ en: { greeting: 'Hello' } });
    const withoutStore = { ...i18n, store: undefined };
    const { t, dispose } = fromI18next(withoutStore as unknown as I18nextLike<typeof i18n.t>);

    expect(t('greeting')).toBe('Hello');
    expect(() => dispose()).not.toThrow();
  });

  it('is disposed with the scope that created it', () => {
    const i18n = fake({ en: {} });
    const dispose = createRoot((stopRoot) => {
      fromI18next(i18n as unknown as I18nextLike<typeof i18n.t>);
      return stopRoot;
    });
    expect(i18n.counts()).toBe(4);

    dispose();
    expect(i18n.counts()).toBe(0);
  });

  it('survives at module level, where nothing owns it', () => {
    // No root: `onCleanup` would have nowhere to register, and warning about
    // that would be wrong — module level is where translations are set up.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const i18n = fake({ en: { greeting: 'Hello' } });
    const { t, dispose } = fromI18next(i18n as unknown as I18nextLike<typeof i18n.t>);

    expect(t('greeting')).toBe('Hello');
    expect(warn).not.toHaveBeenCalled();

    dispose();
    warn.mockRestore();
  });
});

describe('any other library', () => {
  it('takes a translator built by hand', () => {
    // FormatJS, Lingui, Polyglot, or a `Map` — anything that can translate and
    // can say when the answer changed.
    // A plain variable rather than a signal: the point is that the library
    // need not be reactive at all — that is what this package is for.
    let locale = 'en';
    const dictionary: Record<string, Record<string, string>> = {
      en: { bye: 'Goodbye' },
      fr: { bye: 'Au revoir' },
    };
    const listeners = new Set<() => void>();

    const { t, language } = translator({
      translate: (key: string) => dictionary[locale]?.[key] ?? key,
      language: () => locale,
      subscribe: (changed) => {
        listeners.add(changed);
        return () => listeners.delete(changed);
      },
    });

    const seen: unknown[] = [];
    inRoot(() => {
      effect(() => {
        seen.push(`${language.value}: ${t('bye') as string}`);
      });
    });

    locale = 'fr';
    for (const listener of listeners) {
      listener();
    }

    expect(seen).toEqual(['en: Goodbye', 'fr: Au revoir']);
  });
});
