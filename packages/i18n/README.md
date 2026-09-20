# @firsthandjs/i18n

Makes a translation function reactive: switch the language and every translated
part on the page updates, without a re-render, a provider or a context.

**Documentation:** [guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/12-internationalisation.md) · [API reference](https://github.com/firsthandjs/firsthand/blob/main/docs/reference/i18n.md) · [all docs](https://github.com/firsthandjs/firsthand/blob/main/docs/README.md)

```
npm install @firsthandjs/i18n
```

0.38 kB gzip. It depends on `@firsthandjs/core` and on nothing else — not even
on i18next, whose shape it describes structurally rather than importing.

```ts
import i18next from 'i18next';
import { fromI18next } from '@firsthandjs/i18n';

await i18next.init({ lng: 'en', resources });
export const { t, language } = fromI18next(i18next);
```

```tsx
<h1>{t('greeting', { name: 'Ada' })}</h1>
```

That `h1` re-reads when the language changes, and so does every other part that
called `t` — and nothing else does.

i18next, FormatJS, Lingui and Polyglot all work in this framework already; they
are plain JavaScript. What none of them can do is tell the reactive graph that
the answer changed, so a label rendered before the switch keeps its old text.
This package is the connection and nothing more: there is no dictionary here,
no plural rules and no date formatting, because the libraries that do those
things are good at them.

`translator()` adapts anything with a `t`, a current language and a way to
subscribe. `fromI18next()` is that adapter for i18next, listening on the
instance _and_ on its resource store — a namespace that arrives late, or a key
added at runtime, changes the answer as surely as a language switch does.

MIT licensed.
