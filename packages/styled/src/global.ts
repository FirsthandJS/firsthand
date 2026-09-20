/**
 * `keyframes` and `createGlobalStyle`.
 *
 * Neither has an element to hang a custom property on, so both resolve every
 * interpolation into the rule's own text.
 */
import { bind, onCleanup, useContext } from '@firsthandjs/core';
import { component, type Component, type View } from '@firsthandjs/dom';
import { blockText, compile, css, join, joinStatic, type CssFragment } from './css.js';
import type { Interpolation } from './styled.js';
import { hash, insert, remove } from './sheet.js';
import { ThemeContext, type Theme } from './theme.js';

/**
 * A named animation, inserted once.
 *
 * Returns the name, so it reads the way it does in styled-components:
 * `animation: ${spin} 1s linear infinite;`
 */
export function keyframes(strings: TemplateStringsArray, ...values: unknown[]): string {
  const compiled = compile(css(strings, ...values), 'k', false);
  if (!compiled.static) {
    throw new Error('keyframes`` cannot interpolate functions: an animation has no props.');
  }
  const text = joinStatic(compiled);
  const name = `k${hash(text)}`;
  insert(name, `@keyframes ${name}{${text}}`);
  return name;
}

/**
 * Styles for the document, attached for as long as the component lives.
 *
 * Interpolations may read the theme, and the rule is replaced when it changes.
 * Everything else about it is global by definition: it is not scoped, and two
 * instances of the same global style share one rule.
 */
export function createGlobalStyle(
  strings: TemplateStringsArray,
  // Typed like a styled component's interpolations, so `props.theme` is the
  // theme rather than an implicit `any`.
  ...values: Interpolation<unknown>[]
): Component<Record<string, never>> {
  const fragment: CssFragment = css(strings, ...values);
  const compiled = compile(fragment, 'g', false);

  const setup = (): View => {
    const theme = useContext(ThemeContext);
    let current: string | null = null;

    const drop = (): void => {
      if (current !== null) {
        remove(current);
        current = null;
      }
    };

    bind(() => {
      // The theme is the only input a global style can have, so this is the
      // whole of its reactivity.
      const view = { theme: theme.value } as Record<string, unknown>;
      const rule = join(compiled, (slot) => blockText(slot.fn(view)));
      const key = `g${hash(rule)}`;
      drop();
      insert(key, rule);
      current = key;
    });

    onCleanup(drop);
    return null;
  };

  return component<Record<string, never>>(
    setup,
    undefined,
    `firsthand/styled:global${hash(strings.join('|'))}`,
    'GlobalStyle',
  );
}

export type { Theme };
