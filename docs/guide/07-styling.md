# Styling

[Index](../README.md) · Previous: [Events and forms](06-events-and-forms.md) ·
Next: [Routing](08-routing.md)

---

## Plain CSS first

A stylesheet and a `class` attribute need nothing from the framework and cost
nothing:

```tsx
import './button.css';

<button class="button primary" />;
```

`class` accepts a string or a record, and the record form toggles only what
changed:

```tsx
<button class={{ button: true, primary: isPrimary.value, busy: saving.value }} />
```

`style` accepts a string or a record, and a record may hold custom properties:

```tsx
<div style={{ '--accent': hue.value, opacity: fading.value ? '0.5' : '1' }} />
```

Setting a custom property is often the cheapest possible style update: one
write, no class change, no new rule.

## @firsthandjs/styled

When you want the styles next to the component:

```bash
npm install @firsthandjs/styled
```

```tsx
import { styled, css, keyframes, createGlobalStyle, ThemeContext } from '@firsthandjs/styled';

const Button = styled.button<{ $primary?: boolean }>`
  padding: 0.5rem 1rem;
  border: 1px solid ${(props) => props.theme.line};
  background: ${(props) => (props.$primary === true ? 'rebeccapurple' : 'transparent')};

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

It is styled-components' API. What differs is what a prop change costs.

### Values become custom properties

The template is read **once, when you write it**, and each interpolation is
classified by where it sits:

| Where it sits                          | Becomes               | A change costs    |
| -------------------------------------- | --------------------- | ----------------- |
| A declaration's value — `color: ${…};` | A CSS custom property | one `setProperty` |
| Anywhere else — a whole block          | Part of the class     | a class swap      |

So this produces **one** rule for a thousand rows with a thousand colours:

```tsx
const Row = styled.div<{ $hue: number }>`
  color: hsl(${(props) => props.$hue} 70% 50%);
`;
```

styled-components inserts a rule per distinct value, because it cannot tell
that case apart. The reasoning is in
[ADR-0015](../adr/0015-styling-with-custom-properties.md).

### Blocks still work

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

### Which props reach the element

A prop reaches the element if the element has it: `disabled` does, `primary`
does not. `data-*`, `aria-*`, `role`, `style` and event handlers are forwarded;
a `$`-prefixed prop never is.

```tsx
<Button $primary disabled data-role="save" onClick={save} />
```

### Nesting

`&:hover`, `@media`, `& > li` — native CSS nesting, resolved by the browser.
There is no preprocessor in the package, which is most of why it is 1.97 kB
rather than 13.

### Theme

```tsx
const theme = signal({ line: '#d8d8e0' });
provide(ThemeContext, theme);
```

A theme swap is one signal write, and it updates the custom properties that
read the theme — not the components, and not rules that never mentioned it.
`useTheme()` reads it directly.

**Give it a type once**, and every interpolation is typed:

```ts
export interface AppTheme {
  readonly background: string;
  readonly text: string;
}

// The empty import matters: a file may only augment a module it imports.
import type {} from '@firsthandjs/styled';

declare module '@firsthandjs/styled' {
  interface FirsthandTheme extends AppTheme {}
}
```

```tsx
const Page = styled.div`
  background: ${(props) => props.theme.background}; // typed;
`.backgrund` does not compile
`;
```

A project that declares nothing keeps `props.theme['background']`, so this
costs nothing to ignore.

**MUI, and other React libraries, need their own provider.** Each bridged
component is its own React root, so a React `ThemeProvider` cannot reach them
from outside; `setReactWrapper` puts one around every root. See
[React interop](11-react-interop.md#one-theme-for-both-halves).

### Wrapping a component, and restyling a styled one

```tsx
const FancyLink = styled(Link)`
  color: rebeccapurple;
`;
```

The wrapped component receives the class as a `class` prop and must put it on
its root — the same contract styled-components has with `className`. Every
interpolation resolves into the class there, because the element belongs to
that component; pass anything per-instance as a custom property through
`style`.

A styled component can be styled again, as deep as you like:

```tsx
const Panel = styled.section`
  background: ${(props) => props.theme.surface};
  padding: 1rem;
`;

const AccentPanel = styled(Panel)`
  border-left: 4px solid ${(props) => props.theme.accent};
  padding: 1.25rem; // wins
`;
```

Both classes land on the element, and **the outer declaration wins** — by
specificity, not by rule order: each wrapping level repeats its own class in
the selector (`.a`, then `.b.b`). Rule order could not decide it, because a
component with a block interpolation inserts its rule when it first renders,
and a wrapper renders before what it wraps. The theme reaches every level.

### Global styles and keyframes

```tsx
const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const GlobalStyle = createGlobalStyle`
  body { background: ${(props) => props.theme.background}; }
`;

// Mount it once, anywhere under the theme.
<GlobalStyle />;
```

A global rule lives as long as the component that attached it, and two
components attaching the same one share it until the last leaves.

## Shadow DOM

A component with `{ shadow: true }` gets a shadow root, and styles in the
document do not reach inside it. Put a `<style>` in the component, or use
constructable stylesheets:

```tsx
const Widget = component(
  () => {
    return (
      <>
        <style>{`.box { padding: 1rem; }`}</style>
        <div class="box">Encapsulated</div>
      </>
    );
  },
  { shadow: true },
);
```

`@firsthandjs/styled` writes into the document's head, so its rules do **not**
reach into a shadow root. That is a real limitation, and the reason light DOM
is the default ([ADR-0007](../adr/0007-light-dom-default.md)).

## Which to use

| Situation                               | Use                                        |
| --------------------------------------- | ------------------------------------------ |
| A design system you already have as CSS | `class` and a stylesheet                   |
| Styles that belong with one component   | `@firsthandjs/styled`                      |
| A value that changes per instance       | A custom property, either way              |
| A component library                     | See [Web components](10-web-components.md) |

---

Next: [Routing](08-routing.md).
