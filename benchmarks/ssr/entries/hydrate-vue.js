/** Vue taking over markup it was given: `createSSRApp().mount()` hydrates. */
import { createSSRApp } from 'vue';
import { Table } from '../app/vue.js';

export const start = (container, rows, selected) => {
  const app = createSSRApp(Table, { rows, selected });
  app.mount(container);
  return () => app.unmount();
};
