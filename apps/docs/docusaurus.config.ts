import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'TradeJS Docs',
  tagline: 'Knowledge base for the TradeJS framework',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://aleksnick01inv.fvds.ru',
  baseUrl: '/docs/',

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ru'],
    localeConfigs: {
      en: {
        label: 'English',
        htmlLang: 'en-US',
      },
      ru: {
        label: 'Русский',
        htmlLang: 'ru-RU',
      },
    },
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'TradeJS Docs',
      logo: {
        alt: 'TradeJS',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          type: 'localeDropdown',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Getting Started',
          items: [
            { label: 'Local Setup', to: '/getting-started/local' },
            { label: 'Self-Hosted', to: '/getting-started/self-hosted' },
            { label: 'Cloud', to: '/getting-started/cloud' },
          ],
        },
        {
          title: 'Core Docs',
          items: [
            { label: 'Framework API', to: '/framework/api' },
            { label: 'CLI API', to: '/cli/api' },
            { label: 'Writing Strategies', to: '/strategies/write-strategies' },
          ],
        },
        {
          title: 'Runtime',
          items: [
            { label: 'Backtesting', to: '/runtime/backtesting' },
            { label: 'Signals', to: '/runtime/signals' },
            { label: 'ML', to: '/ml/configuration' },
            { label: 'AI', to: '/ai/configuration' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} TradeJS`,
    },
    prism: {
      theme: prismThemes.dracula,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
