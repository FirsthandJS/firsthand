/**
 * The real i18next, not a stand-in.
 *
 * The other suite asserts the wiring against a fake with i18next's shape,
 * which is the right way to test this package. This one asserts the claim on
 * the box — that i18next works — against the library itself, because a claim
 * of compatibility that nothing exercises is a claim about a fake.
 */
import { describe, expect, it } from 'vitest';
import { createRoot, effect } from '@firsthandjs/core';
import { fromI18next } from '@firsthandjs/i18n';
import i18next from 'i18next';

/** A fresh instance per test: i18next's default export is a singleton. */
async function instance(resources: Record<string, Record<string, Record<string, string>>>) {
  const created = i18next.createInstance();
  await created.init({ lng: 'en', fallbackLng: false, resources });
  return created;
}

describe('i18next', () => {
  it('follows a language change into the graph', async () => {
    const i18n = await instance({
      en: { translation: { greeting: 'Hello {{name}}' } },
      de: { translation: { greeting: 'Hallo {{name}}' } },
    });
    const { t, language, dispose } = fromI18next(i18n);
    const seen: unknown[] = [];

    const stop = createRoot((stopRoot) => {
      effect(() => {
        seen.push(`${language.value}: ${t('greeting', { name: 'Ada' })}`);
      });
      return stopRoot;
    });
    expect(seen).toEqual(['en: Hello Ada']);

    await i18n.changeLanguage('de');

    // One entry, not two: the language and the translation change together.
    expect(seen).toEqual(['en: Hello Ada', 'de: Hallo Ada']);

    stop();
    dispose();
  });

  it('recovers when a namespace is added after the first read', async () => {
    const i18n = await instance({ en: { translation: {} } });
    const { t, dispose } = fromI18next(i18n);
    const seen: unknown[] = [];

    const stop = createRoot((stopRoot) => {
      effect(() => {
        seen.push(t('late'));
      });
      return stopRoot;
    });
    // Missing, so i18next answers with the key itself.
    expect(seen).toEqual(['late']);

    i18n.addResource('en', 'translation', 'late', 'Arrived');

    expect(seen).toEqual(['late', 'Arrived']);

    stop();
    dispose();
  });

  it('keeps i18next own behaviour: interpolation, plurals, namespaces', async () => {
    const i18n = await instance({
      en: {
        translation: { item_one: '{{count}} item', item_other: '{{count}} items' },
        menu: { open: 'Open' },
      },
    });
    const { t, dispose } = fromI18next(i18n);

    expect(t('item', { count: 1 })).toBe('1 item');
    expect(t('item', { count: 4 })).toBe('4 items');
    expect(t('menu:open')).toBe('Open');

    dispose();
  });
});
