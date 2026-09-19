/**
 * `@firsthandjs/react` — React components inside Firsthand.
 *
 * For the case this framework cannot solve any other way: a component library
 * that exists only as React components. MUI, Radix, Ant, react-select — none
 * of them can run without React's reconciler, so this mounts one.
 *
 * ```tsx
 * import Button from '@mui/material/Button';
 * import { fromReact } from '@firsthandjs/react';
 *
 * const MuiButton = fromReact(Button);
 *
 * <MuiButton variant="contained" onClick={save}>Save</MuiButton>;
 * ```
 *
 * **What it costs, stated plainly.** React and react-dom are about 45 kB gzip,
 * eight times this framework's whole runtime, and everything below a bridge is
 * React's: its reconciler, its re-renders, its event system. A prop change
 * re-renders that subtree the way React always does. The bridge is
 * fine-grained on the Firsthand side only — it re-renders the React root when a
 * prop it reads changes, and not otherwise.
 *
 * So this is an escape hatch, not a foundation. For a date picker nobody wants
 * to write again, it is the right trade. For a button, it is 45 kB for a
 * button, and [`@firsthandjs/styled`](../styled) or a web-component library costs
 * nothing.
 *
 * `react` and `react-dom` are peer dependencies: an application that never
 * imports this package does not install them.
 */
import { bind, onCleanup, signal } from '@firsthandjs/core';
import { component, type Component, type View } from '@firsthandjs/dom';
import { insert } from '@firsthandjs/dom/internal';
import { createElement, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** Wraps what every bridged root renders — a provider tower, usually. */
export type ReactWrapper = (node: ReactNode) => ReactNode;

/**
 * Held in a signal, so installing or changing it re-renders every bridged
 * root: each of them reads this while rendering.
 */
const wrapper = signal<ReactWrapper | null>(null);

/**
 * Wraps every bridged React root in the same React elements.
 *
 * Each bridge mounts its **own** React root, so React context does not flow
 * from one to another: a `<ThemeProvider>` written as one bridged component
 * cannot reach a `<Button>` written as another, because they are different
 * trees. Providers therefore have to be per root, which is what this does.
 *
 * ```tsx
 * import { createElement } from 'react';
 * import { ThemeProvider } from '@mui/material/styles';
 *
 * setReactWrapper((node) => createElement(ThemeProvider, { theme: muiTheme(theme.value) }, node));
 * ```
 *
 * Reading a signal inside the wrapper — `theme.value` above — is an ordinary
 * reactive read, so swapping the theme re-renders every bridged component and
 * nothing else. `null` removes it again.
 */
export function setReactWrapper(next: ReactWrapper | null): void {
  wrapper.value = next;
}

/**
 * Props a bridged component takes.
 *
 * The React component's own, except `children`: what you write inside a
 * bridged component in TSX is Firsthand's, not React's — DOM that Firsthand keeps
 * owning inside the React tree — so the type says `View` rather than
 * `ReactNode`.
 */
export type BridgeProps<P> = Omit<P, 'children'> & {
  readonly children?: View;
  /** Put on the element React renders into, not passed to the component. */
  readonly class?: string;
  /** The element to mount into. `span` by default, so inline layout survives. */
  readonly host?: keyof HTMLElementTagNameMap;
};

/**
 * Puts one Firsthand-owned element inside a React tree.
 *
 * React cannot render DOM nodes, and Firsthand's children are not plain nodes —
 * a dynamic child is a deferred part that has to be bound to a parent before
 * it means anything. So Firsthand keeps its own element, fills it through the
 * ordinary `insert`, and React is handed a place to put it. Everything inside
 * stays Firsthand's: reactive children update without React hearing about it.
 */
function Adopted({ slot }: { slot: HTMLElement }): ReactNode {
  return createElement('span', {
    ref: (host: HTMLElement | null) => {
      if (host !== null && slot.parentNode !== host) {
        host.appendChild(slot);
      }
    },
  });
}

/**
 * Turns a React component into a Firsthand one.
 *
 * Call it once, at module level, next to the import — a bridge created inside
 * a component would mount a new React root per instance.
 */
export function fromReact<P extends object>(
  Component_: ComponentType<P>,
  options: { host?: keyof HTMLElementTagNameMap } = {},
): Component<BridgeProps<P>> {
  const setup = (props: Record<string, unknown>): View => {
    const tag =
      (props['host'] as keyof HTMLElementTagNameMap | undefined) ?? options.host ?? 'span';
    const element = document.createElement(tag);
    let root: Root | null = createRoot(element);

    // Created once, outside the render effect, so React never sees a new
    // child element and never throws the subtree away.
    const slot = 'children' in props ? document.createElement('span') : null;
    if (slot !== null) {
      insert(slot, () => props['children']);
    }

    // One effect for the whole React tree: React's own unit of work is the
    // tree, so splitting the props across effects would only re-render it
    // several times for one change.
    bind(() => {
      const forwarded: Record<string, unknown> = {};
      for (const name of Object.keys(props)) {
        if (name === 'class' || name === 'host' || name === 'children') {
          continue;
        }
        forwarded[name] = props[name];
      }
      if (typeof props['class'] === 'string') {
        element.className = props['class'];
      }

      if (slot !== null) {
        forwarded['children'] = createElement(Adopted, { slot });
      }

      const element_ = createElement(Component_ as ComponentType<unknown>, forwarded);
      // Read inside the render effect, so a wrapper that reads a signal makes
      // every bridged root follow it.
      const wrap = wrapper.value;
      root?.render(wrap === null ? element_ : wrap(element_));
    });

    onCleanup(() => {
      // Asynchronously, because React refuses to unmount a root while it is
      // rendering — and a Firsthand disposal can happen inside an effect that a
      // React event handler started.
      const stopping = root;
      root = null;
      queueMicrotask(() => {
        stopping?.unmount();
      });
    });

    return element;
  };

  // React's own naming, in React's own order of preference. An anonymous
  // function has a `name` of '', which is not a useful element name.
  const label = Component_.displayName ?? (Component_.name === '' ? 'Anonymous' : Component_.name);

  return component<BridgeProps<P>>(setup, undefined, `firsthand/react:${label}`, `React(${label})`);
}

/**
 * The same thing without declaring a component first.
 *
 * ```tsx
 * <ReactHost component={Button} props={{ variant: 'contained' }} />
 * ```
 *
 * Useful when the component is chosen at runtime. It mounts a root per
 * instance either way, so prefer `fromReact` where you can.
 */
export const ReactHost = component<{
  readonly component: ComponentType<never>;
  readonly props?: Record<string, unknown>;
  readonly host?: keyof HTMLElementTagNameMap;
}>(
  (props): View => {
    const bridge = fromReact(props.component as ComponentType<object>, {
      ...(props.host === undefined ? {} : { host: props.host }),
    });
    return bridge({ ...props.props });
  },
  undefined,
  'firsthand/react:ReactHost',
  'ReactHost',
);
