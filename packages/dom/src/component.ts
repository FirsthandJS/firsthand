import {
  signal,
  createOwner,
  devEnterSetup,
  devExitSetup,
  disposeOwner,
  getOwner,
  handleError,
  setOwner,
  untrack,
  type Owner,
} from '@firsthandjs/core';
import type { ReadonlyProps } from '@firsthandjs/core';
import { adapt } from './adapter.js';
import { devComponent, devWarnOnce } from './dev.js';
import { applyChild, part, type DynamicChild } from './insert.js';

/** Marks a value as a Firsthand component; used by the JSX runtime and compiler. */
export const COMPONENT: unique symbol = Symbol.for('firsthand.component');

/**
 * Marks a plain function that returns markup.
 *
 * `Symbol.for` rather than a local symbol: the mark has to survive a module
 * boundary, so a view function compiled in one package is recognised in
 * another that may hold its own copy of this module.
 */
export const VIEW: unique symbol = Symbol.for('firsthand.view');

export type ComponentOptions = {
  /** Attach a shadow root to the element host. Implies `tag` (ADR-0007). */
  shadow?: boolean;
  /** Host this component in a real custom element (ADR-0003). */
  tag?: true | string;
  /** Explicit attribute codecs for vanilla-HTML consumers of the element. */
  attributes?: Readonly<Record<string, AttributeCodec>>;
};

/** Converts an attribute string to a prop value. `null` means "absent". */
export type AttributeCodec = (raw: string | null) => unknown;

/**
 * Anything a component or a dynamic expression may produce.
 *
 * `JSX.Element` is an alias of this, so TSX and the runtime agree on what a
 * view is instead of one of them describing the other loosely.
 *
 * `DynamicChild` is in the union because a deferred child position is a real
 * thing a view can be: it is what the compiler emits for a dynamic child of a
 * fragment, and what a component returns when it renders something that has to
 * be bound after it is placed — a route outlet, for instance.
 */
export type View =
  Node | string | number | boolean | null | undefined | DynamicChild | readonly View[] | Render;

/**
 * A view that is evaluated as a whole, again, when something it read changes.
 *
 * This is what a setup returns when it has statements above its markup — an
 * `if`, a value derived from several signals — and it is an ordinary function,
 * which is the point: it is a reactive scope like `effect` and `computed`, one
 * level up.
 *
 * ```tsx
 * component(() => () => (signedIn.value ? <Page /> : <SignIn />));
 * ```
 */
export type Render = () => View;

/**
 * Props as a *caller* may write them.
 *
 * An optional prop accepts an explicit `undefined`. Under
 * `exactOptionalPropertyTypes` it otherwise would not, and `count={maybe}`
 * — where `maybe` is `number | undefined` — would be an error although
 * "absent" and "undefined" mean exactly the same thing to the component that
 * receives it. Required props are untouched.
 */
export type PropsArgument<P> = {
  [K in keyof P]: undefined extends P[K] ? P[K] | undefined : P[K];
};

export type Component<P> = {
  /**
   * Creates an instance.
   *
   * This is a real call: `<Counter initial={1} />` compiles to
   * `createComponent(Counter, ...)`, and calling `Counter({ initial: 1 })`
   * does the same thing. The signature is also what makes a component a valid
   * TSX element type without any JSX-namespace special-casing.
   */
  (props: PropsArgument<P>): View;
  readonly [COMPONENT]: true;
  readonly setup: (props: ReadonlyProps<P>) => View;
  readonly options: ComponentOptions | undefined;
  /** Stable build id from the compiler; never `Function.name` (ADR-0004). */
  readonly id: string;
  /** Original identifier, for devtools and error messages. */
  readonly name: string;
  /** Registered custom element name, once `defineElement` has run. */
  tag: string | undefined;
};

let sequence = 0;
let prefix = 'firsthand';

/**
 * Sets the prefix for custom element names. Call once, at startup.
 *
 * `setElementPrefix('acme')` makes `UserCard` register as `<acme-user-card>`.
 * The prefix is the only thing an application has to say about element names:
 * the rest is derived from the binding the component was assigned to.
 */
export function setElementPrefix(value: string): void {
  prefix = value;
}

/**
 * Declares a component.
 *
 * The setup function runs exactly once per instance. The component's identity
 * is the binding you assign it to — there is no name string to repeat, and no
 * reliance on `Function.name`, which minifiers rewrite (ADR-0004).
 */
