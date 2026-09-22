/**
 * A pretend database, with a pretend network in front of it.
 *
 * On the server this is a local call with a delay; in the browser it would be
 * a `fetch`. The point of the example is that the browser never makes it: the
 * answer arrives with the page.
 */

export type Note = {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly tag: string;
};

const NOTES: readonly Note[] = [
  {
    id: 1,
    title: 'Setup runs once',
    body: 'A component is a function that runs one time per instance. What it returns is wired up, not re-run.',
    tag: 'model',
  },
  {
    id: 2,
    title: 'Parts, not diffs',
    body: 'Each dynamic position is its own subscription. A change wakes the positions that read it and nothing else.',
    tag: 'model',
  },
  {
    id: 3,
    title: 'The compiler writes the templates',
    body: 'Static markup is parsed once into a <template> and cloned. A server writes the same shape as a string.',
    tag: 'compiler',
  },
  {
    id: 4,
    title: 'Hydration adopts',
    body: 'The browser takes the nodes the server sent instead of building its own. Nothing is parsed twice.',
    tag: 'ssr',
  },
  {
    id: 5,
    title: 'Data has names, resources do not',
    body: 'A resource belongs to its call site. A named one has somewhere to be put, which is how it crosses the wire.',
    tag: 'ssr',
  },
];

/** Every request this process has answered. The page shows the count. */
export const requests: string[] = [];

export async function listNotes(signal?: AbortSignal): Promise<readonly Note[]> {
  requests.push('listNotes');
  await delay(120, signal);
  return NOTES;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });
}
