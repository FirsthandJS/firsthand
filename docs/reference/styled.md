# @firsthandjs/styled

[Reference index](../README.md#reference) · 2.05 kB gzip · depends on
`@firsthandjs/dom`

Styled components, compiled once per template rather than once per instance.
Guide: [Styling](../guide/07-styling.md).

---

## styled

```ts
const styled: {
  [T in keyof JSX.IntrinsicElements]: StyledFactory<ElementProps<T>>;
} & (<P>(base: Component<P>) => StyledFactory<P>);

interface StyledFactory<Base> {
  <P = unknown>(
    strings: TemplateStringsArray,
    ...values: Interpolation<P & Base>[]
  ): Component<P & Base>;
}

type StyledProps<P> = P & { readonly theme: Theme };
type Interpolation<P> = string | number | CssFragment | ((props: StyledProps<P>) => unknown);
type ElementProps<T extends string> = T extends keyof JSX.IntrinsicElements
  ? JSX.IntrinsicElements[T]
  : Record<string, unknown>;
```

```tsx
const Button = styled.button<{ $primary?: boolean }>`
  padding: 0.5rem 1rem;
  color: ${(props) => (props.$primary === true ? props.theme.onPrimary : props.theme.text)};
  &:hover {
    filter: brightness(1.1);
  }
`;
```

`P` defaults to `unknown` rather than `{}`, because an empty record's index
signature would type every other prop — `children` included — as `never`.

**Two kinds of interpolation.** One that produces a _value_ becomes a CSS
custom property: one rule serves every instance and an update writes one
property on one element. One that produces a _block_ (a `css` fragment, or
several declarations) becomes part of the class, and a distinct result gets its
own class. Native CSS nesting is used as written; nothing is flattened.

**Prop forwarding**: a prop is written to the element when it exists on the
element, or is `data-*`, `aria-*` or an event. `children`, `class` and any
`$`-prefixed prop are not. styled-components ships a list of every HTML
attribute to answer this question; the element already knows.

`styled(Component)` wraps any component, including a React one bridged by
[`@firsthandjs/react`](react.md), and a styled component can be styled again. A
wrapped component has no element to carry custom properties, so every
interpolation resolves into the class.

**Restyling wins on specificity.** Each wrapping level repeats its own class in
the selector — `.a`, then `.b.b`, then `.c.c.c` — so the outer declaration
beats the inner one whatever order the rules reached the stylesheet in. Rule
order could not decide it: a component with a block interpolation inserts its
rule when it first renders, and a wrapper renders before what it wraps.

## css

```ts
function css(strings: TemplateStringsArray, ...values: unknown[]): CssFragment;
function isFragment(value: unknown): value is CssFragment;

interface CssFragment {
  readonly strings: TemplateStringsArray;
  readonly values: readonly unknown[];
}
```

A reusable chunk. Interpolate it into a styled component, or return it from an
interpolation function to add a whole block conditionally.

## Themes

```ts
interface FirsthandTheme {} // empty; an application declares its own
type Theme = [keyof FirsthandTheme] extends [never]
  ? Readonly<Record<string, unknown>>
  : Readonly<FirsthandTheme>;

const ThemeContext: Context<Theme>; // defaults to an empty theme
function useTheme(): ReadonlyCell<Theme>;
```

Declare the theme once and every interpolation is typed:

```ts
// The empty import matters: a file may only augment a module it imports.
import type {} from '@firsthandjs/styled';

declare module '@firsthandjs/styled' {
  interface FirsthandTheme {
    background: string;
    text: string;
  }
}
```

A project that declares nothing keeps the indexed form.

```tsx
provide(ThemeContext, signal({ text: '#111', onPrimary: '#fff' }));
```

Every interpolation function is given `props.theme`, so components rarely call
`useTheme` themselves.

## Global styles and keyframes

```ts
function createGlobalStyle(
  strings: TemplateStringsArray,
  ...values: Interpolation<unknown>[]
): Component<Record<string, never>>;

function keyframes(strings: TemplateStringsArray, ...values: unknown[]): string;
```

A global style is attached while the component is mounted and replaced when the
theme changes. Two instances of the same global style share one rule, which is
refcounted: the rule is removed when the last one unmounts, not the first.

`keyframes` returns the generated animation name and cannot interpolate
functions — an animation has no props to read.

## The sheet

```ts
function hash(text: string): string;
function resetStyles(): void;
```

`resetStyles()` drops every rule this package inserted. It is for tests, so
that one test's classes cannot be seen by the next; calling it in an
application removes the styles of everything currently mounted.

`hash` is the same function used to name classes, exported so a test can assert
a class name without hard-coding it.
