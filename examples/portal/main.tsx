/**
 * A portal: DOM somewhere else, ownership unchanged.
 *
 * The modal's nodes are appended to `document.body`, but it still reads the
 * context provided by `App`, it is still disposed when the branch closes, and
 * its errors would still reach a boundary around `App` — because all of that
 * follows the owner tree, not the DOM tree.
 */
import {
  component,
  createContext,
  onCleanup,
  portal,
  provide,
  render,
  signal,
  useContext,
} from '@firsthandjs/dom';

const UserContext = createContext<{ name: string }>();

const Modal = component((props: { onClose: () => void }) => {
  const user = useContext(UserContext);
  onCleanup(() => {
    console.info('modal disposed');
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: '0',
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,.4)',
      }}
    >
      <div style={{ background: 'Canvas', padding: '1.5rem', borderRadius: '0.5rem' }}>
        <h2>Hello {user.value.name}</h2>
        <p>This element's parent is document.body. Its owner is still App.</p>
        <button onClick={props.onClose}>close</button>
      </div>
    </div>
  );
});

const App = component(() => {
  const open = signal(false);
  provide(UserContext, { name: 'Ada' });

  return (
    <>
      <h1>Portal</h1>
      <p>
        <button
          onClick={() => {
            open.value = true;
          }}
        >
          open modal
        </button>
      </p>
      {open.value &&
        portal(
          <Modal
            onClose={() => {
              open.value = false;
            }}
          />,
          document.body,
        )}
    </>
  );
});

// No container argument and no element lookup: `render` mounts into
// `document.body` by default.
render(() => <App />);
