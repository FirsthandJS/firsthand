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
import { css, resetStyles, styled, ThemeContext, useTheme } from '@firsthandjs/styled';

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

describe('a styled component is an element you can reach', () => {
  it('hands its element to a ref', () => {
    // What an editor, a canvas or a <video> needs before anything else: the
    // node itself. `ref` is in no element's prototype, so the forwarding rule
    // that asks `name in element` never said yes to it.
    const Host = styled.div`
      color: red;
    `;
    let given: Element | null = null;
    const App = component(() => (
      <Host
        ref={(element: Element) => {
          given = element;
        }}
      />
    ));
    const view = mount(() => <App />);

    expect(given).not.toBeNull();
    expect(given).toBe(view.get('div'));
  });

  it('gives the ref the element, not the wrapper, through a wrapped component', () => {
    const Base = styled.button`
      border: 0;
    `;
    const Loud = styled(Base)`
      font-weight: 700;
    `;
    let given: Element | null = null;
    const App = component(() => (
      <Loud
        ref={(element: Element) => {
          given = element;
        }}
      />
    ));
    const view = mount(() => <App />);

    expect(given).toBe(view.get('button'));
  });
});
