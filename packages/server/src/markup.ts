/**
 * What the compiler's server output is made of.
 *
 * A view is a **string** on the server, and that creates exactly one problem:
 * once markup and text are both strings, nothing can tell them apart, and a
 * component that returns `<b>hi</b>` would be escaped into visible angle
 * brackets while a user string containing `<script>` would not be.
 *
 * So markup is carried in a one-field object and text is not. `ssr()` produces
 * markup; `child()` escapes everything that is not already markup. The object
 * costs one allocation per element, which is a fraction of the DOM node the
 * client would have built for the same thing.
 */

import { escapeText } from './html.js';

export class Markup {
  constructor(readonly html: string) {}
}

/**
 * Interleaves a template's static parts with the values between them.
 *
 * `parts` is one longer than `values`, always: the compiler splits the markup
 * at every hole, so a template with no holes is a single part and a template
 * ending in a hole still has an empty part after it.
 */
export function ssr(parts: readonly string[], ...values: readonly unknown[]): Markup {
  if (values.length === 0) {
    return new Markup(parts[0] as string);
  }
  let out = parts[0] as string;
  for (let i = 0; i < values.length; i++) {
    // `+=` coerces, so `String()` would be a call that does what the operator
    // is about to do anyway. Everything the compiler puts here is a string.
    out += (values[i] ?? '') as string;
    out += parts[i + 1] as string;
  }
  return new Markup(out);
}

/**
 * A child position: markup passes through, everything else is escaped.
 *
 * The shapes are the ones `applyChild` accepts in the browser, so that a view
 * that renders on the client renders the same thing here: nothing for `null`,
 * `undefined` and booleans, the text for a string or a number, and the
 * concatenation for an array.
 */
export function child(value: unknown): string {
  // Ordered by how often each case turns up in a page: markup, then text,
  // then a number, then everything else. `typeof` once, into a local.
  const type = typeof value;
  if (type === 'object') {
    if (value === null) {
      return '';
    }
    if (value instanceof Markup) {
      return value.html;
    }
  } else if (type === 'string') {
    return escapeText(value as string);
  } else if (type === 'number' || type === 'bigint') {
    return String(value);
  } else if (value === undefined || type === 'boolean') {
    return '';
  }
  if (Array.isArray(value)) {
    let out = '';
    for (let i = 0; i < value.length; i++) {
      out += child(value[i]);
    }
    return out;
  }
  if (type === 'function') {
    // A render function, or a part the compiler deferred. On the server there
    // is nothing to defer to: it is called once and its markup is the answer.
    return child((value as () => unknown)());
  }
  return escapeText(String(value));
}
