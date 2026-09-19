/** Public reactive types. */

/** A reactive value that can only be read. */
export interface ReadonlyCell<T> {
  /** Current value. Reading inside an effect or computed subscribes to it. */
  readonly value: T;
  /** Current value, without subscribing. */
  peek(): T;
}

/** A reactive value that can be read and written. */
export interface Signal<T> extends ReadonlyCell<T> {
  value: T;
  /** Functional update; the updater runs untracked. */
  set(updater: (previous: T) => T): void;
}

/** Releases whatever the call that returned it created. */
export type Dispose = () => void;

export interface CellOptions<T> {
  /**
   * Custom equality. `false` makes every write propagate, which is what you
   * want for values the application mutates in place and diffs itself.
   */
  equals?: ((a: T, b: T) => boolean) | false;
}

/** Deeply readonly view of a value. Used by `ReadonlyProps`. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends ReadonlyMap<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends ReadonlySet<infer U>
        ? ReadonlySet<DeepReadonly<U>>
        : T extends Date | RegExp | Promise<unknown>
          ? T
          : T extends object
            ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
            : T;

/**
 * The type a component sees for its props: every key readonly, deeply.
 *
 * Runtime enforcement is limited to the absence of setters on the props object
 * itself — see ADR-0005 for why nothing stronger is possible without paying in
 * object identity, copies or proxies.
 */
export type ReadonlyProps<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> };
