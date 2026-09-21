/**
 * Reading a tagged template once, so that instances do not re-read it.
 *
 * A template is compiled the first time it is written, never per instance and
 * never per update. What compilation decides is *where* each interpolation
 * sits, because that decides what it costs at runtime:
 *
 * - a value position — `color: ${…};` — becomes a CSS custom property. Every
 *   instance shares one class, and a change is one `setProperty` call.
 * - anything else — `${(p) => p.big && css`…`}` — is a block, and blocks are
 *   resolved into a class per distinct result, the way styled-components does
 *   it for everything.
 *
 * The split matters at scale: a thousand rows with a colour each produce one
 * rule here and a thousand rules in a library that cannot tell the difference.
 */

/** What a `css` template is before anything reads it. */
export type CssFragment = {
  readonly strings: readonly string[];
  readonly values: readonly unknown[];
};

const FRAGMENT: unique symbol = Symbol('firsthand.css');

/**
 * A reusable piece of CSS.
 *
 * Composes into another template, and may be returned from an interpolation
 * function — which is how a conditional block is written.
 */
export function css(strings: TemplateStringsArray, ...values: unknown[]): CssFragment {
  return { [FRAGMENT]: true, strings: [...strings], values } as CssFragment;
}

export function isFragment(value: unknown): value is CssFragment {
  return typeof value === 'object' && value !== null && FRAGMENT in value;
}

/** An interpolation that has to be evaluated per instance. */
export type Slot = {
  /** `value` becomes a custom property; `block` becomes part of a class. */
  readonly kind: 'value' | 'block';
  /** The custom property's name, for a value slot. */
  readonly property: string;
  readonly fn: (props: Record<string, unknown>) => unknown;
};

export type Compiled = {
  /**
   * The template as literal text and block slots, in order.
   *
   * Value slots are already `var(…)` inside the literal chunks; a block slot
   * appears as itself, because its text is only known per instance.
   */
  readonly chunks: readonly (string | Slot)[];
  readonly slots: readonly Slot[];
  /** True when nothing has to be resolved per instance. */
  readonly static: boolean;
};

/**
 * Whether an interpolation sits inside a declaration's value.
 *
 * Looks back to the end of the previous declaration or block: if a colon
 * follows it, we are in a value. `color: ${…}` is, `${…}` after a `;` is not,
 * and `padding: 0 ${…} 0` is.
 */
function inValuePosition(before: string): boolean {
  for (let at = before.length - 1; at >= 0; at--) {
    const character = before[at];
    if (character === ':') {
      return true;
    }
    if (character === ';' || character === '{' || character === '}') {
      return false;
    }
  }
  return false;
}

/** Everything a static interpolation may be: numbers, strings, nothing. */
function staticText(value: unknown): string {
  if (value === null || value === undefined || value === false || value === true) {
    return '';
  }
  return String(value);
}

/**
 * Flattens a fragment into text plus the slots that could not be resolved.
 *
 * Nested fragments are inlined, so a mixin costs nothing at runtime unless it
 * contains a function of its own.
 */
export function compile(fragment: CssFragment, id: string, values = true): Compiled {
  const slots: Slot[] = [];
  const chunks: (string | Slot)[] = [];
  let text = '';

  const push = (): void => {
    if (text !== '') {
      chunks.push(text);
      text = '';
    }
  };

  const walk = (part: CssFragment): void => {
    // `entries()` rather than an index, so the literal chunk is a string
    // rather than `string | undefined` — no fallback, and no branch that
    // cannot be taken.
    for (const [at, chunk] of part.strings.entries()) {
      text += chunk;
      if (at >= part.values.length) {
        continue;
      }
      const value = part.values[at];
      if (isFragment(value)) {
        walk(value);
        continue;
      }
      if (typeof value !== 'function') {
        text += staticText(value);
        continue;
      }
      const index = slots.length;
      // `values: false` is for the places a custom property cannot be used —
      // a global rule, or a wrapped component whose element this package does
      // not own — where every slot has to resolve into the text instead.
      const kind = values && inValuePosition(text) ? 'value' : 'block';
      const slot: Slot = { kind, property: `--${id}-${String(index)}`, fn: value as Slot['fn'] };
      slots.push(slot);
      if (kind === 'value') {
        text += `var(${slot.property})`;
      } else {
        push();
        chunks.push(slot);
      }
    }
  };
  walk(fragment);
  push();

  return { chunks, slots, static: slots.length === 0 };
}

/**
 * Joins a fragment whose `static` flag has already been checked.
 *
 * Such a fragment has no slots, so `join` would need a resolver that can never
 * run — an arrow no test could reach and no reader could explain.
 */
export function joinStatic(compiled: Compiled): string {
  return compiled.chunks.join('');
}

/** Joins the compiled chunks, asking for each block slot's text. */
export function join(compiled: Compiled, resolve: (slot: Slot) => string): string {
  let text = '';
  for (const chunk of compiled.chunks) {
    text += typeof chunk === 'string' ? chunk : resolve(chunk);
  }
  return text;
}

/** Resolves one block slot's value, including a nested fragment. */
export function blockText(value: unknown): string {
  if (isFragment(value)) {
    const inner = compile(value, 'x');
    if (!inner.static) {
      // A function inside a block that is itself behind a function: the outer
      // call already had the props, so this is a mistake worth naming rather
      // than a silent empty rule.
      throw new Error(
        'A css`` fragment returned from an interpolation must not contain further functions.',
      );
    }
    return joinStatic(inner);
  }
  return staticText(value);
}
