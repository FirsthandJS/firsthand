import { defineConfig } from 'vite';
import { firsthand } from '@firsthandjs/compiler/vite';

export default defineConfig({
  /*
   * One plugin, two builds.
   *
   * `ssr` is not configured here: Vite tells the transform which build it is
   * running, and the plugin compiles against `@firsthandjs/server/internal`
   * for the server one and `@firsthandjs/dom/internal` for the browser one.
   *
   * `hydratable` is the one thing this project has to say, and it says it
   * once. It makes the browser build walk its templates through helpers that
   * can step over markup a server already filled in. An application without a
   * server leaves it off and its templates are walked by property reads, which
   * is why this is a flag rather than a default.
   */
  plugins: [firsthand({ packageName: 'firsthand-ssr-example', hydratable: true })],
  build: {
    // The server reads this to find the built assets, and a manifest is how a
    // real one would too.
    manifest: true,
  },
});
