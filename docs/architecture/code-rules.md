# Code rules

Every rule on this page is **checked by a tool**. A principle that only lives in
a review comment gets applied on the days people have time for it, and the code
drifts on the days they do not. So each principle below is followed by the
mechanism that fails the build when it is broken, and by the escape hatch — if
there is one — together with what a reviewer must see before accepting it.

Run them all:

```bash
npm run lint            # the metric and import rules
npm run check:arch      # layering, cycles, module surface, aliases
npm run check           # everything, the way CI runs it
```

## 1. The five SOLID principles

Robert C. Martin's five, in the order the acronym gives them. Each one is
stated for a language with modules and structural typing, because that is the
language this codebase is written in — "class" is rarely the interesting unit
here, "module" almost always is.

### S — Single responsibility

_A module has one reason to change._ Not "does one thing": the test is about
who asks for the change. If the list reconciler changes when the scheduler's
semantics change **and** when the keying strategy changes, those are two
reasons and two modules.

Size is not the principle, but it is the only honest proxy a linter can
compute, and a module that outgrows the limit has almost always collected a
second reason on the way.

| Rule                     | Limit                                      | Where                            |
| ------------------------ | ------------------------------------------ | -------------------------------- |
| `max-lines`              | 300 statements per module (src)            | `eslint.config.js`               |
| `max-lines`              | 400 statements per module (test)           | `eslint.config.js`               |
| `max-lines-per-function` | 50 statements (src), 120 (test)            | `eslint.config.js`               |
| `max-statements`         | 30 per function                            | `eslint.config.js`               |
| module surface           | ≤ 12 exports outside a barrel (`index.ts`) | `scripts/check-architecture.mjs` |

All four line counts **skip blank lines and comments**. That is deliberate and
it matters here: this codebase explains its reasoning in prose above the code,
and a limit that counted those lines would be a limit on explanation. Delete a
comment to get under a limit and you have broken the rule, not kept it.

### O — Open/closed

_Open for extension, closed for modification._ Adding a case must not mean
editing a function that already knows all the other cases.

This is the one principle with no honest linter check — every mechanical proxy
for it (ban `switch`, ban `else if`) produces more false positives than
findings. What a tool _can_ catch is the symptom, because a function that is
repeatedly modified to admit one more case grows a branch each time:

| Rule         | Limit                    | Where              |
| ------------ | ------------------------ | ------------------ |
| `complexity` | 12 branches per function | `eslint.config.js` |
| `max-depth`  | 4 nested blocks          | `eslint.config.js` |

When a dispatch really is open-ended, the codebase uses a **table**, not a
chain: `packages/dom/src/attributes.ts` maps a name to a writer, and adding an
attribute adds a row. Prefer that shape wherever the set is expected to grow.

Where a conditional is closed by nature — three kinds of `typeof`, the four
node types the platform defines — a chain is correct and the limit is generous
enough for it.

### L — Liskov substitution

_A value of a subtype is usable wherever the supertype is._ In a structurally
typed language most violations are caught by the compiler; the ones that are
not are the ones where the type says more than it means.

| Rule                                        | Effect                                                 |
| ------------------------------------------- | ------------------------------------------------------ |
| `strict`, `noImplicitOverride`              | an override must say so — `tsconfig.base.json`         |
| `exactOptionalPropertyTypes`                | `{ a?: T }` never silently admits `undefined`          |
| `noUncheckedIndexedAccess`                  | an index read is `T \| undefined` and gets checked     |
| `@typescript-eslint/no-explicit-any`        | `unknown` with narrowing, never an unchecked `any`     |
| `@typescript-eslint/method-signature-style` | properties, so parameters are checked bivariantly-free |

The narrowing that `any` skips is the whole of LSP in a structural language:
`any` is the one type that is substitutable for everything and honours nothing.

### I — Interface segregation

_Nobody depends on a member they do not use._ A package's export list **is** its
interface, and every name on it is a promise to the next version.

