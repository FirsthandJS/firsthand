---
name: solid-clean-code
description: The SOLID and clean-code rules this repository enforces, with the exact limits, the tool that checks each one, and what to do when a limit is hit. Use when writing or changing any file under packages/, when a lint run reports max-lines, max-lines-per-function, complexity, max-params, max-depth or no-restricted-imports, when splitting a module, or when deciding where a new function belongs.
---

# SOLID and clean code in this repository

Every rule here is enforced by a tool. If you are about to write code that
breaks one, refactor instead of disabling — the escape hatch at the bottom is
narrower than it looks. The full reasoning, and where each limit came from, is
in [`docs/architecture/code-rules.md`](../../../docs/architecture/code-rules.md).

## The hard limits

Check them before you finish, not after:

```bash
npm run lint && npm run check:arch
```

| Limit                              | src   | test  | Rule                      |
| ---------------------------------- | ----- | ----- | ------------------------- |
| Statements per module              | 300   | 400   | `max-lines`               |
| Statements per function            | 50    | 120   | `max-lines-per-function`  |
| Statements per function (count)    | 30    | off   | `max-statements`          |
| Cyclomatic complexity              | 12    | off   | `complexity`              |
| Parameters                         | 4     | 4     | `max-params`              |
| Block nesting                      | 4     | 4     | `max-depth`               |
| Nested callbacks                   | 3     | 5     | `max-nested-callbacks`    |
| Exports per non-barrel module      | 12    | —     | `check:arch`              |

**All line counts skip blank lines and comments.** Never delete a comment to
get under a limit — this codebase explains its reasoning in prose, and the
limits were chosen so that explanation is free. If a file is over, it has too
much *code*, and the fix is a split.

## Imports

`../` is banned. Out of a directory, use `@/`, which means this package's
`src/`. Same directory keeps `./`. Always with the `.js` extension.

```ts
import { STALE } from './flags.js'; //       ✅ same directory
import { Cell } from '@/graph/cell.js'; //   ✅ anywhere in this package
import { Cell } from '../graph/cell.js'; //  ❌ lint error
import { effect } from '@firsthandjs/core'; // ✅ another package, if the layer allows
```

The layers, from `eslint.config.js` — a package may import downward, never
sideways or up:

```
core        → nothing at all (and no `document`, no `window`)
dom         → core
server      → core
jsx-runtime → core, dom
compiler    → nothing (build-time only; it must not import the runtime)
router, data, styled, react, i18n, deep → the runtime, never each other
```

## Applying SOLID here

**S — one reason to change.** Before adding to a module, ask who would ask for
this change. A different asker means a different module. When you split, split
by asker, not by size: `graph/`, `owner/`, `schedule/` are three reasons;
`core-part-1.ts` and `core-part-2.ts` are one reason cut in half, which is
worse than leaving it alone.

**O — extend without editing.** When a dispatch is expected to grow, write a
table and add a row — `packages/dom/src/attributes.ts` is the pattern. A
`switch` is fine when the set is closed by the platform (three `typeof` cases,
four node types).

**L — say what you mean in the types.** `unknown` plus narrowing, never `any`.
Let `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` do their work
rather than asserting past them.

**I — the export list is the interface.** A new export is a promise to the next
version and needs a reason in the PR (`CONTRIBUTING.md` §4). If the compiler
needs a wider surface than an application does, it gets its own entry point —
that is what `internal.ts` is for.

**D — a policy does not import a detail.** `@firsthandjs/data` defines the
client interface; `data-axios`, `data-urql` and `data-apollo` implement it and
`data` knows none of them (ADR-0022). Follow that shape for anything pluggable.

## When you hit a limit

| Symptom                          | Do this                                                          |
| -------------------------------- | ---------------------------------------------------------------- |
| `max-lines`                      | Split by reason-to-change into a directory, re-export from a barrel |
| `max-lines-per-function`         | Extract the cold branches; leave the hot path inline               |
| `complexity` / `max-depth`       | Return early, or replace the chain with a table                    |
| `max-params`                     | Group into an options object — unless it allocates in a hot path   |
| `max-statements`                 | Usually two functions wearing one name                             |
| ≤ 12 exports                     | The module has two jobs, or a name should be internal              |

### Splitting a file without breaking this project

Two things are non-negotiable here and a careless split breaks both:

1. **Coverage stays at 100 %** on statements, branches, functions and lines,
   and `c8 ignore` is not accepted. A split that strands an unreachable branch
   fails the gate — delete the branch instead of hiding it.
2. **Performance claims need data** (`CONTRIBUTING.md` §2). Module boundaries
   are free after bundling — esbuild concatenates a package into one file, so
   a cross-module call inside a package is not an indirection. Extracting a
   *function* out of a hot path is not free. If you touch the reactive graph,
   `insert`, `list` or hydration, run `npm run bench` before and after and put
   both numbers in the commit message.

## The escape hatch

`eslint-disable-next-line` needs a reason on the line above and is accepted for
exactly three things:

1. **A measured hot path**, citing the benchmark and the number. The `Link`
   constructor's five parameters are the standing example: one allocation per
   dependency edge, and an options object would be a second (ADR-0002).
2. **A platform shape**, such as `declare global { namespace JSX }`.
3. **Generated or vendored code**, which belongs in `ignores` instead.

Anything else is a refactor you have not done. `npm run check:arch` prints the
running total of disables, so the number is visible rather than discovered.
