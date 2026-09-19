# js-framework-benchmark integration

A reproducible implementation of Stefan Krause's
[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
keyed case.

## The rule this directory exists to keep

The row component, the keyed list and every operation come from
[`../app/table.tsx`](../app/table.tsx) — the same file, imported unchanged, that
the repository's own benchmark uses. Only the page around it is written here,
because the upstream harness dictates the buttons and their ids.

`npm run check:benchmark-shared` fails the build if either entry point grows its
own copy of the rows, so the two benchmarks cannot quietly drift into measuring
different implementations.

There is no benchmark-only runtime, no hardcoded handling of known test cases,
and no semantic difference between what is measured here and what an
application gets.

## Running it

```bash
# in a checkout of js-framework-benchmark
cp -r /path/to/firsthand/benchmarks/js-framework-benchmark frameworks/keyed/firsthand
cd frameworks/keyed/firsthand
npm install
npm run build-prod
cd ../../..
npm run bench -- keyed/firsthand keyed/react
npm run results
```

The upstream harness measures in its own way — its own driver, its own
warmup policy, its own statistics. That independence is the point: it is a
check on this repository's own numbers, not a repetition of them.

## Status

Not yet submitted upstream. The implementation is here and buildable; the
independent run has not been performed, and no number from it is quoted
anywhere in this repository.
