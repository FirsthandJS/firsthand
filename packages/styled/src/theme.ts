/**
 * The theme, as an ordinary Firsthand context.
 *
 * Nothing about it is special: it is a context holding an object, so a theme
 * swap is one signal write, and a styled component that reads `theme` updates
 * the custom properties that depend on it — not the component, and not the
 * rules that never mentioned the theme.
 */
import { createContext, useContext, type Context, type ReadonlyCell } from '@firsthandjs/core';
// Declared in the entry module, because that is the module an application
// augments: `declare module '@firsthandjs/styled'` merges with interfaces
// declared *there*, not with ones it re-exports from elsewhere.
import type { FirsthandTheme } from './index.js';

/**
 * What an interpolation is handed as `props.theme`.
 *
 * The declared theme once there is one, and an indexable object until then.
 * `keyof` an empty interface is `never`, which is how that is detected.
 */
export type Theme = [keyof FirsthandTheme] extends [never]
  ? Readonly<Record<string, unknown>>
  : // eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type
    Readonly<FirsthandTheme>;

const EMPTY = Object.freeze({}) as Theme;

/**
 * Provide it with `provide(ThemeContext, myTheme)` — or a cell, to swap it.
 *
 * Annotated rather than inferred: an inferred type is *resolved* into the
 * declaration file, and `Theme` would be frozen there as the empty-theme
 * branch — so an application's `declare module` augmentation would change
 * nothing. Written out, the conditional stays a conditional for whoever
 * imports it.
 */
export const ThemeContext: Context<Theme> = createContext<Theme>(EMPTY, 'theme');

/** The theme above this component, as a cell. */
export function useTheme(): ReadonlyCell<Theme> {
  return useContext(ThemeContext);
}
