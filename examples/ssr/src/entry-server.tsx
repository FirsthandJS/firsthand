/**
 * What the server runs, once per request.
 *
 * Everything is per request: the storage, the data store, the owner the render
 * creates and disposes. Nothing is shared between two visitors, which is the
 * only rule server rendering really has.
 */
import { renderToStringAsync } from '@firsthandjs/server';
import { createData, createMemoryStorage, serialize } from '@firsthandjs/data';
import { App } from './app';
import { requests } from './api';

export type Rendered = {
  /** The markup for the element the browser hydrates. */
  readonly html: string;
  /** A `<script>` carrying the answers this render produced. */
  readonly state: string;
};

export async function render(): Promise<Rendered> {
  const storage = createMemoryStorage();
  const data = createData({ storage });

  const html = await renderToStringAsync(() => <App data={data} requests={requests.length} />, {
    // Two things have to happen before the markup is worth sending: the
    // loaders have to answer, and the view has to be rendered again with
    // the answers in hand. This is the first of them; the second is done
    // for us, once per pass.
    settle: () => data.settle(),
    // And a loader that never answers must not hold the response open.
    timeout: 2_000,
  });

  return {
    html,
    state: `<script>window.__FIRSTHAND_DATA__ = ${serialize(storage.dump())}</script>`,
  };
}
