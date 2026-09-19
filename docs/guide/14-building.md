# Building and deploying

[Index](../README.md) · Previous: [Performance](13-performance.md)

---

## What the compiler does

`@firsthandjs/compiler` is a Babel plugin, run by a bundler plugin, at build time
only. It turns TSX into DOM instructions:

```tsx
<p class="row">
  <button onClick={increment}>{count.value}</button>
</p>
```

```js
const _tmpl$1 = template('<p class="row"><button><!></button></p>');

const _el$ = _tmpl$1(); // clone a <template>
const _el$1 = _el$.firstChild; // child-index navigation, no querySelector
on(_el$1, 'click', increment); // delegated listener
insert(_el$1, () => count.value, _el$2); // one reactive text part
```

Static markup is hoisted into one `<template>` per shape and cloned per
instance; only the dynamic parts become subscriptions. The plugin never decides
_statically_ whether an expression is reactive — that question is undecidable,
and being wrong means missed updates — so it wraps expressions and the runtime
keeps an effect only if the thunk actually read something
([ADR-0009](../adr/0009-compiler-templates-and-thunks.md)).

## Bundlers

```ts
// Vite (7 and 8), Rollup
import { firsthand } from '@firsthandjs/compiler/vite';
plugins: [firsthand({ packageName: 'my-app' })];
```

The plugin is `enforce: 'pre'`, so it sees each `.tsx`/`.jsx` before the
bundler's TypeScript step and leaves no JSX behind. Nothing else needs
configuring.

For a bundler without a Rollup-compatible plugin API, call the transform
yourself:

```ts
import { transform } from '@firsthandjs/compiler';

const out = transform(code, { filename, typescript: true, packageName: 'my-app' });
```

Or use it as a Babel plugin directly — `@firsthandjs/compiler`'s default export is
one.

### esbuild and SWC

Neither can host the transform, because it is a Babel plugin. Run it as a
pre-step (Vite does exactly this) or use the runtime JSX fallback, which is
correct but does not hoist templates.

## Code splitting

Route-level splitting is the router's `lazy`:

```ts
{ path: 'reports', lazy: () => import('./reports.js') }
```

Anything else is an ordinary dynamic import; there is nothing framework-shaped
about it. `<Link preload>` warms a route's chunk on hover.

## Tree shaking

Every package is `sideEffects: false` and ships ES modules, so a bundler drops
what you do not import. Two examples that matter:

- importing only `@firsthandjs/dom` leaves the router, the cache and the styling
  package out entirely;
- using the `.gql` loader makes `parseGraphQL` unreachable, which is 1.1 kB of
  the query package.

## What to serve

A built application is static files. Two rules:

**SPA fallback.** The router owns paths the file system knows nothing about, so
unknown paths must return the application's document. One line in most hosts:

```nginx
location / { try_files $uri $uri/ /index.html; }
```

```
# netlify.toml / _redirects
/*  /index.html  200
```

`createHashHistory()` is the way out where that is impossible.

**Cache the hashed assets, not the document.** `index.html` should be
revalidated; the hashed JS and CSS can be cached for a year.

## Browser support

Modern evergreen browsers: Chromium, Firefox, WebKit. The framework relies on
`<template>`, `composedPath()`, custom elements, ES2022 and ES modules;
`@firsthandjs/styled` additionally relies on native CSS nesting. No polyfills are
shipped and none are planned.

If you must support older browsers, transpiling the output is your call, but
the platform features above are not polyfillable in any way worth having.

## Server-side rendering

Not implemented. There is no `renderToString`, no hydration and no streaming.
This is stated as a limitation rather than a plan: a serious implementation
changes the compiler, the runtime and the router at once.

What works today: serving a static document and mounting on the client, which
is what every example here does.

## Publishing a library built with Firsthand

- Ship ES modules, `sideEffects: false`.
- Put `@firsthandjs/dom` in `peerDependencies`, so an application has one copy.
- Compile your TSX before publishing — consumers should not need the compiler
  to use your package.
- If your components are for consumers outside this framework, publish them as
  [custom elements](10-web-components.md).

---

Back to the [index](../README.md).
