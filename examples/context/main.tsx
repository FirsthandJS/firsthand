/**
 * Context: resolved once, then read like any other signal.
 *
 * `Leaf` is nested ten levels deep. Switching the theme does not walk the tree
 * and does not re-run a single component function — each leaf holds the
 * provider's cell directly, so the change reaches exactly the DOM parts that
 * read it.
 */
import { component, createContext, provide, render, signal, useContext } from '@firsthandjs/dom';

type Theme = { mode: 'light' | 'dark'; accent: string };

const ThemeContext = createContext<Theme>();

const Leaf = component((props: { index: number }) => {
  const theme = useContext(ThemeContext);
  return (
    <li style={{ color: theme.value.accent }}>
      leaf {props.index} sees {theme.value.mode}
    </li>
  );
});

const Nested = component((props: { depth: number }) =>
  props.depth === 0 ? (
    <ul>
      {Array.from({ length: 12 }, (_, i) => i).map((i) => (
        <Leaf key={i} index={i} />
      ))}
    </ul>
  ) : (
    <div style={{ paddingLeft: '4px' }}>
      <Nested depth={props.depth - 1} />
    </div>
  ),
);

const App = component(() => {
  const theme = signal<Theme>({ mode: 'light', accent: '#1d4ed8' });
  provide(ThemeContext, theme);

  return (
    <>
      <h1>Context</h1>
      <p>
        <button
          onClick={() => {
            theme.value =
              theme.value.mode === 'light'
                ? { mode: 'dark', accent: '#f59e0b' }
                : { mode: 'light', accent: '#1d4ed8' };
          }}
        >
          toggle theme
        </button>
      </p>
      <Nested depth={10} />
    </>
  );
});

// No container argument and no element lookup: `render` mounts into
// `document.body` by default.
render(() => <App />);
