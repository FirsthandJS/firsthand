/**
 * The theme's type.
 *
 * An application declares its own by augmenting `FirsthandTheme`, and
 * `props.theme` becomes that type. That augmentation is global to a
 * TypeScript program, so it cannot be done here without changing what every
 * other file in this repository's type check sees — it is proved instead by
 * the example application, which declares one and would not compile if
 * `props.theme.surface` were not typed.
 *
 * What is checked here is the other half: with nothing declared, the theme
 * stays an indexable record, so a project that never declares one keeps
 * working.
 */
import { describe, expectTypeOf, it } from 'vitest';
import { styled, type FirsthandTheme, type Theme } from '../src/index.js';

describe('an undeclared theme', () => {
  it('is an indexable record', () => {
    expectTypeOf<Theme>().toEqualTypeOf<Readonly<Record<string, unknown>>>();
    expectTypeOf<keyof FirsthandTheme>().toEqualTypeOf<never>();
  });

  it('reaches every interpolation', () => {
    styled.div`
      background: ${(props) => {
        expectTypeOf(props.theme).toEqualTypeOf<Theme>();
        return String(props.theme['surface']);
      }};
    `;
  });

  it('carries the component’s own props beside it', () => {
    styled.div<{ $tone: 'loud' | 'soft' }>`
      opacity: ${(props) => {
        expectTypeOf(props.$tone).toEqualTypeOf<'loud' | 'soft'>();
        return props.$tone === 'loud' ? 1 : 0.5;
      }};
    `;
  });
});
