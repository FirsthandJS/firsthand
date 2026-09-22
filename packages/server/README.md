# @firsthandjs/server

Server rendering for Firsthand: the same components, rendered to markup.

**Documentation:** [guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/17-server-rendering.md) · [API reference](https://github.com/firsthandjs/firsthand/blob/main/docs/reference/server.md) · [ADR-0027](https://github.com/firsthandjs/firsthand/blob/main/docs/adr/0027-server-rendering-and-hydration.md)

```
npm install @firsthandjs/server
```

1.17 kB gzip, on a server, so it is not part of any browser's download. It
depends on `@firsthandjs/core` and never touches a `document`.

```tsx
import { renderToString } from '@firsthandjs/server';

const html = renderToString(() => <App />);
```

The application is the application. Nothing in it is written for a server:
`App` is the same file the browser renders, compiled a second time against a
runtime that builds a string instead of a tree. Vite already knows which build
it is running, so the project configures nothing beyond saying that it
hydrates:

```ts
firsthand({ hydratable: true });
```

## With data

```tsx
const storage = createMemoryStorage();
const data = createData({ storage });

const html = await renderToStringAsync(() => <App data={data} />, {
  settle: () => data.settle(),
  timeout: 2_000,
});
```

`storage.dump()` goes into the page, and a browser that starts from it finds
every named resource already answered — during its first run, not a microtask
later, which is what makes the first paint the markup rather than a spinner
replacing it.

## In the browser

```tsx
import { hydrate } from '@firsthandjs/dom/hydrate';

hydrate(() => <App data={data} />, document.getElementById('app')!);
```

Every element the server sent is adopted rather than built. The only writes are
the listeners and the properties markup cannot express — which
`tests/browser/ssr.spec.ts` asserts in Chromium, Firefox and WebKit with a
`MutationObserver` installed before any script the page carries.

## Measured

1 000 rows, production builds on every side, output compared before anything is
timed (`node benchmarks/ssr/run.mjs`):

|                  | Firsthand    | Solid     | Vue       | React     |
| ---------------- | ------------ | --------- | --------- | --------- |
| render to markup | **0.171 ms** | 0.205 ms  | 15.02 ms  | 199.67 ms |
| markup size      | 222 802 B    | 238 694 B | 222 802 B | 222 802 B |
| hydrate          | **4.12 ms**  | 4.62 ms   | 10.48 ms  | —         |

A complete example — application, two entry points, and a server in eighty
lines of `node:http` — is in
[`examples/ssr`](https://github.com/firsthandjs/firsthand/tree/main/examples/ssr).
