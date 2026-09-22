/**
 * Turning values into markup, with exactly the meaning the DOM layer gives
 * them.
 *
 * Every function here has a twin in `@firsthandjs/dom`'s `attributes.ts`, and
 * the pairs have to agree: what the server writes is what the client would
 * have built, or hydration adopts a tree that does not match and the
 * difference shows up as a repaint nobody asked for.
 *
 * The agreement is not asserted by reading the two files. It is asserted by
 * rendering the same component both ways and comparing the markup, which is
 * what `packages/server/test/parity.test.tsx` does for every shape the
 * compiler can emit.
 */

const NEEDS_TEXT = /[&<>]/;
const NEEDS_ATTRIBUTE = /[&"]/;

/**
 * Text, escaped for a child position.
 *
 * One pass over the characters, and no allocation at all when there is
 * nothing to escape — which is almost every string a page contains. A regular
 * expression test followed by three `replace` calls reads better and measured
 * slower on the server benchmark, where escaping happens twice per row.
 *
 * `&` is handled by the same pass as the others, or the escapes would escape
 * each other. `>` is not strictly required in text, but a stray one is a
 * smell worth not emitting.
 */
export function escapeText(value: string): string {
  // The test first, and it is a regular expression rather than the loop
  // below: a native scan beats reading the characters one at a time, and
  // almost every string on a page needs nothing done to it. The loop is for
  // the strings that do, where it saves the three passes `replace` would make.
  if (!NEEDS_TEXT.test(value)) {
    return value;
  }
  let out = '';
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    let escaped: string;
    if (code === 38) {
      escaped = '&amp;';
    } else if (code === 60) {
      escaped = '&lt;';
    } else if (code === 62) {
      escaped = '&gt;';
    } else {
      continue;
    }
    out += value.slice(start, i) + escaped;
    start = i + 1;
  }
  // The test above already found one, so the loop found one too: the two
  // agree on which characters they are about.
  return out + value.slice(start);
}

/** Text, escaped for a double-quoted attribute value. The same pass. */
export function escapeAttribute(value: string): string {
  if (!NEEDS_ATTRIBUTE.test(value)) {
    return value;
  }
  let out = '';
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    let escaped: string;
    if (code === 38) {
      escaped = '&amp;';
    } else if (code === 34) {
      escaped = '&quot;';
    } else {
      continue;
    }
    out += value.slice(start, i) + escaped;
    start = i + 1;
  }
  // The test above already found one, so the loop found one too: the two
  // agree on which characters they are about.
  return out + value.slice(start);
}

/**
 * One attribute, or nothing at all.
 *
 * `setAttribute` in the DOM layer removes the attribute for `null`,
 * `undefined` and `false`, and writes an empty value for `true`. The absent
 * cases have to produce no attribute here rather than an empty one, because
 * `title=""` and no `title` are different trees.
 */
export function attribute(name: string, value: unknown): string {
  if (value == null || value === false) {
    return '';
  }
  if (value === true) {
    return ` ${name}=""`;
  }
  return ` ${name}="${escapeAttribute(String(value))}"`;
}

/**
 * A boolean DOM property, as the attribute that stands for it.
 *
 * The client writes `node.checked = true`, which is a property and leaves no
 * attribute behind. The server has only attributes, so it writes the one the
 * parser turns back into that property.
 */
export function booleanAttribute(name: string, value: unknown): string {
  return value === true || (value != null && value !== false && Boolean(value))
    ? ` ${lowerName(name)}=""`
    : '';
}

/** `readOnly` is a property; `readonly` is the attribute that produces it. */
function lowerName(name: string): string {
  return name === 'readOnly' ? 'readonly' : name.toLowerCase();
}

/** Properties an attribute can seed, and the attribute that seeds each. */
const PROPERTY_ATTRIBUTES: Record<string, string> = {
  value: 'value',
  textContent: '',
  innerHTML: '',
  innerText: '',
  scrollTop: '',
  scrollLeft: '',
  volume: '',
  currentTime: '',
  playbackRate: '',
  srcObject: '',
  className: 'class',
  class: 'class',
  htmlFor: 'for',
};

/**
 * A DOM property, as markup.
 *
 * Most properties have no attribute that reproduces them — a `scrollTop` is
 * not something HTML can say — and those produce nothing: the client sets them
 * during hydration, which is the only time they can be set at all. `value` is
 * the one that matters in practice, and the parser does seed it.
 */
export function property(name: string, value: unknown): string {
  const attributeName = PROPERTY_ATTRIBUTES[name];
  if (attributeName === undefined || attributeName === '') {
    return '';
  }
  return attribute(attributeName, value);
}

/** `class` from a string, an object or an array, as the DOM layer reads it. */
export function classValue(value: unknown): string {
  return attribute('class', classText(value));
}

function classText(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    // `applyProp` joins the truthy entries and writes the result, including
    // when the result is empty: an empty array leaves `class=""` behind, not
    // no class at all.
    return value.filter(Boolean).join(' ');
  }
  if (typeof value === 'object') {
    const names: string[] = [];
    for (const name in value as Record<string, unknown>) {
      // `setClassList` toggles on truthiness, not on `true`.
      if ((value as Record<string, unknown>)[name]) {
        names.push(name);
      }
    }
    // No names at all is no `class` attribute: `classList` was never touched.
    return names.length === 0 ? null : names.join(' ');
  }
  return String(value);
}

/** `style` from a string or an object. */
export function styleValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value !== 'object') {
    return attribute('style', String(value));
  }
  const declarations: string[] = [];
  for (const name in value as Record<string, unknown>) {
    const one = (value as Record<string, unknown>)[name];
    if (one != null) {
      declarations.push(`${hyphenate(name)}: ${String(one)};`);
    }
  }
  return declarations.length === 0 ? '' : attribute('style', declarations.join(' '));
}

const HYPHENATE = /[A-Z]/g;

function hyphenate(name: string): string {
  return name.startsWith('--') ? name : name.replace(HYPHENATE, (l) => `-${l.toLowerCase()}`);
}
