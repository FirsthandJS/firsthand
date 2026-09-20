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

/**
 * What a devtools frontend installs on `globalThis.__FIRSTHAND_DEVTOOLS__`
 * (ADR-0020).
 *
 * Declared once, here, because every package speaks it from its own `dev`
 * module and none of them import each other's. A type costs nothing at
 * runtime, so sharing the definition does not share any code.
 */
export interface DevtoolsHook {
  /** Set by the frontend once it is ready to receive labels. */
  attached: boolean;
  /** Labels a node of the graph: 'signal', 'computed' or 'effect'. */
  label(target: object, kind: string, name: string): void;
  /** The source that just changed, paired with whatever runs next. */
  cause(dep: object): void;
  /** A scope that owns cells, so the frontend can enumerate from the top. */
  root(owner: object): void;
  /** The effect that is running, or `null` between runs. */
  running(effect: object | null): void;
  /**
   * A scope that belongs to a component instance, and what it is called.
   *
   * The owner tree already knows the shape; only the DOM layer knows the name,
   * and only at the moment the instance is created.
   */
  component(owner: object, name: string): void;
  /** The node and property a part is writing, from inside its own effect. */
  part(node: object, property: string): void;
  /**
   * What the query cache just did: an entry created, invalidated or dropped.
   *
   * The cache is the one part of the framework whose behaviour is not in the
   * reactive graph — a tag match is a decision rather than an edge.
   */
  query(event: string, key: string, tags: readonly string[]): void;
}

declare global {
  var __FIRSTHAND_DEVTOOLS__: DevtoolsHook | undefined;
}
