# ADR-0007: Light DOM by default, Shadow DOM opt-in

Status: accepted (Phase 1), default to be re-validated with Phase 10 numbers

## Problem

Shadow DOM must be supported. Whether it is the default must be decided on
measured performance and interop grounds and documented.

## Constraints

- Style encapsulation is valuable but not free.
- Applications overwhelmingly use global stylesheets, utility CSS and
  design-system selectors that stop at a shadow boundary.
- Shadow roots only exist on element hosts, and hosts are opt-in (ADR-0003).
- Mass-mount scenarios must not pay per-instance encapsulation cost.

## Options considered

1. **Shadow DOM always.** Strong encapsulation, forces every component to carry
   its own styles, breaks global CSS, adds a root per instance, and requires an
   element host for every component — which ADR-0003 rejected on cost.
2. **Light DOM always.** No encapsulation option at all; fails an explicit
   requirement.
3. **Light DOM default, `{ shadow: true }` opt-in on components that have an
   element host.**

## Chosen design

Option 3. `component(fn, { tag: true, shadow: true })` attaches a shadow root
and adopts the component type's constructable stylesheet. Styling across the
boundary uses CSS custom properties and `::part`. Stylesheets are constructed
once per component type and shared via `adoptedStyleSheets`, never re-parsed per
instance.

## Performance implications

- Per-instance: a shadow root is an extra tree for style resolution and
  composition. Measured in Phase 10 as mount cost with and without shadow at 1k
  and 10k instances.
- Constructable stylesheets avoid the historic per-instance `<style>` parse,
  which is the dominant cost in naive shadow DOM usage.
- Light DOM lets the document's existing style resolution handle everything with
  no additional scopes.

## Memory implications

One shadow root plus one style scope per shadowed instance; one
`CSSStyleSheet` per component type regardless of instance count.

## DX implications

- Default: components compose with the application's existing CSS, which is what
  most teams want and what makes incremental adoption possible.
- Opt-in: teams publishing reusable widgets get real encapsulation on the
  components where it matters.
- The trade-off is documented in the README's Shadow DOM section, including the
  fact that light DOM offers no style isolation.

## Rejected alternatives

Shadow-always (cost, global CSS breakage, forces element hosts everywhere),
light-only (fails the requirement).
