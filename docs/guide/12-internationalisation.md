# Internationalisation

[Index](../README.md) · Previous: [React interop](11-react-interop.md) ·
Next: [Testing](13-testing.md)

---

i18next, FormatJS, Lingui and Polyglot already work here. They are plain
JavaScript, and nothing in this framework stops you calling `t('greeting')` in
a component.

What none of them can do is tell the reactive graph that the answer changed. A
component runs once, so `t('greeting')` is read once, and the label rendered
before the language switch keeps its old text. In a framework that re-renders,
the switch is a state change and everything runs again; here it has to be a
signal, or it is nothing.

`@firsthandjs/i18n` is that signal, and eleven lines around it.

```bash
npm install @firsthandjs/i18n i18next
```

## i18next in two lines

```ts
// src/i18n.ts
import i18next from 'i18next';
import { fromI18next } from '@firsthandjs/i18n';

await i18next.init({
  lng: 'en',
  resources: {
    en: { translation: { greeting: 'Hello, {{name}}' } },
    de: { translation: { greeting: 'Hallo, {{name}}' } },
  },
});

export const { t, language } = fromI18next(i18next);
```

```tsx
import { t, language } from './i18n';
import i18next from 'i18next';

const Header = component(() => (
  <header>
    <h1>{t('greeting', { name: 'Ada' })}</h1>
    <button onClick={() => void i18next.changeLanguage(language.value === 'en' ? 'de' : 'en')}>
      {language.value}
    </button>
  </header>
));
```

Switching the language re-runs the two parts that read a translation. Not the
component, not its children, not the page — the parts. That is the same
mechanism as any other signal, which is the point: translations are not a
special case that needs a provider of its own.

`t` keeps i18next's own types. If you have a typed resource table, the key
autocomplete and the interpolation types come with it, because the function is
called through rather than wrapped in a new signature.

## What changes a translation

More than the language, and this is the part that bites.

| What happened                  | Where i18next says so |
| ------------------------------ | --------------------- |
| The language changed           | The instance          |
| A backend finished a namespace | The instance          |
| `addResource` added a key      | The resource store    |
| A resource was removed         | The resource store    |

`fromI18next` listens to all four. Listening only to the instance is the common
mistake, and it has a recognisable symptom: a key that was not loaded yet
renders as itself — `nav.settings` on the screen instead of "Settings" — and
never recovers when the namespace arrives, because nothing told anyone.

## Any other library

`translator()` takes three things: the function, the current language, and a
way to subscribe.

```ts
import { translator } from '@firsthandjs/i18n';

export const { t, language } = translator({
  translate: (key: string, values?: Record<string, string>) => format(key, values),
  language: () => locale,
  subscribe: (changed) => {
    emitter.on('locale', changed);
    return () => emitter.off('locale', changed);
  },
});
```

Report anything that could change an answer. A wrong extra notification costs
one re-read of one part; a missing one leaves the wrong text on the screen.

## The language as a value

`language` is a cell, not a string, so it stays current where it is read:

```tsx
<html lang={language.value}>
```

A language change writes both cells in one batch, so a header showing the
locale next to a translated title updates once rather than twice.

## Cleaning up

A translator created inside a component is disposed with that component —
`onCleanup` is registered for you when there is a scope to register it with.

At module level, which is where an application normally sets its translations
up, nothing owns it and it lives as long as the page. That is correct, and it
is why `dispose` is returned rather than assumed:

```ts
const { t, dispose } = translator(source);
// … later, if this was a temporary one
dispose();
```

## What this is not

There is no dictionary here, no plural rules, no date or number formatting and
no message parser. Those libraries exist, they are good, and reimplementing
them badly would help nobody. This package connects them to the graph, and that
is all it will ever do.

Reference: [`@firsthandjs/i18n`](../reference/i18n.md).

---

Next: [Testing](13-testing.md).
