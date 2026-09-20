# @firsthandjs/styled

styled-components' API, on a framework that renders once.

**Documentation:** [guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/07-styling.md) · [API reference](https://github.com/firsthandjs/firsthand/blob/main/docs/reference/styled.md) · [all docs](https://github.com/firsthandjs/firsthand/blob/main/docs/README.md)

```
npm install @firsthandjs/styled
```

2.02 kB gzip, against styled-components v6's 13.03 kB with React already
external — both measured the same way, by bundling the package with its peers
excluded. It needs no React, and no preprocessor.

```tsx
import { styled, css, ThemeContext } from '@firsthandjs/styled';

const Button = styled.button<{ $primary?: boolean }>`
  padding: 0.5rem 1rem;
  border: 1px solid ${(props) => props.theme.line};
  background: ${(props) => (props.$primary === true ? 'rebeccapurple' : 'transparent')};
  border-radius: 4px;

  &:hover {
    filter: brightness(1.15);
  }

  @media (min-width: 40rem) {
    padding: 0.5rem 1.5rem;
  }
`;

<Button $primary onClick={save}>
  Save
</Button>;
```

## What is different, and why it is faster

styled-components has one mechanism: resolve the template against the props,
hash the result, insert a class, put it on the element. Every distinct prop
value is a new rule. A table with a colour per row produces a rule per row.

Here, the template is read **once, when you write it**, and each interpolation
is classified by where it sits:

| Where it sits                           | What it becomes       | What a change costs       |
| --------------------------------------- | --------------------- | ------------------------- |
| A declaration's value — `color: ${…};`  | A CSS custom property | One `setProperty`         |
| Anywhere else — `${(p) => p.x && css…}` | Part of the class     | A class swap, rule reused |

So this:

```tsx
const Row = styled.div<{ $hue: number }>`
  color: hsl(${(props) => props.$hue} 70% 50%);
`;
```

produces **one** rule for a thousand rows with a thousand different hues. The
test suite asserts exactly that, and the browser check in
[`integrations/interop`](../../integrations/interop) asserts it again on a real
page.

Blocks still work the way you expect, because nothing else can express them:

```tsx
const Button = styled.button<{ $on?: boolean }>`
  padding: 1rem;
  ${(props) =>
    props.$on === true &&
    css`
      background: purple;
      color: white;
    `}
`;
```

Two instances that resolve the same way share one rule, and switching back to a
resolution already in the sheet reuses it.

## Nesting

`&:hover`, `@media`, `& > li` — all of it is **native CSS nesting**, which
every browser this framework supports has. There is no preprocessor in this
package, which is most of why it is 2.02 kB rather than 13.

## Props

A prop reaches the element if the element has it: `disabled` does, `primary`
does not. `data-*`, `aria-*`, `role`, `style` and event handlers are forwarded
too, and a `$`-prefixed prop never is — styled-components' transient-prop
convention, and the reason it exists.

```tsx
<Button $primary disabled data-role="save" onClick={save} />
// disabled, data-role and the handler land on the <button>; $primary does not.
```

styled-components answers this question with a list of every valid HTML
attribute. The element already knows.

## Theme

```tsx
const theme = signal({ line: '#d8d8e0' });
provide(ThemeContext, theme); // a cell, so it can be swapped

const Panel = styled.section`
  border: 1px solid ${(props) => props.theme.line};
`;
```

A theme swap is one signal write. It updates the custom properties that read
the theme — not the components, and not the rules that never mentioned it.
`useTheme()` reads it directly.

## The rest of the API

```tsx
const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const GlobalStyle = createGlobalStyle`
  body { background: ${(props) => props.theme.background}; }
`;

const Fancy = styled(Link)`
  color: rebeccapurple;
`;
```

`styled(Component)` hands the class to the component as a `class` prop, and the
component is responsible for putting it on its root — the same contract
styled-components has with `className`. Every interpolation resolves into the
class there, because the element belongs to that component and there is nothing
to set a custom property on.

## Deliberately missing

- **`.attrs()`** — write the default in the component instead.
- **`shouldForwardProp`** — the `$` convention and "does the element have it"
  cover the cases it exists for.
- **A preprocessor.** No autoprefixing, no `&` rewriting: the browser does
  nesting, and prefixes are for browsers this framework does not support.
- **SSR collection.** There is no server rendering to collect for.

## Restyling, and a typed theme

A styled component can be styled again, to any depth. Both classes land on the
element and the **outer** declaration wins — each level repeats its class in
the selector, so specificity decides rather than which rule reached the sheet
first.

```tsx
const Panel = styled.section`
  padding: 1rem;
`;
const AccentPanel = styled(Panel)`
  padding: 1.25rem;
`; // wins
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
