# Events and forms

[Index](../README.md) · Previous:
[Context and lifecycle](05-context-and-lifecycle.md) · Next:
[Styling](07-styling.md)

---

## Events

```tsx
<button onClick={() => count.value++}>Add</button>
```

The handler receives the **real** `Event` — real `target`, real
`currentTarget`, real `composedPath()`, real `preventDefault()`. There is no
synthetic event system and no wrapper object per dispatch.

`currentTarget` is typed as the element you put the handler on, so no cast is
needed to read its value:

```tsx
<input onInput={(event) => (text.value = event.currentTarget.value)} />
```

### Delegation

Common event types are delegated: one listener per type per mount root, with
the handler stored on the element. Mounting a thousand rows registers zero
listeners. Dispatch walks `composedPath()`, so it works through shadow roots
and portals.

It is measurably cheaper both to register and to dispatch
([ADR-0012](../adr/0012-native-events-with-delegation.md)) — a prediction the
benchmark reversed, which is written up in that ADR.

When you need a real listener on the element instead:

```tsx
<div onScroll:native={onScroll} />         {/* addEventListener on this element */}
<div onClick:capture={onCapture} />        {/* capture phase */}
<div onWheel:passive={onWheel} />          {/* any AddEventListenerOptions flag */}
```

### Event names with hyphens

`onSlChange` lowercases to `slchange`, and web-component libraries dispatch
`sl-change`. No casing of an identifier produces a hyphen, so there is a
literal form:

```tsx
<sl-switch on:sl-change={(event) => …} />
<vaadin-grid on:value-changed={(event) => …} />
```

Everything after `on:` is the event name exactly. JSX allows one colon in an
attribute name, so this form takes no modifier; use the camel-case form when
you need one.

### Imperatively

```ts
import { on, off } from '@firsthandjs/dom';

on(element, 'click', handler); // delegated when possible
on(element, 'click', handler, true); // force a direct listener
on(element, 'click', handler, { once: true });
off(element, 'click');
```

## Inputs

There is no two-way binding, because there is nothing to hide: an input has a
value and an event.

```tsx
const text = signal('');

<input value={text.value} onInput={(event) => (text.value = event.currentTarget.value)} />;
```

Checkboxes and radios use `checked`:

```tsx
<input
  type="checkbox"
  checked={done.value}
  onChange={(e) => (done.value = e.currentTarget.checked)}
/>
```

Selects work the same way, including multiple:

```tsx
<select value={sort.value} onChange={(event) => (sort.value = event.currentTarget.value)}>
  <option value="date">Date</option>
  <option value="title">Title</option>
</select>
```

### Uncontrolled inputs

Let the DOM hold the value and read it when you need it:

```tsx
let field!: HTMLInputElement;

<form
  onSubmit={(event) => {
    event.preventDefault();
    save(field.value);
  }}
>
  <input ref={(element) => (field = element)} defaultValue={initial} />
</form>;
```

## A form, end to end

```tsx
const SignUp = component(() => {
  const email = signal('');
  const password = signal('');
  const submitted = signal(false);

  // Validation is derived state, not an effect writing more state.
  const problems = computed(() => ({
    email: email.value.includes('@') ? null : 'That is not an email address.',
    password: password.value.length >= 8 ? null : 'At least eight characters.',
  }));
  const valid = computed(() => Object.values(problems.value).every((p) => p === null));

  const show = (field: 'email' | 'password') => submitted.value && problems.value[field];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submitted.value = true;
        if (valid.value) {
          void signUp({ email: email.value, password: password.value });
        }
      }}
    >
      <label>
        Email
        <input
          type="email"
          value={email.value}
          aria-invalid={show('email') !== null && show('email') !== false}
          onInput={(event) => (email.value = event.currentTarget.value)}
        />
        {show('email') !== null && show('email') !== false ? (
          <small class="error">{problems.value.email}</small>
        ) : null}
      </label>

      <label>
        Password
        <input
          type="password"
          value={password.value}
          onInput={(event) => (password.value = event.currentTarget.value)}
        />
        {show('password') !== null && show('password') !== false ? (
          <small class="error">{problems.value.password}</small>
        ) : null}
      </label>

      <button type="submit" disabled={submitted.value && !valid.value}>
        Sign up
      </button>
    </form>
  );
});
```

Two things worth noticing. Validation is a `computed`, so it is derived rather
than synchronised — there is no effect writing an `errors` state that could
disagree with the inputs. And typing in the email field updates the email
error, the disabled attribute and nothing else: the password label is not
touched.

## Form libraries

There is no form package, and the example above is why: a form is signals,
computeds and event handlers, and the framework already gives you those. What a
form library usually provides — dirty tracking, field arrays, schema validation
— is a few lines here, or a validation library you already like called from a
`computed`.

---

Next: [Styling](07-styling.md).
