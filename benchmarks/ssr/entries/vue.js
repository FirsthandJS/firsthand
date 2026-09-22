/** Vue's server render. */
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { Table } from '../app/vue.js';

export const render = (rows, selected) => renderToString(createSSRApp(Table, { rows, selected }));
