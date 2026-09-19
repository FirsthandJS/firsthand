/**
 * A todo list: keyed rows, derived state and a filter.
 *
 * The interesting part is what does *not* happen. Toggling one item updates
 * that item's class and the counters that read it. The other rows are not
 * touched, their DOM nodes are not re-created, and no component function runs
 * a second time.
 */
import { component, computed, render, signal } from '@firsthandjs/dom';

type Todo = { id: number; title: string; done: boolean };
type Filter = 'all' | 'open' | 'done';

let nextId = 1;
const todos = signal<Todo[]>([
  { id: nextId++, title: 'Read the architecture notes', done: true },
  { id: nextId++, title: 'Write a component', done: false },
  { id: nextId++, title: 'Measure before claiming', done: false },
]);
const filter = signal<Filter>('all');
const draft = signal('');

const remaining = computed(() => todos.value.filter((todo) => !todo.done).length);
const visible = computed(() =>
  todos.value.filter((todo) =>
    filter.value === 'all' ? true : filter.value === 'done' ? todo.done : !todo.done,
  ),
);

const toggle = (id: number): void => {
  todos.value = todos.value.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo));
};
const remove = (id: number): void => {
  todos.value = todos.value.filter((todo) => todo.id !== id);
};
const add = (): void => {
  const title = draft.value.trim();
  if (title !== '') {
    todos.value = [...todos.value, { id: nextId++, title, done: false }];
    draft.value = '';
  }
};

const Row = component((props: { todo: Todo }) => (
  <li class={props.todo.done ? 'done' : undefined}>
    <label>
      <input
        type="checkbox"
        checked={props.todo.done}
        onChange={() => {
          toggle(props.todo.id);
        }}
      />
      {props.todo.title}
    </label>
    <button
      onClick={() => {
        remove(props.todo.id);
      }}
    >
      remove
    </button>
  </li>
));

const FilterButton = component((props: { value: Filter; label: string }) => (
  <button
    aria-pressed={filter.value === props.value ? 'true' : 'false'}
    onClick={() => {
      filter.value = props.value;
    }}
  >
    {props.label}
  </button>
));

const App = component(() => (
  <>
    <h1>Todo</h1>
    <p>
      <input
        type="text"
        value={draft.value}
        placeholder="What needs doing?"
        onInput={(event) => {
          // `currentTarget` is typed as the element the handler is on, so
          // reading `.value` needs no cast.
          draft.value = event.currentTarget.value;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            add();
          }
        }}
      />
      <button onClick={add}>add</button>
    </p>
    <p>
      <FilterButton value="all" label="all" />
      <FilterButton value="open" label="open" />
      <FilterButton value="done" label="done" />
      {' — '}
      {remaining.value} open of {todos.value.length}
    </p>
    <ul>
      {visible.value.map((todo) => (
        <Row key={todo.id} todo={todo} />
      ))}
    </ul>
  </>
));

// No container argument and no element lookup: `render` mounts into
// `document.body` by default.
render(() => <App />);
