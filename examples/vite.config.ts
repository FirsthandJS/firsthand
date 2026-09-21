import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { firsthand } from '@firsthandjs/compiler/vite';

const page = (name: string): string => resolve(import.meta.dirname, name, 'index.html');

export default defineConfig({
  // The Firsthand transform runs before Vite's TypeScript step: it parses the
  // annotations and leaves them for the bundler to strip, so exactly one tool
  // does that job. Being `enforce: 'pre'` is the whole of it — no `esbuild.jsx`
  // is needed, and on Vite 8 that option no longer exists.
  plugins: [firsthand({ packageName: 'firsthand-examples' })],
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        counter: page('counter'),
        todo: page('todo'),
        context: page('context'),
        portal: page('portal'),
        data: page('data'),
        router: page('router'),
        'massive-table': page('massive-table'),
      },
    },
  },
});
