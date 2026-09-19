# Rendering

[Index](../README.md) · Previous: [Components](03-components.md) · Next:
[Context and lifecycle](05-context-and-lifecycle.md)

---

## Text and attributes

Any expression in a child position becomes a text node that updates on its own:

```tsx
<p>
  {count.value} items, {user.value.name} is logged in
</p>
```

Attributes are the same, with the right kind of write chosen at compile time:

```tsx
<input value={text.value} disabled={busy.value} class={active.value ? 'on' : 'off'} />
```

- `value` and `disabled` are DOM **properties**, because that is what they are.
- `class` accepts a string or a record: `class={{ on: active.value, big: true }}`
  toggles only what changed.
- `style` accepts a string or a record, and a record may hold custom
  properties: `style={{ '--accent': hue.value }}`.
- Unknown names become attributes, and `data-*` / `aria-*` always do.

Escape hatches when the guess is wrong:

```tsx
<div prop:innerHTML={html.value} />   {/* a property, explicitly */}
<div attr:value={text.value} />       {/* an attribute, explicitly */}
```

Values are written as text, never parsed as HTML — `{userInput}` cannot
introduce markup. `prop:innerHTML` is the documented exception, and it is your
responsibility.

## Conditionals

Ordinary JavaScript:

```tsx
<div>
  {error.value !== null ? <Alert message={error.value} /> : null}
  {items.value.length === 0 && <Empty />}
</div>
```

The branch is re-evaluated when what it read changes, and only then. A
component in the branch that goes away is disposed: its effects unsubscribe and
its cleanups run.

For more than two branches, a lookup reads better than nested ternaries:

```tsx
const VIEWS = { list: List, grid: Grid, table: Table };

<div>{VIEWS[mode.value]({})}</div>;
```

## Lists

A `.map()` with a `key` compiles into a keyed list part:

```tsx
<ul>
  {todos.value.map((todo) => (
    <TodoRow key={todo.id} todo={todo} />
  ))}
</ul>
```

What the key buys you:

- rows keep their DOM nodes, their component state and their owners across a
  reorder — only `insertBefore` calls are issued;
- a row whose data changed is **updated in place**, because the compiler turns
  the callback's item parameter into a live read;
- removing a row disposes exactly that row.

Without a key, the array is reconciled by node identity, which for freshly
created nodes means "replace". That is the documented cost of leaving it out.

Duplicate keys warn and drop the duplicate rather than corrupting the DOM.

The reconciliation algorithm was chosen by measuring three candidates over ten
operations at two sizes — see
[ADR-0010](../adr/0010-list-reconciliation-decided-by-measurement.md).

### Lists of plain values

```tsx
{
  tags.value.map((name) => <span key={name}>{name}</span>);
}
```

The key must be stable and unique. An index works only if the list is never
reordered or spliced.

## Fragments

```tsx
<>
  <dt>{term.value}</dt>
  <dd>{definition.value}</dd>
</>
```

A fragment produces its children with no wrapper element. Dynamic children of a
fragment are anchored where they were written and bound under the scope that
wrote them, so context and disposal stay lexical.

## Portals

Render somewhere else in the document while staying in the component tree:

```tsx
import { portal } from '@firsthandjs/dom';

const Modal = component<{ children?: View }>((props) => {
  const theme = useContext(ThemeContext); // still the theme from *here*

  return portal(() => <div class={`modal ${theme.value}`}>{props.children}</div>, document.body);
});
```

Context, disposal and error boundaries follow the component tree, not the DOM
tree — that is what the owner tree is for
([ADR-0008](../adr/0008-owner-tree-for-context-and-portals.md)). Closing the
component removes the portalled nodes.

## Refs

```tsx
let input!: HTMLInputElement;

<input ref={(element) => (input = element)} />;
```

The callback runs once, with the element, as it is created. For something that
needs the element to be connected, do it in an effect:

```tsx
<input
  ref={(element) => {
    effect(() => {
      if (focused.value) element.focus();
    });
  }}
/>
```

## Raw nodes

Anything that is already a `Node` can be rendered:

```tsx
const chart = document.createElement('canvas');
drawInto(chart);

<figure>{chart}</figure>;
```

This is how you embed a library that owns its own DOM — a chart, a map, an
editor. Dispose it with `onCleanup`.

## What a child position accepts

`string`, `number`, `boolean`, `null`, `undefined`, a `Node`, an array of any
of those, or a function returning one. `null`, `undefined` and booleans render
nothing, which is what makes `{condition && <Thing />}` work.

---

Next: [Context and lifecycle](05-context-and-lifecycle.md) — sharing values,
cleaning up, and catching errors.