export function component<P>(
  setup: (props: ReadonlyProps<P>) => View,
  options?: ComponentOptions,
  id?: string,
  name?: string,
): Component<P> {
  // A callable marker rather than a plain object: one function object per
  // component *type* costs nothing measurable, and it makes `<Counter />`
  // type-check as an ordinary TSX element, with no `JSX.ElementType`
  // special-casing and no cast at the use site.
  const instantiate = (props: PropsArgument<P>): View =>
    // The relaxation is in the signature only: the object itself is the
    // caller's, and `P` is what the setup function sees.
    createComponent(declared, props as P);
  const declared: Component<P> = Object.assign(instantiate, {
    [COMPONENT]: true as const,
    setup,
    options,
    id: id ?? `c${String(++sequence)}`,
    tag: undefined as string | undefined,
  });
  // A function's `name` is read-only, so it is redefined rather than assigned.
  Object.defineProperty(declared, 'name', {
    configurable: true,
    value: name ?? (setup.name === '' ? 'Component' : setup.name),
  });
  if (id === undefined) {
    devWarnOnce(
      'no-compiler',
      `${declared.name} was declared without the Firsthand compiler, so component ids are generated ` +
        'at runtime and are not stable across builds. Element names and devtools labels degrade.',
    );
  }
  if (options?.tag !== undefined || options?.shadow === true) {
    defineElement(declared, typeof options.tag === 'string' ? options.tag : undefined);
  }
  return declared;
}

export function isComponent(value: unknown): value is Component<never> {
  return typeof value === 'function' && COMPONENT in value;
}

/**
 * Declares a plain function to be a view.
 *
 * A function that returns markup is a view, and a view is a reactive scope:
 * `<Badge user={user} />` calls it where it stands, and calls it again when
 * something it read changes. It has no setup, so it owns nothing that has to
 * survive a run — `signal`, `effect` and their kind belong in a `component`.
 *
 * The compiler emits this for every module-level function it compiled markup
 * into, so that a view imported from another module is still recognised as
 * ours rather than handed to whatever adapter is installed. Inside one module
 * the compiler resolves the call itself and this is never consulted.
 */
export function view<T extends (props: never) => unknown>(target: T): T {
  (target as unknown as Record<symbol, boolean>)[VIEW] = true;
  return target;
}

/**
 * Instantiates a component.
 *
 * `props` arrives exactly as the caller built it: object references are
 * preserved, nothing is serialised or copied, and dynamic props are accessor
 * properties so that reading them subscribes to whatever the parent read
 * (ADR-0005). The object itself is frozen, so top-level props have no writable
 * slots; the values it points at are the caller's own and are never touched.
 *
 * Setup runs untracked: a component created inside a conditional part must not
 * subscribe that part to everything its setup happens to read.
 */
