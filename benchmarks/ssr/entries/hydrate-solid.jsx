/** Solid taking over markup it was given. */
import { hydrate } from 'solid-js/web';
import { Table } from '../app/solid.jsx';

export const start = (container, rows, selected) =>
  hydrate(() => Table({ rows, selected }), container);
