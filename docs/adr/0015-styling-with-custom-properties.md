# ADR-0015: CSS-in-JS where a prop change is a custom property, not a class

Status: **accepted** (2026-09-19)

## Problem

Applications want styled-components: styles next to the component, props
feeding them, a theme, nesting, no class-name bookkeeping. The API is one
people know, and there is no reason to invent a different one.

The implementation cannot be copied, though, because the model underneath is
different. styled-components resolves its template **during a render**: props
in, CSS text out, hashed, inserted, class swapped. A framework whose components
run once has no render to do that in — and, more interestingly, does not need
one.

## Constraints

- The API must be styled-components': `styled.button`, `styled(Component)`,
  `css`, `keyframes`, `createGlobalStyle`, a theme, and `$`-transient props.
- A prop change must update styles without re-running the component.
- Nesting (`&:hover`, `@media`) must work, because a library that cannot
  express a hover state is not a styling library.
- No React, and small enough that using it is not a decision.
- A list of a thousand rows with a value each must not produce a thousand
  rules.

## Options considered

1. **Port styled-components' model.** Resolve everything per instance per
   change, hash, insert a class. Correct, familiar, and it puts a rule in the
   sheet for every distinct prop value — the known failure mode of CSS-in-JS at
   scale, and one this framework's whole design is about avoiding.
2. **Compile styles away.** A build step that extracts every template into a
   static sheet, as Linaria and vanilla-extract do. The smallest possible
   runtime, and it forbids what people actually write: a value computed at
   runtime, a theme read from a signal, a colour from data.
3. **Custom properties for values, classes for blocks.** Chosen.

## Chosen design

A template is read **once, when it is written**, not per instance. Each
interpolation is classified by _where it sits_, which is a property of the
template and not of any prop value:

- Inside a declaration's value — `color: ${…};` — it becomes a CSS custom
  property. The component has one class, shared by every instance, and a change
  is `element.style.setProperty('--s1a2-0', next)`.
- Anywhere else — a whole declaration block, usually behind a condition — it is
  resolved per instance and the result's own hash names a class, exactly as
  styled-components does. Two instances that resolve the same way share the
  rule.

The classification is a scan backwards from the interpolation to the last `;`,
`{` or `}`: a colon in between means we are in a value. That is decidable from
the template alone, so it happens once.

Nesting is **native CSS nesting**. There is no preprocessor: the rule text goes
into the sheet as written, and the browser resolves `&`. Every browser this
project supports has had it since 2023.

Prop forwarding asks the element: `name in element` is true for `disabled` and
false for `primary`. styled-components answers the same question with a bundled
list of every valid HTML attribute.

The theme is an ordinary context holding an object, so a theme swap is one
signal write, and only the custom properties that read the theme change.

## Performance implications

- One rule per component, not per prop value, whenever the interpolation is in
  a value position. Measured in the unit tests as one rule for a thousand
  instances with a thousand different hues, and again in a real browser in
  `integrations/interop` as one rule for five swatches.
- A style change is one `setProperty` call: no rule insertion, no class swap,
  no selector matching beyond what the element already had.
- 1.97 kB gzip, against styled-components v6's 13.03 kB with React already
  excluded. Both measured by bundling the package with its peers external; the
  command is in the styled README.
- The cost is one extra indirection in the cascade: `color: var(--x)` instead
  of `color: red`. Custom-property resolution is not free, but it is done by
  the style engine rather than by JavaScript, and it replaces inserting a rule.

## Memory implications

- One compiled template per styled component, holding literal chunks and slot
  descriptors — allocated once, at module scope.
- The stylesheet is append-only for scoped rules, keyed by hash, so a rule is
  inserted at most once however many components resolve to it.
- Global rules are reference-counted: two components attaching the same global
  style keep it until the last one leaves. Nothing else is ever removed, which
  is correct — a class that was used once may be used again, and the text is
  bytes.

## DX implications

- The API is the one people already know, including transient props.
- `styled(Component)` requires the wrapped component to put its `class` prop on
  its root. styled-components has the same requirement with `className`.
- An interpolation that returns a block from a _value_ position is the one way
  to write something this cannot express; it produces an invalid custom
  property rather than an error. Documented, and the shape is unusual.
- No autoprefixing and no `&` rewriting means one less thing between what you
  wrote and what the browser got.

## Rejected alternatives

- **A rule per prop value** (option 1): the thing this framework exists to
  avoid, in the one place it is most visible.
- **Build-time extraction** (option 2): the right answer for a design system
  with no runtime inputs, and the wrong one for an application whose colours
  come from data.
- **Shipping a preprocessor.** Stylis is larger than this entire package, and
  everything it does that still matters, the browser now does.
- **`.attrs()` and `shouldForwardProp`.** Both exist in styled-components to
  work around prop forwarding being a guess. Asking the element is not a guess.

## Update, after using it

**Restyling needed a rule about who wins.** `styled(Panel)` puts both classes
on the element, and two single-class rules of equal specificity are decided by
which reached the stylesheet last — an order this package cannot control, since
a component with a block interpolation inserts its rule when it first renders
and a wrapper renders before what it wraps. Each wrapping level now repeats its
own class in the selector (`.a`, then `.b.b`), so the outer declaration wins by
specificity, whatever the order. The cost is a longer selector and 0.06 kB.

Two defects went with it: `styled(styled(X))` threw, because `class` was
defined twice on the forwarded props object; and a wrapper's class never
reached the element when it changed, because it was handed over as a string
captured once rather than as something the wrapped component could observe.
Transient (`$`) props are now forwarded to a wrapped component too — they are
stripped at an element, where they would be invalid attributes, but the thing
being wrapped may be a styled component that declares them.

**A theme can be typed.** `FirsthandTheme` is an empty interface in the entry
module; an application augments it and `props.theme.background` is typed. It
had to be declared in the entry module rather than re-exported from `theme.ts`,
because `declare module '@firsthandjs/styled'` merges with interfaces declared
there — and `ThemeContext` had to be annotated rather than inferred, or the
declaration file would freeze `Theme` as the empty-theme branch and the
augmentation would change nothing.