| Rule                                      | Limit                              | Where                            |
| ----------------------------------------- | ---------------------------------- | -------------------------------- |
| module surface                            | ≤ 12 exports outside a barrel      | `scripts/check-architecture.mjs` |
| `max-params`                              | 4 parameters                       | `eslint.config.js`               |
| `@typescript-eslint/no-empty-object-type` | no `interface X {}` placeholders   | `eslint.config.js`               |
| public API growth                         | an export needs a reason in the PR | `CONTRIBUTING.md` §4             |

`internal.ts` exists in `@firsthandjs/dom` and `@firsthandjs/server` for exactly
this reason: the compiler needs a wider surface than an application does, so it
gets its own, and the application's stays small.

### D — Dependency inversion

_A policy does not import a detail._ Enforced here as **layering**, because in a
monorepo the layer is the unit that either holds or does not:

```
core        → nothing (must load without a DOM)
dom         → core
server      → core
jsx-runtime → core, dom
compiler    → nothing at runtime (build-time only)
router, data, styled, react, i18n, deep → the runtime, never each other
```

| Rule                    | Effect                                            |
| ----------------------- | ------------------------------------------------- |
| `no-restricted-imports` | per-package allow-lists — `eslint.config.js`      |
| `no-restricted-globals` | `document`/`window` are unreachable from `core`   |
| `check:no-deps`         | no production dependency in any published package |
| `check:arch`            | no import cycle, between packages or inside one   |

The adapter packages are the principle applied on purpose: `@firsthandjs/data`
defines the client interface, and `data-axios`, `data-urql` and `data-apollo`
implement it without `data` knowing any of them exist (ADR-0022).

## 2. Clean-code rules with teeth

The ones from _Clean Code_ that survive contact with a linter. The rest of that
book is taste, and taste belongs in review.

| Rule                                | Limit / effect                                |
| ----------------------------------- | --------------------------------------------- |
| `max-params`                        | 4 — beyond that, pass an object               |
| `max-depth`                         | 4 — extract, or return early                  |
| `max-nested-callbacks`              | 3                                             |
| `complexity`                        | 12                                            |
| `no-param-reassign`                 | a parameter names an argument, not a variable |
| `prefer-const`, `no-var`            | a binding that never changes says so          |
| `eqeqeq`                            | `==` only against `null`                      |
| `no-console`                        | `warn`/`error` only, and not in the hot path  |
| `no-else-return`                    | the early return is the shorter read          |
| `@typescript-eslint/no-unused-vars` | `_`-prefixed is the only way to keep one      |

### Magic values

Named, not inlined. The reactive flags in `packages/core/src/flags.ts` are the
pattern: a module of named bits, imported by everything that tests them, so
`flags & STALE` reads as the sentence it is. There is no linter for this;
`flags.ts` is what a reviewer will point at.

### Comments

This project wants more of them than most, and different ones. A comment that
restates the code is noise and will be removed in review. A comment that says
**why** — which alternative was measured and lost, which platform behaviour is
being matched, which ADR this implements — is the most valuable line in the
file and is never counted against a size limit.

## 3. Imports are absolute

**`../` is banned. `@/` is the only way out of a directory.**

```ts
import { Cell } from '@/graph/cell.js'; // ✅ from anywhere in the package
import { STALE } from './flags.js'; //     ✅ same directory
import { Cell } from '../graph/cell.js'; // ❌ error
```

`@/` means _this package's `src/`_, and nothing else. It never crosses a package
boundary: `@firsthandjs/core` is how the DOM layer reaches the core, and the
layering rules above decide whether it may.

| Rule                     | Effect                                                                            |
| ------------------------ | --------------------------------------------------------------------------------- |
| `no-restricted-imports`  | `../*` and `../../*` fail the lint — `eslint.config.js`                           |
| `paths` in each tsconfig | `@/*` → `./src/*`, so the compiler and the editor agree                           |
| `firsthandAlias` plugin  | resolution for Vitest and for esbuild — one implementation in `scripts/alias.mjs` |
| declaration rewrite      | `@/` is rewritten to a relative path in the emitted `.d.ts` — `scripts/build.mjs` |

