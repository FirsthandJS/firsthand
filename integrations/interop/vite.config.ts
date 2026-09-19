import { defineConfig } from 'vite';
import { firsthand } from '@firsthandjs/compiler/vite';

export default defineConfig({
  plugins: [firsthand({ packageName: 'firsthand-interop' })],
  resolve: {
    // `@firsthandjs/react` is linked from the workspace here, so Vite would
    // resolve its `react` import against the framework's copy and MUI's
    // against this one. Two Reacts means a null hooks dispatcher — the
    // "Cannot read properties of null (reading 'useContext')" that every
    // monorepo meets once. An installed package has one copy and needs none
    // of this.
    dedupe: ['react', 'react-dom'],
  },
});
