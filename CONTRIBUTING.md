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

If your change makes the code materially harder to read and the benchmark shows
no difference, it will be asked for revert. If it shows a difference, say how
much.

The measurement rules the project holds itself to are in
[`PERFORMANCE_PLAN.md`](PERFORMANCE_PLAN.md). They apply to contributors too.

### 3. Architecture decisions are written down

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

### 4. API growth needs a reason

`@firsthandjs/dom` exports 27 names, four of which are error classes — the full
list is in [`docs/reference/`](docs/reference/) — and the goal is to keep it
that size. If a problem
can be solved with ordinary JavaScript and DOM, it does not need an API. A
proposal that adds one should explain what cannot be expressed today.

## Making a change

1. Open an issue first for anything beyond a bug fix, so nobody writes a week of
   work that the design cannot absorb.
2. Branch, commit in logical steps, and write commit messages that say why.
3. Run the full gate locally:

   ```bash
   npm run format:check && npm run lint && npm run typecheck && npm run coverage && npm run build
   ```

4. Open the pull request. CI runs the same gate plus browser tests on Chromium,
   Firefox and WebKit, package export tests and a bundle size check.

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
