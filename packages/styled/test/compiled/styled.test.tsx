/**
 * `@firsthandjs/styled`, used the way an application uses it.
 *
 * The assertions worth reading are about *how many rules* exist. A library
 * that cannot tell a value interpolation from a block writes a rule per
 * distinct prop value; this writes one, and moves the value into a custom
 * property. Both paths are here, and both are counted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catchError, component, provide, signal } from '@firsthandjs/dom';
import { cleanup, mount } from '@firsthandjs/testing';
import {
  css,
  createGlobalStyle,
  keyframes,
  resetStyles,
  styled,
  ThemeContext,
  useTheme,
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

describe('a styled element', () => {
  it('renders the tag, with one class and one rule', () => {
    const Button = styled.button`
      color: red;
    `;
    const view = mount(() => <Button>Save</Button>);

    const button = view.get<HTMLButtonElement>('button');
    expect(button.textContent).toBe('Save');
    expect(button.className).toMatch(/^s[a-z0-9]+-[a-z0-9]+$/);
    expect(ruleFor(button)).toContain('color: red');
    expect(rules()).toHaveLength(1);
  });

  it('shares that rule across every instance', () => {
    const Box = styled.div`
      padding: 1rem;
    `;
    const view = mount(() => (
      <div id="wrap">
        <Box />
        <Box />
        <Box />
      </div>
    ));

    const classes = new Set(view.all('#wrap > div').map((node) => node.className));
    expect(classes.size).toBe(1);
    expect(rules()).toHaveLength(1);
  });

  it('forwards real attributes and keeps styling props off the DOM', () => {
    const Button = styled.button<{ $primary?: boolean; weight?: number }>`
      color: ${(props) => (props.$primary === true ? 'white' : 'black')};
    `;
    const view = mount(() => (
      <Button $primary weight={3} disabled id="save" data-role="primary" aria-label="Save">
        Save
      </Button>
    ));

    const button = view.get<HTMLButtonElement>('button');
    expect(button.disabled).toBe(true);
    expect(button.id).toBe('save');
    expect(button.dataset['role']).toBe('primary');
    expect(button.getAttribute('aria-label')).toBe('Save');
    // Neither the transient prop nor the unknown one reached the element.
    expect(button.getAttribute('$primary')).toBeNull();
    expect(button.getAttribute('weight')).toBeNull();
  });

  it('merges a class prop with its own', () => {
    const Box = styled.div`
      color: red;
    `;
    const view = mount(() => <Box class="extra" />);
    expect(view.get('div').className).toMatch(/^s\S+ extra$/);
  });

  it('handles events like any other element', () => {
    const clicks = vi.fn();
    const Button = styled.button`
      color: red;
    `;
    const view = mount(() => <Button onClick={clicks}>Go</Button>);

    view.get<HTMLButtonElement>('button').click();

    expect(clicks).toHaveBeenCalledTimes(1);
  });
});

describe('a value interpolation', () => {
  it('becomes a custom property, and updating it writes no new rule', () => {
    const colour = signal('red');
    const Box = styled.div`
      color: ${() => colour.value};
      padding: 1rem;
    `;
    const view = mount(() => <Box />);
    const box = view.get('div');

    expect(ruleFor(box)).toContain('color: var(--');
    expect(box.style.getPropertyValue(/--\S+?-0/.exec(ruleFor(box))?.[0] ?? '')).toBe('red');
    expect(rules()).toHaveLength(1);

    colour.value = 'blue';

    const property = /--\S+?-0/.exec(ruleFor(box))?.[0] ?? '';
    expect(box.style.getPropertyValue(property)).toBe('blue');
    // The whole point: still one rule, and the same class.
    expect(rules()).toHaveLength(1);
  });

  it('gives a thousand instances one rule between them', () => {
    const Row = styled.div<{ $hue: number }>`
      color: hsl(${(props) => props.$hue} 80% 50%);
    `;
    const view = mount(() => (
      <div id="rows">
        {Array.from({ length: 1000 }, (_unused, index) => (
          <Row key={index} $hue={index} />
        ))}
      </div>
    ));

    expect(view.all('#rows > div')).toHaveLength(1000);
    expect(rules()).toHaveLength(1);
  });

  it('reads props live', () => {
    const size = signal(1);
    const Box = styled.div<{ scale: number }>`
      width: ${(props) => `${String(props.scale)}rem`};
    `;
    const view = mount(() => <Box scale={size.value} />);
    const box = view.get('div');
    const property = /--\S+?-0/.exec(ruleFor(box))?.[0] ?? '';

    expect(box.style.getPropertyValue(property)).toBe('1rem');
    size.value = 4;
    expect(box.style.getPropertyValue(property)).toBe('4rem');
  });

  it('clears the property for nothing at all', () => {
    const shown = signal<string | undefined>('red');
    const Box = styled.div`
      color: ${() => shown.value};
    `;
    const view = mount(() => <Box />);
    const box = view.get('div');
    const property = /--\S+?-0/.exec(ruleFor(box))?.[0] ?? '';

    shown.value = undefined;
    expect(box.style.getPropertyValue(property)).toBe('');
    shown.value = 'blue';
    expect(box.style.getPropertyValue(property)).toBe('blue');
  });
});

describe('a block interpolation', () => {
  it('produces a rule per distinct result, and reuses them', () => {
    const primary = signal(false);
    const Button = styled.button<{ $on?: boolean }>`
      padding: 1rem;
      ${(props) =>
        props.$on === true
          ? css`
              background: purple;
              color: white;
            `
          : ''}
    `;
    const view = mount(() => (
      <div>
        <Button $on={primary.value}>a</Button>
        <Button $on={primary.value}>b</Button>
      </div>
    ));

    const [first, second] = view.all('button');
    // Two instances, one resolution, one rule.
    expect(first?.className).toBe(second?.className);
    expect(rules()).toHaveLength(1);

    primary.value = true;

    expect(ruleFor(first as Element)).toContain('background: purple');
    expect(first?.className).toBe(second?.className);
    expect(rules()).toHaveLength(2);

    // Back again: the first rule is still there and is reused, not re-added.
    primary.value = false;
    expect(rules()).toHaveLength(2);
  });

  it('accepts a template that opens with the interpolation itself', () => {
    // Nothing precedes the block, so there is no literal chunk to flush before
    // it. The single line is the test: Prettier would otherwise indent the
    // interpolation and put the whitespace back.
    // prettier-ignore
    const Box = styled.div`${() => 'color: red;'} margin: 0;`;
    const view = mount(() => <Box />);
    const rule = ruleFor(view.get('div'));
    expect(rule).toContain('color: red');
    expect(rule).toContain('margin: 0');
  });

  it('accepts a plain string, a number and nothing', () => {
    const Box = styled.div`
      ${() => 'color: red;'}
      ${() => null}
      ${() => false}
      z-index: ${() => 3};
    `;
    const view = mount(() => <Box />);
    expect(ruleFor(view.get('div'))).toContain('color: red');
  });

  it('refuses a fragment that still contains functions', () => {
    const Box = styled.div`
      ${() => css`
        color: ${() => 'red'};
      `}
    `;
    let thrown: unknown;
    // The interpolation runs inside an effect, so the error arrives at the
    // boundary rather than at the call site.
    const App = component(() =>
      catchError(
        () => <Box />,
        (error) => (thrown = error),
      ),
    );
    mount(() => <App />);

    expect((thrown as Error).message).toMatch(/must not contain further functions/);
  });
});

describe('composition', () => {
  it('inlines a css`` mixin without a runtime cost', () => {
    const rounded = css`
      border-radius: 4px;
      border: 1px solid black;
    `;
    const Box = styled.div`
      ${rounded}
      padding: 1rem;
    `;
    const view = mount(() => <Box />);

    expect(ruleFor(view.get('div'))).toContain('border-radius: 4px');
    expect(rules()).toHaveLength(1);
  });

  it('wraps another component, handing it the class', () => {
    const Inner = component<{ class?: string; children?: unknown }>((props) => (
      <section class={props.class}>{props.children as never}</section>
    ));
    const Fancy = styled(Inner)`
      color: red;
    `;
    const view = mount(() => <Fancy>content</Fancy>);

    const section = view.get('section');
    expect(section.textContent).toBe('content');
    expect(ruleFor(section)).toContain('color: red');
  });

  it('keeps nesting for the browser to resolve', () => {
    const Box = styled.div`
      color: red;
      &:hover {
        color: blue;
      }
      @media (min-width: 40rem) {
        padding: 2rem;
      }
    `;
    const view = mount(() => <Box />);

    const rule = ruleFor(view.get('div'));
    expect(rule).toContain('&:hover');
    expect(rule).toContain('@media (min-width: 40rem)');
  });
});

describe('the theme', () => {
  it('reaches interpolations, and a swap updates only what read it', () => {
    const theme = signal({ accent: 'rebeccapurple' });
    const Box = styled.div`
      color: ${(props) => props.theme['accent']};
    `;
    const App = component(() => {
      provide(ThemeContext, theme);
      return <Box />;
    });
    const view = mount(() => <App />);
    const box = view.get('div');
    const property = /--\S+?-0/.exec(ruleFor(box))?.[0] ?? '';

    expect(box.style.getPropertyValue(property)).toBe('rebeccapurple');

    theme.value = { accent: 'teal' };

    expect(box.style.getPropertyValue(property)).toBe('teal');
    expect(rules()).toHaveLength(1);
  });

  it('is readable on its own', () => {
    let seen: unknown;
    const Probe = component(() => {
      seen = useTheme().value;
      return <i />;
    });
    const App = component(() => {
      provide(ThemeContext, { accent: 'teal' });
      return <Probe />;
    });
    mount(() => <App />);
    expect(seen).toEqual({ accent: 'teal' });
  });

  it('defaults to an empty object rather than throwing', () => {
    const Box = styled.div`
      color: ${(props) => (props.theme['accent'] as string) ?? 'black'};
    `;
    const view = mount(() => <Box />);
    const box = view.get('div');
    const property = /--\S+?-0/.exec(ruleFor(box))?.[0] ?? '';
    expect(box.style.getPropertyValue(property)).toBe('black');
  });
});

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
