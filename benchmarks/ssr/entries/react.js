/** React's server render. */
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { Table } from '../app/react.jsx';

export const render = (rows, selected) => renderToString(createElement(Table, { rows, selected }));
