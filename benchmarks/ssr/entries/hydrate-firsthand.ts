/** Firsthand taking over markup it was given. */
import { createComponent } from '@firsthandjs/dom';
import { hydrate } from '@firsthandjs/dom/hydrate';
import { Table } from '../app/firsthand.js';
import type { Row } from '../app/rows.js';

export const start = (
  container: HTMLElement,
  rows: readonly Row[],
  selected: number,
): (() => void) => hydrate(() => createComponent(Table as never, { rows, selected }), container);
