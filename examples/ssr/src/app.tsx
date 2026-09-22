/**
 * The whole application, rendered twice by the same code.
 *
 * Nothing here is written for a server or for a browser. It is the same
 * components, the same signals and the same resource; what differs is only
 * which compiler ran over the file and which runtime the calls landed in.
 *
 * Three things are worth watching, and the page says so itself:
 *
 * 1. **View source.** The notes are in the HTML. The list was produced by the
 *    same `useResource` the browser would have used, waited for by
 *    `renderToStringAsync`, and written into the markup.
 * 2. **The request count stays at zero.** The browser does not ask again,
 *    because the answer came with the page — the resource is `persist`ed under
 *    a name, and a name is what an answer needs to cross a wire.
 * 3. **The filter and the counters work immediately, and nothing flickers.**
 *    Hydration adopts every node the server sent; the only writes are the
 *    listeners.
 */
import { component, provide, signal } from '@firsthandjs/dom';
import { DataContext, useResource, type DataStore } from '@firsthandjs/data';
import { listNotes, type Note } from './api';

/** Filled in by the browser once hydration has finished. Unused on a server. */
export const hydratedIn = signal<number | null>(null);

const Notes = component(() => {
  const notes = useResource(({ signal: aborted }) => listNotes(aborted), {
    // The name under which the answer crosses the wire. Without it the server
    // would still render the list — it would just be loaded again in the
    // browser, because nothing would know that this resource is that answer.
    persist: 'notes',
  });
  const filter = signal('');
  const liked = signal<readonly number[]>([]);

  const like = (id: number): void => {
    liked.value = liked.value.includes(id)
      ? liked.value.filter((one) => one !== id)
      : [...liked.value, id];
  };

  return () => {
    const all = notes.data.value ?? [];
    const needle = filter.value.trim().toLowerCase();
    const shown = needle === '' ? all : all.filter((note) => matches(note, needle));

    if (notes.status.value === 'loading') {
      return <p class="empty">Loading…</p>;
    }

    return (
      <>
        <label class="filter">
          <span>Filter</span>
          <input
            value={filter.value}
            placeholder="model, compiler, ssr…"
            onInput={(event) => (filter.value = (event.target as HTMLInputElement).value)}
          />
        </label>

        <ul class="notes">
          {shown.map((note) => (
            <li key={note.id}>
              <h2>{note.title}</h2>
              <p>{note.body}</p>
              <footer>
                <span class="tag">{note.tag}</span>
                <button
                  class={liked.value.includes(note.id) ? 'liked' : ''}
                  onClick={() => like(note.id)}
                >
                  {liked.value.includes(note.id) ? 'Liked' : 'Like'}
                </button>
              </footer>
            </li>
          ))}
        </ul>

        {shown.length === 0 ? <p class="empty">Nothing matches “{filter.value}”.</p> : null}
      </>
    );
  };
});

function matches(note: Note, needle: string): boolean {
  return (
    note.title.toLowerCase().includes(needle) ||
    note.tag.toLowerCase().includes(needle) ||
    note.body.toLowerCase().includes(needle)
  );
}

/**
 * What the page says about itself.
 *
 * `hydratedIn` is written by the browser's entry point after `hydrate`
 * returns, so before that it is `null` — which is exactly what a server
 * renders, and exactly what the markup carries.
 */
const Status = component((props: { readonly requests: number }) => () => {
  const time = hydratedIn.value;
  return (
    <footer class="status">
      <span>
        Requests made by this process: <strong>{props.requests}</strong>
      </span>
      <span>{time === null ? 'Rendered on the server' : `Hydrated in ${time.toFixed(1)} ms`}</span>
    </footer>
  );
});

export const App = component((props: { readonly data: DataStore; readonly requests: number }) => {
  provide(DataContext, props.data);
  return (
    <main>
      <h1>Notes</h1>
      <p class="lead">
        This page arrived from the server with its content in it. View source, then use the filter —
        nothing was fetched again.
      </p>
      <Notes />
      <Status requests={props.requests} />
    </main>
  );
});
