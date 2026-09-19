/**
 * `styled.button\`…\`` and `styled(Component)\`…\``.
 *
 * The API is styled-components'. What happens underneath is not: a component
 * runs once, so there is no render to regenerate styles from. A template
 * becomes one class at declaration time, and a prop that only feeds a
 * declaration's value updates a custom property on the element — one property
 * write, no new rule, no class swap, no matter how many instances exist.
 */
import { bind, signal, useContext, type ReadonlyCell, type Signal } from '@firsthandjs/core';
import { component, type Component, type View } from '@firsthandjs/dom';
import { applyProp, insert } from '@firsthandjs/dom/internal';
// Type-only: brings the global JSX namespace along, so a styled `button`
// accepts exactly what `<button>` accepts.
import type {} from '@firsthandjs/jsx-runtime';
import { blockText, compile, css, isFragment, join, type CssFragment } from './css.js';
import { hash, insert as insertRule } from './sheet.js';
import { ThemeContext, type Theme } from './theme.js';

/** Props a styled element accepts beyond the ones you declare. */
export type ElementProps<T extends string> = T extends keyof JSX.IntrinsicElements
  ? JSX.IntrinsicElements[T]
  : Record<string, unknown>;

/** What an interpolation function is given: the props, plus the theme. */
export type StyledProps<P> = P & { readonly theme: Theme };

export type Interpolation<P> = string | number | CssFragment | ((props: StyledProps<P>) => unknown);

export interface StyledFactory<Base> {
  /**
   * `P` is what you add: `styled.button<{ $primary?: boolean }>`.
   *
   * It defaults to `unknown` rather than an empty record, because an empty
   * record's index signature would type every other prop — `children`
   * included — as `never`.
   */
  <P = unknown>(
    strings: TemplateStringsArray,
    ...values: Interpolation<P & Base>[]
  ): Component<P & Base>;
}

/**
 * Whether a prop belongs on the element.
 *
 * styled-components ships a list of every valid HTML attribute to answer this.
 * The element already knows: a property that exists on it is real, and
 * anything else is either a documented escape (`data-`, `aria-`, an event) or
 * a prop that only feeds the styles.
 */
function forwards(element: Element, name: string): boolean {
  if (name === 'children' || name === 'class' || name.startsWith('$')) {
    return false;
  }
  return (
    name in element ||
    name.startsWith('data-') ||
    name.startsWith('aria-') ||
    name.startsWith('on') ||
    name === 'style' ||
    name === 'role'
  );
}

/**
 * A live view of the props with the theme attached.
 *
 * Getters rather than a copy: an interpolation read inside an effect sees the
 * current value, which is what makes a styled component update at all.
 */
function withTheme(
  props: Record<string, unknown>,
  theme: ReadonlyCell<Theme>,
): Record<string, unknown> {
  const view: Record<string, unknown> = {};
  for (const name of Object.keys(props)) {
    Object.defineProperty(view, name, { enumerable: true, get: () => props[name] });
  }
  Object.defineProperty(view, 'theme', { enumerable: true, get: () => theme.value });
  return view;
}

let sequence = 0;

/**
 * How many times a component has been wrapped by `styled(...)`.
 *
 * Restyling has to win, and class order in the attribute does not decide
 * anything — the cascade does, and two single-class rules of equal specificity
 * are decided by which was inserted last. That order is not knowable here: a
 * component with a block interpolation inserts its rule when it first renders,
 * and a wrapper renders before what it wraps.
 *
 * So each wrapping level repeats its own class in the selector — `.a`, then
 * `.b.b`, then `.c.c.c`. Specificity then says what the code says: the outer
 * declaration wins, whatever order the rules reached the sheet in.
 */
const depths = new WeakMap<object, number>();

/**
 * Builds the component for one template.
 *
 * `base` is either a tag name or another component; everything else is the
 * same, which is what makes `styled(Link)` work.
 */
