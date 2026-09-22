# Contributing to Firsthand

Thanks for considering it. This document is short on ceremony and specific about
the two things this project is strict about: **measurements** and **coverage**.

## Getting set up

```bash
npm install
npm run typecheck
npm test
npm run coverage
```

Node 20.11 or newer. There are no production dependencies and there never will
be without an ADR explaining why.

## The rules that are not negotiable

### 1. Coverage is 100 %, and it is not theatre

Statements, branches, functions and lines are all at 100 % for every package —
`core`, `dom`, `jsx-runtime`, `compiler`, `router`, `query`, `styled`, `react`
and `testing` — and CI fails below that.

`/* istanbul ignore */`, `/* c8 ignore */` and equivalents are **not** accepted
to reach the number. If a branch cannot be triggered, the right fix is to delete
the branch, not to hide it. Two legitimate exclusions exist and are listed with
reasons in `vitest.config.ts`: the production stub for the dev-diagnostics
module, and type-only modules that emit no JavaScript.

Coverage alone is not enough, and the project has the evidence: mutation
testing found five places where code could be deleted without a single test
noticing, in a suite that was already at 100 %. `npm run test:mutation` runs it
over the reactive core and fails below 88 % — the threshold has headroom
because timeout classification moves the score about a point between runs on
identical code. Read the survivors rather than the
number — `docs/architecture/mutation-testing.md` explains which ones are worth
killing and which are equivalent.

A pull request that adds behaviour adds tests for the behaviour, including the
awkward cases: nested effects, dynamic dependency sets, disposal, branch
switching, duplicate keys, context through portals.

Public API changes also need **type-level tests** (`npm run test:types`,
`*.test-d.ts`). Those assert what a runtime test cannot: that a computed has no
setter, that a `Context<Theme>` cannot stand in for a `Context<User>`, that
props are readonly all the way down. Writing them has already caught a real
inference bug in `provide`.

### 2. Performance claims need data

No number goes into the README, a comment or a commit message without a result
file behind it. If you optimise something, the pull request includes the before
and after from `npm run bench`, produced on the same machine in the same run.

The harness is `npm run bench` (against React), `bench:micro` (element host and
event delegation), `bench:profile` (allocation), `bench:reconcilers`,
`bench:ic` (whether `.value` reads stay monomorphic), and
`BENCH_SCALE=heavy npm run bench` for the 100 000-row set.

CI does not benchmark every pull request: a shared runner's numbers are too
noisy to gate on, and the job is slow enough to delay the checks that do gate.
Add the **`benchmark`** label to a pull request to run it there, or use the
weekly run and `workflow_dispatch`.

If your change makes the code materially harder to read and the benchmark shows
no difference, it will be asked for revert. If it shows a difference, say how
much.

The measurement rules the project holds itself to are in
[`PERFORMANCE_PLAN.md`](PERFORMANCE_PLAN.md). They apply to contributors too.

### 3. The shape of the code is a build failure, not an opinion

Module size, function size, complexity, parameter count and the direction of
every import are **numbers a tool checks**. They are in
[`docs/architecture/code-rules.md`](docs/architecture/code-rules.md) together
with the mechanism that enforces each one and the reasoning behind the number.

```bash
npm run lint         # the metric and import rules
npm run check:arch   # layering, cycles, module surface, aliases
```

Two things catch people out. `../` is banned inside a package — `@/` means that
package's `src/`, and the ban applies wherever `@/` has a meaning, which is not
`benchmarks/` or `scripts/`. And the line counts skip blank lines and comments
on purpose: this codebase explains its reasoning in prose, so deleting a
comment to get under a limit is breaking the rule rather than keeping it.

`eslint-disable` is accepted for four things, each needing a written reason — a
measured hot path, a compiler-emitted protocol signature, a platform shape, or
generated code. `npm run check:arch` prints the running total, so the number is
visible rather than discovered. One file does not meet the rules at all;
[§7](docs/architecture/code-rules.md) says which and why.

### 4. Architecture decisions are written down

If your change alters the reactive graph, scheduling, ownership, props, context,
portals, DOM parts, list reconciliation, compiler output, the element adapter or
memory management, add or update an ADR in [`docs/adr/`](docs/adr/) using the
same sections as the existing ones:

```
Problem / Constraints / Options considered / Chosen design /
Performance implications / Memory implications / DX implications /
Rejected alternatives
```

"Because it is simpler" is not an accepted justification where performance or
semantics are affected. It is a perfectly good one elsewhere.

### 5. API growth needs a reason

`@firsthandjs/dom` exports 27 names, four of which are error classes — the full
list is in [`docs/reference/`](docs/reference/) — and the goal is to keep it
that size. If a problem
can be solved with ordinary JavaScript and DOM, it does not need an API. A
proposal that adds one should explain what cannot be expressed today.

## Branches

`main` is protected by a repository ruleset, not by convention. Nobody pushes to
it — not a maintainer, not an administrator, not a bot. What the ruleset
enforces:

| Rule                     | Effect                                                               |
| ------------------------ | -------------------------------------------------------------------- |
| Pull request required    | No direct pushes to `main`, no exceptions and no bypass list         |
| Status checks required   | The gate, mutation testing, three browsers, both integrations, green |
| Up to date with `main`   | A branch must be rebased on current `main` before it can merge       |
| Threads resolved         | Every review comment answered before merge                           |
| Linear history           | Squash or rebase; no merge commits                                   |
| No force push, no delete | `main` cannot be rewritten or removed                                |

Branch names are enforced too — `type/short-description`, lower case, where the
type is one of:

```
feat/     a capability that did not exist
fix/      a defect, with the test that would have caught it
perf/     a measured improvement, with before and after
refactor/ same behaviour, better shape
test/     tests only
docs/     documentation only
ci/       workflows, gates, tooling
deps/     dependency updates
chore/    everything else
release/  a version bump
```

A branch with any other name is rejected at push time, and `dependabot/*` is the
only exception, because Dependabot picks its own.

## Making a change

1. Open an issue first for anything beyond a bug fix, so nobody writes a week of
   work that the design cannot absorb.
2. Branch from `main` with a name from the list above, and commit in logical
   steps with messages that say why.
3. Run the full gate locally, because CI runs exactly the same thing and finding
   out here is faster:

   ```bash
   npm run check
   ```

4. Open the pull request. CI runs the gate plus mutation testing, browser tests
   on Chromium, Firefox and WebKit, and both integrations. All of them have to
   pass before the merge button does anything.
5. Squash or rebase when merging. The history on `main` is linear on purpose:
   one commit per change, and `git log --oneline` reads as a changelog.

## Code style

- Strict TypeScript. No `any` in public or central internal APIs — use `unknown`
  and narrow.
- Comments explain _why_, and specifically why an obvious alternative was not
  used. Code that is doing something unusual for a measured reason says so and
  names the measurement.
- The graph code in `packages/core/src/core.ts` is written as flat pointer walks
  on purpose (ADR-0002). Please do not "clean it up" into iterator pipelines
  without a benchmark.

## Releases

Releases are cut by maintainers through the release workflow, which publishes to
npm with provenance over OIDC. Contributors do not need to touch versions;
changelog entries under `## [Unreleased]` are welcome.
