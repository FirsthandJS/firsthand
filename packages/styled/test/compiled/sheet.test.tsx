/**
 * The stylesheet itself: keyframes, global styles, what is written into it and
 * what restyling a styled component does to it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { component, provide, signal } from '@firsthandjs/dom';
import { cleanup, mount } from '@firsthandjs/testing';
import {
  css,
  createGlobalStyle,
  keyframes,
  resetStyles,
  styled,
  ThemeContext,
} from '@firsthandjs/styled';

afterEach(() => {
  cleanup();
  resetStyles();
});

/** Every rule currently in the sheet. */
const rules = (): string[] =>
  [...document.querySelectorAll('style[data-firsthand-styled]')].flatMap((sheet) =>
    [...sheet.childNodes].map((node) => node.textContent ?? ''),
  );

/**
 * The rule for an element's own class.
 *
 * A wrapped component repeats its class in the selector — `.c.c` — so that
 * restyling wins on specificity rather than on insertion order, which is why
 * this matches a repeated selector rather than one class.
 */
const ruleFor = (element: Element): string => {
  const own = element.className.split(' ')[0] ?? '';
  return rules().find((rule) => rule.startsWith(`.${own}`)) ?? '';
};

describe('keyframes and global styles', () => {
  it('inserts an animation once and returns its name', () => {
    const spin = keyframes`
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    `;
    const again = keyframes`
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    `;

    expect(spin).toBe(again);
    expect(rules().filter((rule) => rule.startsWith('@keyframes'))).toHaveLength(1);

    const Box = styled.div`
      animation: ${spin} 1s linear infinite;
    `;
    const view = mount(() => <Box />);
    expect(ruleFor(view.get('div'))).toContain(`animation: ${spin} 1s`);
  });

  it('refuses a function in keyframes', () => {
    expect(
      () =>
        keyframes`
          from { opacity: ${() => 0}; }
        `,
    ).toThrow(/cannot interpolate functions/);
  });

  it('attaches global styles while the component lives', () => {
    const Global = createGlobalStyle`
      body { margin: 0; }
    `;
    const view = mount(() => <Global />);

    expect(rules().some((rule) => rule.includes('body { margin: 0; }'))).toBe(true);

    view.unmount();

    expect(rules().some((rule) => rule.includes('body { margin: 0; }'))).toBe(false);
  });

  it('re-inserts global styles when the theme changes', () => {
    const theme = signal({ bg: 'white' });
    const Global = createGlobalStyle`
      body { background: ${(props: { theme: Record<string, unknown> }) => props.theme['bg']}; }
    `;
    const App = component(() => {
      provide(ThemeContext, theme);
      return <Global />;
    });
    mount(() => <App />);

    expect(rules().some((rule) => rule.includes('background: white'))).toBe(true);

    theme.value = { bg: 'black' };

    expect(rules().some((rule) => rule.includes('background: black'))).toBe(true);
    expect(rules().some((rule) => rule.includes('background: white'))).toBe(false);
  });
});

describe('the sheet', () => {
  it('keeps a shared global rule until the last user leaves', () => {
    const Global = createGlobalStyle`
      body { margin: 0; }
    `;
    const first = mount(() => <Global />);
    const second = mount(() => <Global />);
    const present = (): boolean => rules().some((rule) => rule.includes('margin: 0'));

    expect(present()).toBe(true);

    first.unmount();
    // The second component still wants it.
    expect(present()).toBe(true);

    second.unmount();
    expect(present()).toBe(false);
  });

  it('survives being reset while a global style is still mounted', () => {
    const Global = createGlobalStyle`
      body { margin: 0; }
    `;
    const view = mount(() => <Global />);

    resetStyles();
    // Nothing to remove, and nothing thrown.
    expect(() => {
      view.unmount();
    }).not.toThrow();
  });

  it('leaves the class alone when a block resolves to the same rule', () => {
    const size = signal(1);
    const Box = styled.div`
      ${() => (size.value > 0 ? 'color: red;' : 'color: blue;')}
    `;
    const view = mount(() => <Box />);
    const box = view.get('div');
    const before = box.className;

    // A different value, the same CSS: the effect re-runs and the class does
    // not change.
    size.value = 2;

    expect(box.className).toBe(before);
    expect(rules()).toHaveLength(1);
  });

  it('survives someone removing its element', () => {
    const First = styled.div`
      color: red;
    `;
    mount(() => <First />);
    document.querySelector('style[data-firsthand-styled]')?.remove();

    const Second = styled.div`
      color: blue;
    `;
    const view = mount(() => <Second />);

    expect(ruleFor(view.get('div'))).toContain('color: blue');
  });
});

describe('restyling a styled component', () => {
  it('lets the outer declaration win, whatever order the rules were inserted in', () => {
    const Base = styled.button`
      padding: 1px;
    `;
    const Bigger = styled(Base)`
      padding: 9px;
    `;
    const view = mount(() => <Bigger>hi</Bigger>);
    const button = view.get('button');

    // Both classes are on the element…
    expect(button.className.split(' ')).toHaveLength(2);
    // …and the wrapper's rule repeats its class, so specificity — not
    // insertion order — decides.
    expect(getComputedStyle(button).padding).toBe('9px');
  });

  it('wins even when the wrapped component inserts its rule later', () => {
    const shade = signal('red');
    // A block interpolation, so this component's rule is inserted when it
    // renders — which is *after* the wrapper's.
    const Base = styled.button`
      ${() => css`
        padding: 1px;
        color: ${shade.value};
      `}
    `;
    const Bigger = styled(Base)`
      padding: 9px;
    `;
    const view = mount(() => <Bigger>hi</Bigger>);
    const button = view.get('button');

    expect(getComputedStyle(button).padding).toBe('9px');
    expect(getComputedStyle(button).color).toBe('red');
  });

  it('stacks, so a third level wins over the second', () => {
    const One = styled.i`
      padding: 1px;
    `;
    const Two = styled(One)`
      padding: 2px;
    `;
    const Three = styled(Two)`
      padding: 3px;
    `;
    const view = mount(() => <Three />);

    expect(getComputedStyle(view.get('i')).padding).toBe('3px');
  });

  it('carries the theme down every level', () => {
    const theme = signal({ accent: 'rebeccapurple' });
    const Base = styled.i`
      color: ${(props) => String(props.theme['accent'])};
    `;
    const Outer = styled(Base)`
      font-style: normal;
    `;
    const App = component(() => {
      provide(ThemeContext, theme);
      return <Outer />;
    });
    const view = mount(() => <App />);

    expect(getComputedStyle(view.get('i')).color).toBe('rebeccapurple');

    theme.value = { accent: 'teal' };
    expect(getComputedStyle(view.get('i')).color).toBe('teal');
  });
});

describe('the declared theme', () => {
  it('is what an interpolation is handed, whatever its shape', () => {
    // An application declares `FirsthandTheme` by module augmentation, which
    // makes `props.theme` that type instead of an indexable record. There is
    // nothing to run for that — it is a type — so what is asserted here is the
    // part that does run: the object reaches the interpolation unchanged.
    const theme = signal({ surface: '#fff', depth: 2 });
    const Box = styled.div`
      background: ${(props) => String(props.theme['surface'])};
      z-index: ${(props) => Number(props.theme['depth'])};
    `;
    const App = component(() => {
      provide(ThemeContext, theme);
      return <Box />;
    });
    const view = mount(() => <App />);
    const box = view.get('div');

    expect(getComputedStyle(box).backgroundColor).toBe('#fff');
    expect(getComputedStyle(box).zIndex).toBe('2');
  });
});