function make<P>(base: string | Component<P>, fragment: CssFragment): Component<P> {
  const tag = typeof base === 'string' ? base : null;
  const depth = tag === null ? (depths.get(base as object) ?? 0) + 1 : 0;
  const id = `s${hash(fragment.strings.join('|'))}${String(++sequence)}`;
  /** `.c` at depth 0, `.c.c` at depth 1, and so on. */
  const selector = (name: string): string => `.${name}`.repeat(depth + 1);
  // Only a tag gets custom properties: they are set on an element, and a
  // wrapped component's element belongs to that component. Everything else
  // resolves into the class, which always works.
  const compiled = compile(fragment, id, tag !== null);

  // The one class every instance shares. With no block slots this is the only
  // rule this component will ever produce.
  const staticText = join(compiled, () => '');
  const baseClass = `${id}-${hash(staticText)}`;
  const blocks = compiled.slots.some((slot) => slot.kind === 'block');
  if (!blocks) {
    insertRule(baseClass, `${selector(baseClass)}{${staticText}}`);
  }

  const setup = (props: Record<string, unknown>): View => {
    const theme = useContext(ThemeContext);
    const view = withTheme(props, theme);
    const element = tag === null ? null : document.createElement(tag);

    /** The class list for this instance, `class` prop included. */
    let applied = '';
    /**
     * The same value, as a cell — but only when wrapping a component.
     *
     * A wrapped component reads the class as an ordinary prop, so a wrapper
     * whose own class changes (a block interpolation, or one that reads the
     * theme) has to be able to notify it: the element belongs to whatever it
     * wraps. An element is written to directly and needs no cell, and a list
     * of a thousand styled rows should not allocate a thousand of them.
     */
    const cell = element === null ? signal('') : null;
    const setClass = (own: string): void => {
      const extra = props['class'];
      const whole = `${own}${typeof extra === 'string' && extra !== '' ? ` ${extra}` : ''}`;
      if (whole === applied) {
        return;
      }
      applied = whole;
      if (element === null) {
        (cell as Signal<string>).value = whole;
      } else {
        element.className = whole;
      }
    };

    if (blocks) {
      // A block can produce any CSS, so its result decides the rule — and the
      // rule's own text decides its name, which is how two instances that
      // resolve the same way share one.
      bind(() => {
        const text = join(compiled, (slot) => blockText(slot.fn(view)));
        const name = `${id}-${hash(text)}`;
        insertRule(name, `${selector(name)}{${text}}`);
        setClass(name);
      });
    } else {
      bind(() => {
        setClass(baseClass);
      });
    }

    // Value slots are custom properties: one write each, and only for the ones
    // whose inputs actually changed. They exist only for a tag, so there is an
    // element to set them on.
    for (const slot of compiled.slots) {
      if (slot.kind !== 'value') {
        continue;
      }
      const host = element as HTMLElement;
      bind(() => {
        const value = slot.fn(view);
        const text = value === null || value === undefined || value === false ? '' : String(value);
        host.style.setProperty(slot.property, text);
      });
    }

    if (element === null) {
      // Wrapping another component: it receives the class like any other prop,
      // and is responsible for putting it on its root — the same contract
      // styled-components has with `className`.
      const forwarded: Record<string, unknown> = {};
      for (const name of Object.keys(props)) {
        // `class` is deliberately not copied: `setClass` has already folded an
        // incoming one into `applied`, and defining it twice on the same
        // object throws — which is what `styled(styled(X))` used to do.
        //
        // Transient (`$`) props *are* forwarded here, unlike at an element:
        // what this wraps may itself be a styled component that declares them,
        // and stripping them would leave the inner level unable to see the
        // props the outer one was given. They are stripped where they would do
        // harm — on a real element — by `forwards`.
        if (name !== 'class') {
          Object.defineProperty(forwarded, name, {
            enumerable: true,
            get: () => props[name],
          });
        }
      }
      Object.defineProperty(forwarded, 'class', {
        enumerable: true,
        get: () => (cell as Signal<string>).value,
      });
      return (base as Component<P>)(forwarded as never);
    }

    for (const name of Object.keys(props)) {
      if (!forwards(element, name)) {
        continue;
      }
      bind(() => {
        applyProp(element, name, props[name]);
      });
    }
    insert(element, () => props['children']);
    return element;
  };

  const declared = component<P>(
    setup,
    undefined,
    `firsthand/styled:${id}`,
    tag === null ? `Styled(${(base as Component<P>).name})` : `Styled(${tag})`,
  );
  depths.set(declared, depth);
  return declared;
}

type Tags = {
  [T in keyof JSX.IntrinsicElements]: StyledFactory<ElementProps<T>>;
};

/**
 * `styled.div`, `styled.button`, … and `styled(Component)`.
 *
 * The tag list is a proxy rather than a hand-written map: every element the
 * JSX namespace knows is available, and the package stays the same size.
 */
export const styled = new Proxy(
  ((base: Component<never>) =>
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      make(base as never, css(strings, ...values))) as unknown as Tags & {
    <P>(base: Component<P>): StyledFactory<P>;
  },
  {
    get:
      (_target, tag: string) =>
      (strings: TemplateStringsArray, ...values: unknown[]) =>
        make(tag, css(strings, ...values)),
  },
);

export { isFragment };
