import type { StorybookConfig } from '@storybook/html-vite';
import { firsthand } from '@firsthandjs/compiler/vite';
import { graphql } from '@firsthandjs/data/vite';

/**
 * Storybook, configured for Firsthand.
 *
 * Two lines that are not boilerplate: the Firsthand compiler plugin and the
 * `.graphql` loader. Both are `enforce: 'pre'`, so they see the source before
 * anything else does; nothing has to be said about JSX, because after the
 * compiler there is none left. Everything else is the stock HTML renderer.
 */
const config: StorybookConfig = {
  framework: '@storybook/html-vite',
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  viteFinal: (config) => ({
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      firsthand({ packageName: 'firsthand-stories' }),
      // Turns a `.graphql` import into its parsed document at build time.
      graphql(),
    ],
  }),
};

export default config;
