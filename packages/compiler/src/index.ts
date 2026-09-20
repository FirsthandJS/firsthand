/**
 * `@firsthandjs/compiler` — the build-time half of Firsthand.
 *
 * Nothing here ships to the browser. The transform emits calls against the
 * published protocol in `@firsthandjs/dom/internal`, so compiled output is code a
 * developer could have written by hand (ARCHITECTURE section 1.1).
 */

export { default as firsthandPlugin } from './transform.js';
export type { FirsthandPluginOptions } from './transform.js';
export { compileModule, transform } from './api.js';
export type { Compiled, SourceMap, TransformOptions } from './api.js';
export { stableId } from './ids.js';
