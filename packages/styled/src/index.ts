/**
 * `@firsthandjs/styled` — styled-components' API, on a framework that renders once.
 *
 * ```tsx
 * const Button = styled.button<{ $primary?: boolean }>`
 *   padding: 0.5rem 1rem;
 *   border: 1px solid ${(p) => p.theme.line};
 *   background: ${(p) => (p.$primary ? 'rebeccapurple' : 'transparent')};
 *   &:hover {
 *     filter: brightness(1.2);
 *   }
 * `;
 *
 * <Button $primary onClick={save}>Save</Button>;
 * ```
 *
 * The difference from styled-components is what a prop change costs. There, a
 * new prop value means a new class, inserted into the sheet and swapped on the
 * element — a thousand rows with a colour each produce a thousand rules. Here,
 * an interpolation that sits in a declaration's value becomes a CSS custom
 * property: one rule for the component, and one `setProperty` per change, for
 * any number of instances.
 *
 * Interpolations that produce whole declarations still resolve to a class per
 * distinct result, because nothing else can express them — that is the same
 * mechanism, kept for the cases that need it.
 *
 * Nesting (`&:hover`, `@media`) is the browser's own CSS nesting. There is no
 * preprocessor in this package, which is most of why it is 1 kB.
 */
export { styled } from './styled.js';
export type { ElementProps, Interpolation, StyledFactory, StyledProps } from './styled.js';
export { css, isFragment } from './css.js';
export type { CssFragment } from './css.js';
export { keyframes, createGlobalStyle } from './global.js';
export { ThemeContext, useTheme } from './theme.js';
export type { Theme } from './theme.js';

/**
 * Your application's theme, declared by you.
 *
 * Empty here. An application describes its own:
 *
 * ```ts
 * declare module '@firsthandjs/styled' {
 *   interface FirsthandTheme {
 *     background: string;
 *     text: string;
 *   }
 * }
 * ```
 *
 * and every interpolation then reads `props.theme.background` with a type
 * rather than `props.theme['background']` with a cast. A project that declares
 * nothing keeps the indexed form, so this costs nothing to ignore.
 *
 * It is declared here, in the entry module, because that is the module an
 * application augments.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FirsthandTheme {}
export { hash, reset as resetStyles } from './sheet.js';
