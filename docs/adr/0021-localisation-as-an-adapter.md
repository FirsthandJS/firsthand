# ADR-0021: Localisation as an adapter, not a library

**Status:** accepted · 2026-09-20

## Problem

i18next, FormatJS, Lingui and Polyglot all work in this framework already.
They are plain JavaScript, and nothing stops a component calling
`t('greeting')`.

What none of them can do is tell the reactive graph that the answer changed:

```tsx
const Header = component(() => <h1>{t('greeting')}</h1>);
// i18next.changeLanguage('de') — and the h1 still says "Hello"
```

A component runs once, so the call happens once. In a framework that
re-renders, a language switch is a state change and everything runs again; here
it has to be a signal, or it is nothing. That is not a bug in i18next, and it
is not something i18next can fix.

The requirement was **full compatibility with i18next or another common
localisation library** — not a translation library of our own.

## Constraints

- The library's `t` keeps **its own types**. A typed i18next resource table
  gives key autocomplete and interpolation types, and a wrapper that erases
  them would be a downgrade disguised as an integration.
- No dependency on i18next. Its version should not be able to break this
  package, and a fork, `createInstance()` or a test double must all work.
- An application that does not translate anything pays nothing.
- A language change must update every translated part **once**, including a
  part that reads the current locale beside a translated string.
- It must survive the case that actually goes wrong in production: a namespace
  that arrives late.

## Options

1. **A translation library of our own.** Dictionaries, plural rules, date and
   number formatting, a message parser. Months of work to arrive behind
   libraries that are good, mature and already installed — and an ICU
   implementation that is 95 % correct is worse than none.
2. **A component or a provider.** `<Trans>`, or a context holding the
   translator. It is the React shape, and it does not fit: context here is not
   what makes something re-run, and a component per translated string is a lot
   of machinery to re-read one function.
3. **Make the existing function reactive.** A version cell, and a wrapper that
   reads it before calling through.

## Chosen design

Option 3. `translator(source)` takes three things — the library's `t`, a way to
read the current language, and a way to subscribe — and returns a `t` that
subscribes whatever reads it.

```ts
const t = ((...args) => {
  version.value; // reading it is the subscription
  return source.translate(...args);
}) as T;
```

The cast is the point: the returned function has the parameter and return types
of the one that was passed, because it _is_ that function with a read in front
of it.

`fromI18next(instance)` is that adapter for i18next, and it listens to four
events rather than one:

| Event             | Announced on       | Why it matters                 |
| ----------------- | ------------------ | ------------------------------ |
| `languageChanged` | the instance       | the obvious one                |
| `loaded`          | the instance       | a backend finished a namespace |
| `added`           | the resource store | `addResource` at runtime       |
| `removed`         | the resource store | a resource taken away          |

The last two were found by testing against the real library rather than against
something shaped like it. i18next announces a _language_ change on the instance
and a _resource_ change on the store, so listening only to the instance leaves
a key rendered as itself — `nav.settings` on the screen — forever after the
namespace it belongs to arrives.

The i18next shape is declared **structurally** (`I18nextLike`), so the package
imports nothing from i18next and works with anything that looks like it.

## Performance

Two signals per translator, and one property read per `t()` call. A language
change writes both cells inside a `batch`, so a header that shows the locale
next to a translated title runs once rather than twice.

Nothing is added to the graph that was not already there: the cells are
ordinary signals, so tracking, the synchronous flush, disposal and `untrack`
behave exactly as they do everywhere else. There is no provider to walk and no
context lookup on the path to a translated string.

0.38 kB gzip, and only for an application that imports it.

## Memory

One translator holds two cells and one subscription. Created inside a component
or a root, the subscription is disposed with that scope through `onCleanup`;
created at module level — which is the normal case — nothing owns it and it
lives as long as the page, with `dispose` returned for the cases that do not.

`onCleanup` is registered only when `getOwner()` is non-null, because at module
level it would warn about a callback that can never run: a warning that is
right in general and wrong here.

## DX

Setting up is two lines and the call sites do not change:

```ts
export const { t, language } = fromI18next(i18next);
```

Existing code that already calls `t` keeps working, with its types, and starts
updating.

## Rejected alternatives

- **Our own translation library** (option 1). The scope is enormous, the
  existing libraries are good, and being 95 % correct about plural rules is
  worse than not being in that business.
- **A `<Trans>` component or a provider** (option 2). It imports a shape from
  React that this framework does not need: what makes something re-run here is
  reading a cell, not being underneath a provider.
- **Wrapping `t` in a new signature** — `t(key, values)` of our own. It would
  have cost the library's types, which for a typed resource table is most of
  what makes it pleasant to use.
- **Listening only to `languageChanged`.** Smaller, and wrong in exactly the
  case that is hardest to debug: a key that renders as itself and never
  recovers.
