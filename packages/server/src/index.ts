/**
 * Server-side rendering for Firsthand.
 *
 * ```ts
 * import { renderToString } from '@firsthandjs/server';
 *
 * const html = renderToString(() => <App />);
 * ```
 *
 * The application is the application: the same components, the same signals,
 * the same context. What is different is only what cannot exist without a
 * browser — effects do not run, and refs and handlers are attached later, by
 * `hydrate` in `@firsthandjs/dom`.
 */

export {
  renderToString,
  renderToStringAsync,
  type AsyncRenderOptions,
  type RenderOptions,
} from './render.js';
export { escapeAttribute, escapeText } from './html.js';
export { Markup } from './markup.js';
