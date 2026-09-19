/**
 * Three ways to use somebody else's components, side by side.
 *
 * They are not equivalent, and the page says so:
 *
 * 1. **Web components** — Shoelace here, but Material Web, Fluent, Vaadin and
 *    Carbon are the same story. They are custom elements, so they are DOM, so
 *    Firsthand uses them with nothing in between. Props are properties, events
 *    are events, and the framework ships no adapter.
 * 2. **React components** — MUI here. They need React's reconciler, so
 *    `@firsthandjs/react` mounts one. It works, and it costs React.
 * 3. **`@firsthandjs/styled`** — styled-components' API, no React, 1.9 kB.
 *
 * The React panel shows both ways of writing a React component: bridged by
 * hand with `fromReact`, and written directly as an element after importing
 * `@firsthandjs/react/auto`. One MUI theme sits around every bridged root, which
 * is what `setReactWrapper` is for.
 */
import '@firsthandjs/react/auto';
import { component, provide, render, signal } from '@firsthandjs/dom';
import { fromReact, setReactWrapper } from '@firsthandjs/react';
import { createGlobalStyle, styled, ThemeContext } from '@firsthandjs/styled';

// --- 1. Web components: an import, and then they are elements ---------------
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/rating/rating.js';
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';

setBasePath('/shoelace');

// --- 2. React components, through the bridge --------------------------------
import MuiButton from '@mui/material/Button';
import MuiSlider from '@mui/material/Slider';
import MuiChip from '@mui/material/Chip';
import MuiAlert from '@mui/material/Alert';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createElement } from 'react';

const Button = fromReact(MuiButton);
const Slider = fromReact(MuiSlider, { host: 'div' });
const Chip = fromReact(MuiChip);

// --- 3. Styled components ---------------------------------------------------
const GlobalStyle = createGlobalStyle`
  body {
    font: 16px/1.5 system-ui, sans-serif;
    margin: 0;
    padding: 2rem;
    background: ${(props) => props.theme['background']};
    color: ${(props) => props.theme['text']};
  }
`;

const Panel = styled.section`
  border: 1px solid ${(props) => props.theme['line']};
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin-bottom: 1.5rem;
  & h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
  }
`;

const Swatch = styled.span<{ $hue: number; $on?: boolean }>`
  display: inline-block;
  width: 1.5rem;
  height: 1.5rem;
  margin-right: 0.25rem;
  border-radius: 4px;
  background: hsl(${(props) => props.$hue} 70% 55%);
  ${(props) => (props.$on === true ? 'outline: 2px solid currentColor; outline-offset: 2px;' : '')}
`;

const dark = { background: '#15151a', text: '#f2f2f5', line: '#3a3a44' };
const light = { background: '#ffffff', text: '#15151a', line: '#d8d8e0' };

/** A styled component, styled again: the outer padding is the one that wins. */
const RoomyPanel = styled(Panel)`
  padding: 2rem 2.25rem;
`;

const App = component(() => {
  const theme = signal(light);
  const rating = signal(3);
  const clicks = signal(0);
  const volume = signal(40);
  const highlighted = signal(2);

  provide(ThemeContext, theme);

  // Every bridged component is its own React root, so a provider has to be
  // around each of them. Reading `theme.value` here is what makes MUI follow
  // the same switch the rest of the page follows.
  setReactWrapper((node) =>
    createElement(
      ThemeProvider,
      { theme: createTheme({ palette: { mode: theme.value === dark ? 'dark' : 'light' } }) },
      node,
    ),
  );

  return (
    <main>
      <GlobalStyle />
      <h1>Interop</h1>

      <Panel>
        <h2>Web components (Shoelace)</h2>
        <sl-button data-testid="sl-button" variant="primary" onClick={() => clicks.value++}>
          Clicked {clicks.value} times
        </sl-button>{' '}
        <sl-switch
          data-testid="sl-switch"
          checked={theme.value === dark}
          on:sl-change={(event: Event) => {
            theme.value = (event.currentTarget as HTMLInputElement).checked ? dark : light;
          }}
        >
          Dark
        </sl-switch>{' '}
        <sl-rating
          data-testid="sl-rating"
          value={rating.value}
          on:sl-change={(event: Event) => {
            rating.value = (event.currentTarget as unknown as { value: number }).value;
          }}
        />
        <p data-testid="rating-echo">Rated {rating.value} of 5</p>
      </Panel>

      <Panel>
        <h2>React components (MUI)</h2>
        <Button variant="contained" data-testid="mui-button" onClick={() => clicks.value++}>
          MUI button
        </Button>{' '}
        <Chip label={`clicks: ${String(clicks.value)}`} data-testid="mui-chip" />
        <Slider
          data-testid="mui-slider"
          value={volume.value}
          onChange={(_event: unknown, next: number | number[]) => {
            volume.value = typeof next === 'number' ? next : (next[0] ?? 0);
          }}
        />
        <p data-testid="volume-echo">Volume {volume.value}</p>
        {/* No wrapper: `@firsthandjs/react/auto` makes a React component an
            ordinary element, and MUI's theme reaches it like any other. */}
        <MuiAlert severity="info" data-testid="mui-alert">
          Written directly, with no bridge declared for it.
        </MuiAlert>
      </Panel>

      <RoomyPanel data-testid="roomy-panel">
        <h2>A styled component, styled again</h2>
        <p>Both classes are on the element; the outer padding wins on specificity.</p>
      </RoomyPanel>

      <Panel>
        <h2>Styled components</h2>
        <p>
          {[0, 60, 120, 200, 280].map((hue, index) => (
            <Swatch
              key={hue}
              $hue={hue}
              $on={highlighted.value === index}
              data-testid={`swatch-${String(index)}`}
              onClick={() => (highlighted.value = index)}
            />
          ))}
        </p>
        <p data-testid="swatch-echo">Swatch {highlighted.value} is highlighted</p>
      </Panel>
    </main>
  );
});

render(() => <App />);