That last row is the price of the rule and it is worth stating plainly: a
published `.d.ts` cannot contain `@/`, because a consumer has no such alias. The
build rewrites every one of them back to a relative specifier after `tsc` runs,
and `npm run test:exports` type-checks the published surface from outside the
repo, so a rewrite that got it wrong fails the release rather than the user.

### Why absolute

A relative path encodes where the importer happens to sit today. Moving a file
then edits every line that mentioned it, a diff that hides the one change that
mattered — and `../../../` stops being readable at about two levels. `@/` is
stable under every move within the package, which is what makes the module
splits on this page cheap to do again next year.

## 4. Where the limits came from

They are not folklore. Each was set to the smallest round number that the
codebase could reach **without deleting a comment or inlining a helper that
earns its name**, measured over the tree at the time the rules landed:

| Limit               | Value | Files over it when the rule landed |
| ------------------- | ----- | ---------------------------------- |
| module statements   | 300   | 6                                  |
| function statements | 50    | 31                                 |
| complexity          | 12    | 15                                 |
| parameters          | 4     | 7                                  |
| statements/function | 30    | 7                                  |

All of them were refactored, none were exempted. That is the standard for
changing a number on this page too: a limit moves when the code cannot meet it
for a reason someone can write down, not when a change is inconvenient.

## 5. The escape hatch, and its price

`eslint-disable-next-line` is allowed **only** with a reason on the line above
and only for these three cases:

1. **A measured hot path.** The disable cites the benchmark and the number. The
   `Link` constructor in `packages/core/src/graph/link.ts` is the standing
   example: five parameters, because it is allocated once per dependency edge
   and an options object allocates a second time (ADR-0002).
2. **A platform shape.** `declare global { namespace JSX }` is the only way to
   say what TSX accepts.
3. **A generated or vendored file**, which should be in `ignores` instead.

Anything else is a refactor that has not been done yet. `scripts/check-architecture.mjs`
counts the disables and prints them, so the number is visible rather than
discovered.

## 6. What the limits cost

Not nothing, and the number belongs here rather than in somebody's memory.

**Module boundaries are free.** `scripts/build.mjs` bundles each package with
esbuild, so a cross-module call inside a package is concatenated away before it
ships. Splitting a file costs nothing at runtime, which is what makes the
splits on this page safe to do.

**Extracted functions are not free.** esbuild's minifier does not inline, so
every function pulled out of another is a function object in the bundle.
Bringing `packages/dom` under the function and complexity limits cost
**0.25 kB gzip** — measured by building the same tree twice with only
`packages/dom/src` and its tests moving, everything else held constant:

| Build                             | full runtime (core + dom) |
| --------------------------------- | ------------------------- |
| `packages/dom` as on `main`       | 7.22 kB gzip              |
| the refactor                      | 7.47 kB gzip              |
| the budget in `scripts/build.mjs` | 7.50 kB gzip              |

That is 3 % of the runtime for the readability of the twelve functions that
were over the limits. The class split in §7 spent most of what that left, so
the headroom is now **5 bytes** — measured with `scripts/build.mjs`, which is
the instrument the budget is defined in, across four trees in one setup:

