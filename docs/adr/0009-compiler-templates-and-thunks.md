# ADR-0009: Cloned templates plus thunk-compiled dynamic parts

Status: accepted (Phase 1)

## Problem

TSX must support arbitrary JavaScript expressions, yet must not produce a
virtual DOM tree. The compiler has to turn markup into DOM creation code and
expressions into targeted updates, without the runtime having to discover at
runtime what is static and what is dynamic.

## Constraints

- Static markup created once, cloned per instance.
- Dynamic expressions must become specialised parts: text, attribute, property,
  boolean, class, style, event, child, branch, list, component.
- The compiler may not assume it can tell whether an expression is reactive:
  `{f(x)}` may read a signal three calls deep.
- No temporary render objects.

## Options considered

1. **Runtime JSX factory** (`jsx()` returning descriptor objects). This is a
   virtual DOM by another name: one object per element per evaluation.
2. **Full static analysis of reactivity.** The compiler decides which
   expressions are reactive and emits effects only there. Unsound in general —
   reactivity can hide behind any function call — and unsoundness here means
   silently missing updates.
3. **Templates + thunks with runtime auto-detection.** Static markup becomes an
   HTML string parsed once into `<template>`. Every dynamic expression is
   emitted as a thunk (`() => expr`). The runtime evaluates the thunk inside a
   tracking scope on first run: if nothing was read, the value is written once
   and no effect is retained; if something was read, a minimal effect bound to
   that part's specialised setter is kept.

## Chosen design

Option 3. The compile-time work is structural (what kind of part, where in the
cloned tree, which setter), and the reactivity decision is made by observation,
which is always correct.

```tsx
<div class="row">Hello {name.value}</div>
```

becomes, in shape:

```ts
const _t = template('<div class="row">Hello <!>');
const _r = _t(),
  _n = _r.firstChild.lastChild;
insertText(_n, () => name.value);
```

Node lookup uses compile-time child-index paths, never `querySelector` and never
runtime marker scanning.

A runtime-only JSX path (`jsx-runtime`) exists for unconfigured environments and
for tooling; it produces the same parts through the same protocol, is slower,
and warns once in dev. Its output is semantically identical — there is no
"benchmark mode" and no "compiled mode" difference in behaviour.

## Performance implications

- Instance creation is a template clone plus a fixed number of pointer walks,
  instead of n element creations and an interpretation pass.
- Static subtrees cost exactly one clone and no ongoing subscriptions.
- Static-looking dynamic expressions (`class={"row"}`) retain no effect at all,
  because the auto-detection observes zero reads.
- The thunk itself is one closure per dynamic part per instance. That is the
  price of soundness; it is measured, and constant-folding of literal
  expressions at compile time removes it where it is provably unnecessary.

## Memory implications

One `<template>` per distinct markup shape per module (shared by all instances).
Per instance: the cloned nodes, one closure and one effect per genuinely
reactive part, and nothing for static parts.

## DX implications

- Arbitrary JavaScript in TSX works, including calls into helpers.
- No special "reactive expression" syntax to learn and no directives.
- The one rule to know is the same one as everywhere else in Firsthand: the part
  re-evaluates when something it _read_ changes.

## Rejected alternatives

Runtime JSX factories (VDOM allocation), full static reactivity analysis
(unsound; silent missed updates are the worst possible failure mode).
