# ADR-0019: Strict reactivity, paid for at build time

**Status:** accepted · 2026-09-20

## Problem

A setup function runs exactly once per instance. That is the model, and almost
everything good about the framework follows from it: no dependency arrays, no
stale closures, no `useMemo`, no hook order.

It also has one failure mode, and it is silent:

```tsx
const Widget = component<{ items: Item[] }>((props) => {
  const count = props.items.length; // read now, frozen now
  return <p>{count} items</p>; // and so this number never moves
});
```

Nothing throws. The number is right the first time and wrong afterwards, which
is the worst shape a bug can have. And the habit that produces it — read at the
top, use below — is correct in a framework that re-renders, where reading and
using are the same act because the body is re-entered. It is not a beginner's
mistake; it is a correct habit meeting a different model.

## Constraints

- **Production pays nothing.** The reactive read path is the hot path, it is
  measured (`bench:ic` checks that `.value` reads stay monomorphic), and a
  check on every read would cost a branch there for a mistake that can only
  happen during setup.
- **A check that is usually wrong is worse than no check.** Reading once is
  legal and often deliberate — the starting value of an editable field, or a
  decision about what to build. Reporting those unasked teaches people to
  ignore the report.
- The compiler exists, so anything it can decide should not be deferred to
  runtime.

## Options

1. **Documentation only.** Cheapest, and not enough: the guide can describe the
   mistake but cannot point at the line.
2. **A runtime check on every read, in production too.** Would catch
   everything, and would put a branch in the hottest path in the framework for
   a development concern. Rejected on the same grounds as every other
   "safety in production" feature here.
3. **Compile-time where possible, development-only runtime for the rest.**
4. **A type-level solution** — a branded type that cannot be assigned to a
   plain `number`. Would catch it at the keyboard with no runtime at all, and
   would change every prop and every signal read into something that no longer
   composes with ordinary code.

## Chosen design

Option 3, in two halves that are switched on separately.

**Build time.** `firsthand({ strictReactivity: true })` refuses to compile a
declaration in a component setup whose initialiser is _nothing but_ a read. The
error names the declaration and offers both ways out. The rule is narrow on
purpose, because a false positive stops a build:

- Reported: identifiers, member accesses, literals and the operators between
  them, where at least one member access is `props.x` or `x.value`. That is
  `const id = props.id`, `const total = count.value * 2`,
  `const cls = props.on ? 'a' : 'b'`.
- Not reported: anything containing a call. That single rule covers
  `signal(props.initial)`, `peek()`, `computed(…)`, every handler and
  `snapshot(…)` itself, without special-casing any of them by name.
- Not reported: a read inside a nested function, because those bodies run
  again.

**Development runtime.** `setStrictReactivity(true)` reports what the compiler
cannot follow — a read that leaves the module, `doSomething(props)` with the
access in another file. It hooks the one place a read finds no subscriber,
which is the existing `else` of the branch that links one, so no new branch is
added to the read path. It reports **once per read, not once per instance**,
keyed by the component's build id plus the position of the read within its
setup; a stack trace cannot do that, because three `<Label />` in one template
are three call sites for one mistake.

**`snapshot(read)`** is the escape hatch and, more importantly, the way to say
what you meant. It untracks exactly as `untrack` does. The difference is that
it is documented as intent, so both halves stay quiet inside it and the next
reader knows the frozen value was chosen.

**The compiler rule is on by default; the runtime report is not.** That split
is the second constraint applied where it actually bites. The compiler sees the
_shape_ of a declaration and reports only the one that is almost always wrong —
anything containing a call is left alone, which is most deliberate reads. The
runtime sees a read with nothing subscribing, and `signal(props.initial)` is
exactly that, so it would be wrong often enough to be ignored.

A check that is usually right can be on. One that is often wrong cannot.

## Performance implications

- **Build time**: one extra traversal of each component setup body, and only
  when the option is on.
- **Runtime, production**: nothing. The check lives in `dev.ts`, which the
  build aliases to a module of empty functions — verified: the shipped bundle
  contains neither the check nor its message. The read path keeps the single
  branch it already had.
- **Runtime, development**: a call per untracked read, a `Set` lookup on the
  ones inside a setup. Nothing that a development build notices.
- The public API is not free, because an exported function cannot be shaken out
  of a package's own bundle: `@firsthandjs/core` went from 2.29 kB to 2.36 kB
  gzip for `snapshot` plus the exported no-op, and the full runtime from
  5.86 kB to 5.87 kB.

## Memory implications

One `Set` of reported keys and one small stack of setup frames, both in the
development module only.

## DX implications

- The error and the warning both name a fix rather than only a problem.
- Two switches rather than one, which is the cost of one being a build setting
  and the other being something an application turns on where it configures
  development. They are documented together in both directions.
- `snapshot()` gives a name to something that previously had to be explained in
  a comment.

## Rejected alternatives

- **Both on by default**, which is where this ADR started for the compiler rule
  and stayed for the runtime one. The runtime check cannot distinguish
  `signal(props.initial)` from a mistake, so it would be noise in week one and
  ignored by week two.
- **Both off by default**, which is where the compiler rule started. It was
  changed after someone set up a new project, wrote `const x = v.value` in a
  setup, and got no error — the report that would have been most useful was the
  one nobody had turned on. The rule is narrow enough to be right almost every
  time it fires, and `strictReactivity: false` is there for a codebase that
  disagrees.
- **A warning instead of a build error at compile time.** A warning in a build
  log is read once. Where the compiler is sure — and the rule is narrow enough
  to be sure — refusing is more useful than mentioning.
- **Special-casing `signal(...)` as an allowed wrapper.** Unnecessary: "no
  calls" already covers it, and a list of blessed function names would have to
  grow forever.
- **Checking every read in production.** See constraint one.
