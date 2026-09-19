/**
 * Element types this framework does not own.
 *
 * A component from another framework is a function, and TSX is happy to write
 * it as an element. Firsthand cannot run it — there is nothing here that knows
 * what a React element is, and putting that knowledge in this package would
 * make every application pay for a framework it may not use.
 *
 * So this is a seam and nothing else: one slot for an adapter, one cache, and
 * an error that names the fix. `@firsthandjs/react/auto` fills the slot; anything
 * else can fill it the same way. No name in this file mentions React.
 */
import type { Component } from './component.js';

/** Turns a foreign component into a Firsthand one. Called once per target. */
export type ComponentAdapter = (target: (props: never) => unknown) => Component<never>;

let adapter: ComponentAdapter | null = null;

/**
 * One adapted component per target.
 *
 * Identity matters rather than merely being cheap: an adapter usually holds
 * per-component state — a React root, in the bridge's case — and adapting the
 * same function twice would mean two of them for what the code wrote as one
 * component.
 */
let adapted = new WeakMap<object, Component<never>>();

/**
 * Installs the adapter used for element types that are not Firsthand components.
 *
 * Call it once, at startup. `null` removes it again, which is what a test does
 * between cases.
 */
export function setComponentAdapter(next: ComponentAdapter | null): void {
  adapter = next;
  // Anything adapted by the previous one was built by code that is no longer
  // installed, so it is dropped rather than outliving it.
  adapted = new WeakMap();
}

/** Thrown for an element type this framework cannot run. */
export class FirsthandComponentError extends Error {
  constructor(name: string) {
    super(
      `${name} is not a Firsthand component. If it is a React component, import ` +
        `'@firsthandjs/react/auto' once at startup to render React components ` +
        `directly, or wrap it with fromReact(). Otherwise, declare it with component().`,
    );
    this.name = 'FirsthandComponentError';
  }
}

/** Resolves a foreign element type, or says why it cannot be resolved. */
export function adapt(target: object): Component<never> {
  const existing = adapted.get(target);
  if (existing !== undefined) {
    return existing;
  }
  if (adapter === null) {
    const name = typeof target === 'function' && target.name !== '' ? target.name : 'The value';
    throw new FirsthandComponentError(name);
  }
  const component_ = adapter(target as (props: never) => unknown);
  adapted.set(target, component_);
  return component_;
}
