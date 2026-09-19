# Web components

[Index](../README.md) · Previous: [Data](09-data.md) · Next:
[React interop](11-react-interop.md)

---

Two directions: using somebody's custom elements, and publishing your own.

## Using them

A custom element is an element, so there is no adapter, no wrapper package and
nothing to configure:

```tsx
import '@shoelace-style/shoelace/dist/components/switch/switch.js';

<sl-switch
  checked={dark.value}
  on:sl-change={(event) => (dark.value = event.currentTarget.checked)}
>
  Dark
</sl-switch>;
```

Shoelace, Material Web, Fluent, Vaadin and Carbon all work this way.
[`integrations/interop`](../../integrations/interop/) builds a page with one of
them and drives it in a browser.

Three things to know:

**Properties versus attributes.** A name the element has as a property is set
as one, which is how objects and arrays reach a custom element intact. Force
either with `prop:` or `attr:`:

```tsx
<my-grid prop:rows={rows.value} attr:density="compact" />
```

**Events with hyphens** need the literal form, because no casing of an
identifier produces `sl-change`:

```tsx
<sl-input on:sl-input={(event) => …} />
```

**Upgrade timing does not matter.** Set a property before the element is
defined and the element picks it up when it upgrades, as long as the library
follows the usual pattern. If one does not, set it in a `ref` callback.

### Types

Custom elements are accepted by the JSX types through a pattern: any tag with a
hyphen takes the standard attributes plus `data-*`, `aria-*` and the escapes.
For real typing, declare it:

```ts
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'sl-switch': { checked?: boolean; children?: unknown; 'on:sl-change'?: (e: Event) => void };
    }
  }
}
```

## Publishing your own

Components are **hostless** by default: `<Counter />` produces what the
component returned, with no wrapper element. Opt into a custom element when
something outside your application needs to use it:

```tsx
const UserCard = component<{ user: User }>(({ user }) => <article>{user.name}</article>, {
  tag: true,
});
```

That registers `<my-app-user-card>`, deriving the name from the binding and the
`packageName` you gave the compiler — there is no name string to repeat and
nothing to keep in sync.

```html
<my-app-user-card></my-app-user-card>
<script type="module">
  document.querySelector('my-app-user-card').user = { name: 'Ada' };
</script>
```

Props arrive as **properties**, so a consumer can pass an object without
serialising it. For consumers writing plain HTML, declare attribute codecs:

```tsx
const Badge = component<{ count: number }>(({ count }) => <b>{count}</b>, {
  tag: true,
  attributes: { count: (raw) => Number(raw ?? 0) },
});
```

```html
<my-app-badge count="7"></my-app-badge>
```

Each declared attribute is observed, and a change writes the corresponding
signal — so the element updates the same way a prop does.

### Shadow DOM

```tsx
const Widget = component(setup, { shadow: true }); // implies tag: true
```

Styles in the document do not reach inside, and styles inside do not leak out.
Put a `<style>` element in the component, or adopt a constructable stylesheet.
`@firsthandjs/styled` writes into the document head, so its rules do **not** cross
into a shadow root.

Light DOM is the default because encapsulation is a trade, not a free win:
global styles, third-party CSS and `querySelector` from outside all stop
working at the boundary
([ADR-0007](../adr/0007-light-dom-default.md)).

### What it costs

An element host costs about **1.5× mount time and twice the DOM nodes**
compared to a hostless component — measured, not estimated
([ADR-0003](../adr/0003-hostless-components-with-optional-custom-element.md)).
Use it where the boundary is worth that: a widget embedded in someone else's
page, a design system consumed by other frameworks, an island in a
server-rendered application. Do not use it for every component in your own
application.

### Registering by hand

```ts
import { defineElement, setElementPrefix } from '@firsthandjs/dom';

setElementPrefix('acme'); // once, at startup
const tag = defineElement(UserCard); // 'acme-user-card'
defineElement(UserCard, 'acme-card'); // or choose it
```

`defineElement` is idempotent and returns the registered name. If the name is
taken, it disambiguates with the component's stable build id rather than
throwing.

---

Next: [React interop](11-react-interop.md).