| Commit                          | minified |        gzip |
| ------------------------------- | -------: | ----------: |
| `13fe49e`, before async owners  | 20,733 B |     7,673 B |
| `0e1d758`, after them (#60)     | 20,737 B |     7,667 B |
| `a0b8a72`, after the fix (#59)  | 20,737 B |     7,667 B |
| `4bd8df8`, after the spread fix | 20,741 B | **7,675 B** |

The last row is the one place this budget has been spent on something other
than readability. A spread could write any attribute name it was handed, so a
dictionary an application did not write — a database row, a query string —
could put `onmouseover` into the markup, and the browser ran it. Refusing the
name costs eight gzip bytes, and the alternative was raising the budget, which
would have spent the README's claim on a bug. The refusal reuses the branch
that already read `on`, so what it added is the `i` flag and one call.

Four bytes of new code that gzip happens to encode six bytes smaller, and a
compiler-only change that moves nothing — which is what the third row is for.
A figure from any other setup is a figure about that setup: a probe that
aliases a package to its source measures a bundle this one never ships, and
the two differ here by 69 bytes at the same commit. The next change to the browser runtime will have to find room,
and the honest place to find it is here: a disable under §5 on the specific
functions that pay for it, with the number. Raising the budget quietly is the
one answer that is not allowed, because the budget is the claim the README
makes.

### Measuring this correctly

A trap worth writing down, because it cost two red CI runs. These numbers come
from the `full runtime` entry, which is the only one that _bundles_
`@firsthandjs/core` rather than marking it external — so it resolves
`@firsthandjs/core` through `node_modules`. In a `git worktree` whose
`node_modules` was linked to another checkout's, that resolves to **the other
checkout's packages**, and every full-runtime figure is measured against
somebody else's working tree. Every per-package figure is right, which is what
makes it hard to notice: only the one number that matters is wrong.

Run `npm ci` in the worktree. If a local build and CI disagree on the full
runtime and agree on everything else, this is why.

## 7. The file that used to be the exception

`packages/core/src/core.ts` held 714 lines and 18 exports, and an earlier
version of this page argued that it had to: the graph, the scheduler and the
owner tree share mutable state, a module cannot assign a binding it imported,
and putting a property load or a call in front of `Cell.value` — the hottest
read in the framework — was not something to do on an argument.

That was right about the risk and wrong about the conclusion, and the thing
that settled it was measuring rather than reasoning.

**What actually blocked the split was smaller than it looked.** Two facts the
code already had:

- nothing in `core.ts` constructs a `Cell`. `signal`, `computed`, `effect` and
  `context` do, so `core.ts` needs the type and not the value — a type-only
  import, which is erased.
- `Cell` only _reads_ `activeSub`. The writers are `evaluate`, `runEffect` and
  `untrack`, all of which stayed behind.

So `Link` and `Cell` moved to `link.ts` and `cell.ts`, the runtime edges are
`core → link` and `cell → core`, and there is no cycle.

**And the read costs nothing**, which is the part that had to be measured:

| Evidence                                  | Before       | After        |
| ----------------------------------------- | ------------ | ------------ |
| `bench:ic`, mixed cells against one shape | 1.02×        | 1.02×        |
| full runtime, minified                    | 20,729 bytes | 20,733 bytes |
| full runtime, gzip                        | 7,647 bytes  | 7,673 bytes  |

esbuild concatenates a package before it ships, so the getter that read a
module-local `activeSub` now reads a bundle-local one — the built output is the
same shape, a plain variable read, which is why the inline caches do not
notice. Four bytes of new code, and the rest of the gzip difference is the
compressor seeing a slightly different arrangement of the same text.

What it did cost is headroom: the full runtime went to **7 bytes** under the
7.50 kB budget §6 measures against, where it had 33. The async-owner work that
followed encoded six bytes smaller despite adding four, and the spread fix
after it spent eight, which is how the figure in §6 reads 5 rather than 7 — a
reminder that these are gzip bytes, and that four bytes of source can move the
total either way. That budget is a
line somebody has to move deliberately, so the next change to core has to
either find those bytes or argue for the number — which is the point of having
it.

Both numbers are prose, written by hand: `check:readme` governs the README and
the reference pages, and nothing regenerates this file. A change that moves the
runtime has to come back and correct them — and measure them with
`npm run build`, not with a probe of its own, because two size numbers in two
days have drifted and both drifted through a setup nobody had isolated.

**Thirteen bytes is the room there is.** Read that before starting a change to
`core` or `dom`, not after CI has told you: the next addition of any size will
exceed it, and §6 says what the answer then is.

`core.ts` is still the largest file in the repository and still over the line
limit, because the algorithm that remains is one algorithm. What it is no
longer is the data structures as well.

## See also

- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — coverage, benchmarks, ADRs
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — what the layers are
- [`../adr/`](../adr/) — why each layer is shaped that way
