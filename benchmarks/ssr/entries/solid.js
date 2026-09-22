/** Solid's server render. */
import { generateHydrationScript, renderToString } from 'solid-js/web';
import { Table } from '../app/solid.jsx';

export const render = (rows, selected) => renderToString(() => Table({ rows, selected }));

/**
 * The script Solid needs on the page before its own bundle runs.
 *
 * `hydrate` reads `globalThis._$HY`, which this sets up. A Solid application
 * puts it in the document head; the benchmark puts it in the same place.
 */
export const hydrationScript = () => generateHydrationScript();
