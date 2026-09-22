/** Firsthand's server render, and the rows every framework is given. */
import { renderToString } from '@firsthandjs/server';
import { createComponent } from '@firsthandjs/server/internal';
import { Table } from '../app/firsthand.js';
import { makeRows, type Row } from '../app/rows.js';

export const rows = (count: number): Row[] => makeRows(count);

export const render = (list: readonly Row[], selected: number): string =>
  renderToString(() => createComponent(Table as never, { rows: list, selected }));