export function createComponent<P>(target: Component<P>, props: P): View {
  Object.freeze(props);
  // One property read, on a component this package declared — not an `in`
  // check — so the ordinary path pays a load and a comparison. A function
  // without a setup is not ours: a React component, say, which an installed
  // adapter can still render (see `adapter.ts`).
  if ((target as { setup?: unknown }).setup === undefined) {
    if (VIEW in target) {
      // A view is its own reactive scope, so the call is deferred into a part
      // rather than made here: whatever it reads belongs to the view, not to
      // whoever happened to be running when the element was created.
      return part(() => (target as unknown as (props: P) => View)(props));
    }
    return (adapt(target) as (props: never) => View)(props as never);
  }
  if (target.tag !== undefined) {
    return createHost(target, props);
  }
  const owner = createOwner(getOwner());
  devComponent(owner, target.name);
  const previous = setOwner(owner);
  // Restored explicitly on both paths rather than in a `finally`, so the error
  // path is ordinary code that tests can reach.
  try {
    // The cast is the whole point of `ReadonlyProps`: the caller hands over a
    // mutable value, the component sees a readonly view of the same object.
    // Nothing is copied, so there is nothing to keep in sync.
    devEnterSetup(target.id);
    const result = untrack(() => target.setup(props as ReadonlyProps<P>));
    devExitSetup();
    setOwner(previous);
    return result;
  } catch (error) {
    devExitSetup();
    setOwner(previous);
    handleError(error, owner);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Custom element host (ADR-0003, ADR-0004)
// ---------------------------------------------------------------------------

interface FirsthandElement extends HTMLElement {
  $owner: Owner | null;
  $props: Record<string, unknown> | null;
  /** Signal per observed attribute, for elements upgraded from markup. */
  $attrs: Record<string, { value: unknown }> | null;
  $standalone: boolean;
}

/** `UserCard` -> `acme-user-card`, using the prefix `setElementPrefix` holds. */
export function tagNameFor(target: Component<unknown>): string {
  const base = target.name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .toLowerCase();
  return `${prefix}-${base}`;
}

/**
 * Registers a component as a real custom element.
 *
 * This is the opt-in half of ADR-0003: components are hostless by default
 * because an upgraded custom element costs a constructor call, an upgrade
 * reaction and an extra node per instance.
 */
export function defineElement(target: Component<never>, tag?: string): string {
  const declared = target as unknown as Component<unknown>;
  if (declared.tag !== undefined) {
    return declared.tag;
  }
  let name = tag ?? tagNameFor(declared);
  if (customElements.get(name) !== undefined) {
    // Two components with the same identifier, or a name already taken by
    // someone else. The stable build id disambiguates without a name string.
    name = `${name}-${declared.id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`;
  }
  declared.tag = name;
  customElements.define(name, elementClass(declared));
  return name;
}

/**
 * The adapter the platform requires.
 *
 * It contains no component logic: it creates a scope, runs the same setup
 * function a hostless component would run, and disposes. Everything a developer
 * writes stays functional.
 */
function elementClass(target: Component<unknown>): CustomElementConstructor {
  const shadow = target.options?.shadow === true;
  const codecs = target.options?.attributes;
  const observed = codecs !== undefined ? Object.keys(codecs) : [];

  const ctor = class extends HTMLElement implements FirsthandElement {
    declare $owner: Owner | null;
    declare $props: Record<string, unknown> | null;
    declare $attrs: Record<string, { value: unknown }> | null;
    declare $standalone: boolean;

    static readonly observedAttributes = observed;

    constructor() {
      super();
      this.$owner = null;
      this.$props = null;
      this.$attrs = null;
      this.$standalone = false;
    }

    connectedCallback(): void {
      if (this.$owner !== null) {
        return;
      }
      // Getting this far means the element was upgraded from markup: a host
      // Firsthand created is mounted at creation and already has an owner, so
      // it returned above. This one owns its own scope instead, and disposes
      // itself when it leaves the document.
      this.$standalone = true;
      this.$attrs = {};
      this.$props = attributeProps(this, codecs, this.$attrs);
      mountHost(this, target, shadow);
    }

    disconnectedCallback(): void {
      if (!this.$standalone || this.$owner === null) {
        // Firsthand-created hosts are disposed by their owner, so that moving a
        // node in the DOM does not destroy its state.
        return;
      }
      disposeOwner(this.$owner);
      this.$owner = null;
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
      // Only ever fires for attributes listed in the codec schema, and only
      // touches the element's own attribute signals — never a props object a
      // Firsthand parent built.
      const cell = this.$attrs?.[name];
      if (cell !== undefined) {
        cell.value = (codecs as Record<string, AttributeCodec>)[name]?.(value);
      }
    }
  };

  return ctor;
}

/**
 * Builds a reactive props object for an element upgraded from plain markup.
 *
 * Each observed attribute gets a signal and an accessor, so an attribute change
 * updates exactly the parts that read that prop — the same behaviour a Firsthand
 * parent would produce.
 */
function attributeProps(
  element: HTMLElement,
  codecs: Readonly<Record<string, AttributeCodec>> | undefined,
  cells: Record<string, { value: unknown }>,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (codecs !== undefined) {
    for (const name in codecs) {
      const cell = signal<unknown>((codecs[name] as AttributeCodec)(element.getAttribute(name)));
      cells[name] = cell;
      Object.defineProperty(props, name, {
        enumerable: true,
        get: () => cell.value,
      });
    }
  }
  return Object.freeze(props);
}

function mountHost(element: FirsthandElement, target: Component<unknown>, shadow: boolean): void {
  const owner = createOwner(getOwner());
  devComponent(owner, target.name);
  element.$owner = owner;
  const previous = setOwner(owner);
  try {
    // First in the block, so that the matching exit in `catch` is always
    // balanced no matter which statement below throws.
    devEnterSetup(target.id);
    const root = shadow ? element.attachShadow({ mode: 'open' }) : element;
    const result = untrack(() => target.setup(element.$props as Record<string, unknown>));
    devExitSetup();
    applyChild(root, null, null, result);
  } catch (error) {
    devExitSetup();
    handleError(error, owner);
  } finally {
    setOwner(previous);
  }
}

function createHost<P>(target: Component<P>, props: P): HTMLElement {
  const element = document.createElement(target.tag as string) as FirsthandElement;
  element.$props = props as unknown as Record<string, unknown>;
  // `tag` is only ever set by `defineElement`, which defines the element in the
  // same breath, so the upgrade has run and the constructor has left `$owner`
  // null. `connectedCallback` fires on insertion, which has not happened yet —
  // so mount here, because the caller expects a filled node back.
  mountHost(element, target as unknown as Component<unknown>, target.options?.shadow === true);
  return element;
}
