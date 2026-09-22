/**
 * The markup, with each framework's own hydration bookkeeping removed.
 *
 * Comments and the attributes a framework needs to find its own nodes again
 * are not the document; what is left has to be identical, or the numbers are
 * not about the same work. Nothing else is touched — the elements, the
 * classes, the order and the text all have to match exactly.
 *
 * One implementation, imported by both server runners: two of these would be
 * two definitions of what "the same document" means.
 */

const COMMENT = /<!--[\s\S]*?-->/g;

/**
 * Every comment, and then every comment the first pass revealed.
 *
 * One pass over `<!--<!---->-->` leaves a `<!--` behind. A comparison that
 * treats two different documents as equal is worse than no comparison, so
 * this repeats until it finds nothing.
 */
export function withoutComments(html) {
  let out = html;
  for (let before = ''; out !== before;) {
    before = out;
    out = out.replace(COMMENT, '');
  }
  return out;
}

/** What a server sent, ready to be compared with what another server sent. */
export function normaliseMarkup(html) {
  return withoutComments(html)
    .replace(/\s(data-hk|data-reactroot|_ssr)="[^"]*"/g, '')
    .replace(/<!\$>|<!\/>/g, '')
    .replace(/\s*\n\s*/g, '');
}

/** What a browser ended up with, ready to be compared with another browser's. */
export function normaliseTree(html) {
  return withoutComments(html).replace(/\s(data-hk|data-v-[a-z0-9]+)="[^"]*"/g, '');
}
