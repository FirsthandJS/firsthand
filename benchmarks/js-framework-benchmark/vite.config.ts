import { defineConfig } from 'vite';
import { firsthand } from '@firsthandjs/compiler/vite';

export default defineConfig({
  plugins: [firsthand({ packageName: 'firsthand-jsfb' })],
  build: { target: 'es2022', modulePreload: { polyfill: false } },
});
