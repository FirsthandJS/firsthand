/**
 * `@firsthandjs/i18n` — makes a translation function reactive.
 *
 * i18next, FormatJS, Lingui and Polyglot all work here already: they are plain
 * JavaScript, and nothing about this framework stops you calling `t('greeting')`.
 * What none of them do is tell the *graph* that the answer changed, so a label
 * rendered before the language switch keeps its old text.
 *
 * ```tsx
 * import i18next from 'i18next';
 * import { fromI18next } from '@firsthandjs/i18n';
 *
 * await i18next.init({ lng: 'en', resources });
 * export const { t, language } = fromI18next(i18next);
 *
 * // and then, in a component:
 * <h1>{t('greeting', { name: 'Ada' })}</h1>   // re-reads on a language change
 * ```
 *
 * The whole package is a version signal and a wrapper that reads it. There is
 * no dictionary here, no plural rules, no date formatting and no intention of
 * ever having any: the libraries that do that are good, and this is the eleven
 * lines that connect them.
 */
import {
  batch,
  getOwner,
  onCleanup,
  signal,
  type Dispose,
  type ReadonlyCell,
} from '@firsthandjs/core';

/** A translation function, whatever shape the library gave it. */
type Translate = (...args: never[]) => unknown;

/** What a localisation library has to offer to be made reactive. */
export interface Source<T extends Translate> {
  /** The library's own `t`, untouched — its types are the ones you keep. */
  translate: T;
  /** The language in effect right now, read when something asks. */
  language: () => string;
  /**
   * Calls `changed` whenever a translation could answer differently, and
   * returns the way to stop listening.
   *
   * "Could answer differently" is wider than "the language changed": a backend
   * that loads a namespace late changes the answer too, and forgetting that is
   * why translations sometimes appear as their keys for a moment and then
   * never recover.
   */
  subscribe: (changed: () => void) => Dispose;
}

/** A reactive translation function, and the language it is reading. */
export interface Translator<T extends Translate> {
  /** The same function, with the same types, that now re-runs when it should. */
  t: T;
  /** The current language, as a cell: read it in a part and it stays current. */
  language: ReadonlyCell<string>;
  /** Stops listening. Registered with the enclosing scope, if there is one. */
  dispose: Dispose;
}

/**
 * Wraps any translation function so that reading it subscribes.
 *
 * The wrapper reads a version signal and then calls through. That is the whole
 * mechanism: a part that renders a translation has read the signal, so a
 * language change re-runs exactly that part and nothing else — no re-render,
 * no provider, no context.
 *
 * If called inside a component or a root, the subscription is disposed with
 * that scope. At module level — which is where an application usually sets up
 * its translations — nothing owns it, so it lives as long as the page and
 * `dispose` is there for the cases that need it.
 */
export function translator<T extends Translate>(source: Source<T>): Translator<T> {
  const version = signal(0);
  const language = signal(source.language());
  const stop = source.subscribe(() => {
    // One event, two cells, one update. Without the batch, anything reading
    // both the language and a translation — a header showing the locale next
    // to a translated title — would run twice for one language change.
    batch(() => {
      language.value = source.language();
      version.value++;
    });
  });

  const t = ((...args: never[]): unknown => {
    // Reading the version is the subscription. The value is never used.
    version.value;
    return source.translate(...args);
  }) as T;

  const dispose = (): void => {
    stop();
  };
  // Only when something owns this. Setting up translations at module level is
  // the normal case, and `onCleanup` there would warn about a callback that
  // can never run — a warning that would be right in general and wrong here.
  if (getOwner() !== null) {
    onCleanup(dispose);
  }

  return { t, language, dispose };
}

/**
 * The shape this package needs from i18next.
 *
 * Declared structurally rather than imported, so the package has no dependency
 * on i18next, no opinion about its version, and works with anything that looks
 * like it — `createInstance()`, a mock in a test, or a fork.
 */
export interface I18nextLike<T extends Translate> {
  t: T;
  language: string;
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
  /**
   * The resource store, if this instance has one.
   *
   * i18next announces a *language* change on the instance and a *resource*
   * change on the store. Listening only to the instance is the mistake that
   * makes `addResource` look like it did nothing — it was found by testing
   * against the real library rather than against something shaped like it.
   */
  store?: Emitter;
}

/** The part of an event emitter this package uses. */
export interface Emitter {
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
}

/**
 * What changes the answer, and where each is announced.
 *
 * `languageChanged` is the obvious one and `loaded` fires when a backend has
 * fetched a namespace; both come from the instance. `added` and `removed` come
 * from the resource store, which is where `addResource` reports — and a key
 * that was missing when it was first read is exactly the case that otherwise
 * stays rendered as itself forever.
 */
const INSTANCE_EVENTS = ['languageChanged', 'loaded'] as const;
const STORE_EVENTS = ['added', 'removed'] as const;

/** Connects an i18next instance. See {@link translator} for what it does. */
export function fromI18next<T extends Translate>(instance: I18nextLike<T>): Translator<T> {
  return translator({
    // Called through rather than passed along: i18next's `t` is bound to its
    // instance, and a fork or a mock might not be.
    translate: ((...args: never[]) => instance.t(...args)) as T,
    language: () => instance.language,
    subscribe: (changed) => {
      const store = instance.store;
      for (const event of INSTANCE_EVENTS) {
        instance.on(event, changed);
      }
      if (store !== undefined) {
        for (const event of STORE_EVENTS) {
          store.on(event, changed);
        }
      }
      return () => {
        for (const event of INSTANCE_EVENTS) {
          instance.off(event, changed);
        }
        if (store !== undefined) {
          for (const event of STORE_EVENTS) {
            store.off(event, changed);
          }
        }
      };
    },
  });
}
