# ADR-0004: Component identity from symbols and build ids, not `Function.name`

Status: accepted (Phase 1)

## Problem

Components are declared as `const Counter = component(fn)` and used as
`<Counter initial={10} />`. The developer must never repeat a name string, yet
the framework needs a stable identity for: custom element tag names, devtools
display, hot reload, and error messages. `Function.name` is unreliable because
minifiers rewrite it.

## Constraints

- No `component("Counter", fn)` and no `define("counter", fn)` in user code.
- TSX must reference real JavaScript bindings, not name attributes.
- Tag names must be valid custom element names, stable across builds, and unique
  within a page that may contain several versions of several packages.
- Must work when the compiler is not used (plain runtime JSX), with a documented
  degradation.

## Options considered

1. **`Function.name`.** Works in development, breaks under minification, and
   collides between packages.
2. **Runtime counter** (`firsthand-c17`). Stable within a session, unstable across
   builds and across load order — unusable for SSR hydration or for a public
   element name.
3. **Compiler-assigned stable id.** The transform assigns each `component(...)`
   call site an id derived from the package name, the module path relative to
   the package root and the declaration's binding name, hashed to a short
   suffix. The original identifier is kept as a separate, dev-only display name.
4. **Developer-supplied string.** Explicitly forbidden by the requirements.

## Chosen design

Option 3, with option 2 as an explicitly degraded fallback when the compiler is
absent.

```ts
// authored
export const UserCard = component(fn);
// emitted
export const UserCard = component(fn, undefined, 'acme/card/UserCard#a3f91c', 'UserCard');
```

- Identity used by the framework internally is the component object itself
  (reference equality), never the name.
- `defineElement` derives `acme-user-card` from the display name and falls back
  to the hash suffix on collision.
- The display name is behind a dev-only flag and is dropped by the production
  build, so it costs no bytes in production.

## Performance implications

None at runtime: identity comparisons are reference comparisons. Tag derivation
happens once per component type, not per instance.

## Memory implications

Two extra string references per component _type_ (not per instance), one of
which is removed in production builds.

## DX implications

- The developer writes the binding once and uses the symbol everywhere.
- DevTools and error messages show `UserCard`, not `t`, even in production
  builds of applications that keep the dev flag on.
- Without the compiler, tag names and error messages degrade to generated ids;
  this is documented, and the runtime warns once in dev.

## Rejected alternatives

`Function.name` (minification), runtime counters (build instability),
developer-supplied strings (forbidden requirement, and a repetition the design
is explicitly trying to remove).
