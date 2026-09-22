/**
 * What the browser runs, once.
 *
 * `hydrate` instead of `render`, and a storage seeded from what the server put
 * in the page. That is the whole difference — the view is the same view, and
 * this file never mentions the fact that it was rendered somewhere else.
 */
import { hydrate } from '@firsthandjs/dom/hydrate';
import { createData, createMemoryStorage } from '@firsthandjs/data';
import { App, hydratedIn } from './app';
import { requests } from './api';

declare global {
  interface Window {
    __FIRSTHAND_DATA__?: Record<string, unknown>;
  }
}

/*
 * The answers the server produced, read back before anything renders. A named
 * resource finds its value here during its first run, so the first thing the
 * browser does with the list is recognise the one already on the page.
 */
const data = createData({ storage: createMemoryStorage(window.__FIRSTHAND_DATA__ ?? {}) });

const started = performance.now();
hydrate(
  () => <App data={data} requests={requests.length} />,
  document.getElementById('app') as HTMLElement,
);
// Written after hydration rather than during it, so that what the server
// rendered and what the browser adopted are the same markup. The status line
// is a part, so it updates itself.
hydratedIn.value = performance.now() - started;
