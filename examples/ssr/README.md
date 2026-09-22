# Server rendering and hydration

A page that arrives with its content in it, and a browser that takes what it
was given instead of building it again.

```bash
npm install                 # from the repository root
npm run build               # build the packages this imports
cd examples/ssr
npm run dev                 # http://localhost:5174
```

For the production shape — two builds and a server that reads them off disk:

```bash
npm run build && npm start
```

## What to look at

**View source.** The notes are in the HTML. They were produced by the same
`useResource` the browser would have used, waited for by
`renderToStringAsync`, and written into the markup.

**The request count.** The page shows how many requests the process it was
rendered by has answered. It says 1 — the one that produced this page. The
browser adds none: the answer came with it, under the name the resource was
given.

**The comments.** `<!--[-->` marks where a dynamic child begins. It is how
hydration knows which nodes belong to which part; the browser removes them all
once it has adopted the tree. They are in the server's markup only — a build
without a server emits neither them nor the navigation that steps over them.

**The nodes.** `tests/browser/ssr.spec.ts` opens this page in Chromium,
Firefox and WebKit with a `MutationObserver` installed before any script it
carries, and asserts that **not one element the server sent is replaced**.

## How it is put together

| File                   | What it is                                                              |
| ---------------------- | ----------------------------------------------------------------------- |
| `src/app.tsx`          | The application. Nothing in it is written for a server or for a browser |
| `src/entry-server.tsx` | One render per request: its own storage, its own store, disposed        |
| `src/entry-client.tsx` | `hydrate` instead of `render`, over a storage seeded from the page      |
| `vite.config.ts`       | One plugin. `hydratable: true` is the only thing the project declares   |
| `server.mjs`           | `node:http` and Vite. There is nothing here a framework would do        |

The compiler is not configured for the two builds separately: Vite tells the
transform which build it is running, and the plugin compiles against
`@firsthandjs/server/internal` for one and `@firsthandjs/dom/internal` for the
other. The source is the same source.

## What crosses the wire

A resource belongs to its call site, so it has no name to be serialised under
(ADR-0022). A **named** one does:

```tsx
const notes = useResource(({ signal }) => listNotes(signal), { persist: 'notes' });
```

`persist` is the name. The server render fills a `createMemoryStorage()` under
it, `storage.dump()` goes into the page, and the browser starts from
`createMemoryStorage(window.__FIRSTHAND_DATA__)` — where the resource finds its
value during its first run, which is what makes the first paint the markup
rather than a spinner replacing it.

A resource without a name still renders on the server. It just arrives in the
browser unanswered, because there is nothing to put it under. That is a
decision the call site makes, in one word, and can see.
