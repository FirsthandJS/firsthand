/**
 * Styling, where two features meet.
 *
 * Restyling, themes, custom properties and wrapped components each work on
 * their own; these are the combinations.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { component, provide, signal } from '@firsthandjs/dom';
import { cleanup, mount } from '@firsthandjs/testing';
import { css, resetStyles, styled, ThemeContext } from '@firsthandjs/styled';

afterEach(() => {
  cleanup();
  resetStyles();
});

const rules = (): string[] =>
  [...document.querySelectorAll('style[data-firsthand-styled]')]
    .flatMap((sheet) => [...sheet.childNodes])
    .map((node) => node.textContent ?? '');

describe('restyling, combined with everything else', () => {
  it('keeps custom properties working through a wrapped level', () => {
    const hue = signal(10);
    const Base = styled.div<{ $hue: number }>`
      color: hsl(${(props) => props.$hue} 70% 50%);
    `;
    const Outer = styled(Base)<{ $hue: number }>`
      opacity: 0.5;
    `;
    const view = mount(() => <Outer $hue={hue.value} />);
    const box = view.get('div');

    // The inner component still owns the element, so its value interpolation
    // is still one custom property — not a class per value.
    const before = rules().length;
    hue.value = 200;
    expect(rules().length).toBe(before);
    expect(box.getAttribute('style')).toContain('200');
  });

  it('lets a block interpolation at the outer level win over the inner one', () => {
    const loud = signal(false);
    const Base = styled.button`
      padding: 1px;
    `;
    const Outer = styled(Base)`
      ${() =>
        loud.value
          ? css`
              padding: 9px;
            `
          : css`
              padding: 4px;
            `}
    `;
    const view = mount(() => <Outer />);
    const button = view.get('button');

    expect(getComputedStyle(button).padding).toBe('4px');
    loud.value = true;
    expect(getComputedStyle(button).padding).toBe('9px');
  });

  it('gives two instances of a restyled component one pair of rules', () => {
    const Base = styled.span`
      color: red;
    `;
    const Outer = styled(Base)`
      font-weight: bold;
    `;
    mount(() => (
      <>
        <Outer />
        <Outer />
        <Outer />
      </>
    ));

    expect(rules()).toHaveLength(2);
  });

  it('keeps a user’s own class alongside both generated ones', () => {
    const Base = styled.span`
      color: red;
    `;
    const Outer = styled(Base)`
      font-weight: bold;
    `;
    const view = mount(() => <Outer class="mine" />);

    const classes = view.get('span').className.split(' ');
    expect(classes).toContain('mine');
    expect(classes).toHaveLength(3);
  });

  it('updates a theme read at the outer level only', () => {
    const theme = signal({ accent: 'red', line: 'blue' });
    const Base = styled.div`
      border-color: ${(props) => String(props.theme['line'])};
    `;
    const Outer = styled(Base)`
      color: ${(props) => String(props.theme['accent'])};
    `;
    const App = component(() => {
      provide(ThemeContext, theme);
      return <Outer />;
    });
    const view = mount(() => <App />);
    const box = view.get('div');

    expect(getComputedStyle(box).color).toBe('red');
    expect(getComputedStyle(box).borderColor).toBe('blue');

    theme.value = { accent: 'green', line: 'blue' };
    expect(getComputedStyle(box).color).toBe('green');
    expect(getComputedStyle(box).borderColor).toBe('blue');
  });

  it('disposes cleanly: the element goes, and so does nothing else', () => {
    const Base = styled.span`
      color: red;
    `;
    const Outer = styled(Base)`
      font-weight: bold;
    `;
    const view = mount(() => <Outer />);
    expect(view.all('span')).toHaveLength(1);

    view.unmount();
    expect(document.querySelectorAll('span')).toHaveLength(0);
  });
});

describe('wrapping a component that is not styled', () => {
  it('hands it the transient props without breaking it', () => {
    // A component that puts everything it is given on an element — the worst
    // case for forwarding transient props, because they reach the DOM.
    const Plain = component<{ class?: string; $tone?: string; children?: unknown }>((props) => (
      <b class={props.class} data-tone={props.$tone}>
        {props.children as never}
      </b>
    ));
    const Loud = styled(Plain)<{ $tone: string }>`
      font-style: italic;
    `;

    const view = mount(() => <Loud $tone="loud">hi</Loud>);
    const element = view.get('b');

    expect(element.getAttribute('data-tone')).toBe('loud');
    expect(element.className).not.toBe('');
    expect(getComputedStyle(element).fontStyle).toBe('italic');
  });

  it('updates that component’s class when the wrapper’s class changes', () => {
    const wide = signal(false);
    const Plain = component<{ class?: string }>((props) => <b class={props.class} />);
    const Wrapped = styled(Plain)`
      ${() =>
        wide.value
          ? css`
              letter-spacing: 4px;
            `
          : css`
              letter-spacing: 1px;
            `}
    `;

    const view = mount(() => <Wrapped />);
    const element = view.get('b');
    const before = element.className;

    wide.value = true;
    expect(element.className).not.toBe(before);
    expect(getComputedStyle(element).letterSpacing).toBe('4px');
  });
});
