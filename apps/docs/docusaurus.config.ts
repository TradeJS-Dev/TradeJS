import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'TradeJS Docs',
  tagline: 'Knowledge base for TradeJS',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docs.tradejs.dev',
  baseUrl: '/',

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
          type: 'doc',
          docId: 'intro',
          position: 'left',
          label: 'Getting started',
        },
        {
          type: 'doc',
          docId: 'strategies/authoring/write-strategies',
          position: 'left',
          label: 'Strategies',
        },
        {
          type: 'doc',
          docId: 'indicators/authoring',
          position: 'left',
          label: 'Indicators',
        },
        {
          type: 'doc',
          docId: 'runtime/backtesting/overview',
          position: 'left',
          label: 'Backtesting',
        },
        {
          type: 'doc',
          docId: 'runtime/execution/signals',
          position: 'left',
          label: 'Runtime',
        },
        {
          type: 'doc',
          docId: 'ai-ml/ml/configuration',
          position: 'left',
          label: 'ML',
        },
        {
          type: 'doc',
          docId: 'ai-ml/ai/configuration',
          position: 'left',
          label: 'AI',
        },
        {
          type: 'doc',
          docId: 'operations/production-runbook',
          position: 'left',
          label: 'Operations',
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
            { label: 'Overview', to: '/' },
            { label: 'Quickstart', to: '/getting-started/quickstart' },
            { label: 'Root User Setup', to: '/getting-started/root-user' },
          ],
        },
        {
          title: 'Authoring',
          items: [
            { label: 'Core API', to: '/api/framework' },
            {
              label: 'Creating Strategies',
              to: '/strategies/authoring/write-strategies',
            },
            { label: 'Writing Indicators', to: '/indicators/authoring' },
          ],
        },
        {
          title: 'Operations',
          items: [
            { label: 'CLI API', to: '/api/cli' },
            { label: 'Production Runbook', to: '/operations/production-runbook' },
            { label: 'Monitoring', to: '/operations/monitoring-alerts' },
            { label: 'Backup and Restore', to: '/operations/backup-restore' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} TradeJS`,
    },
    prism: {
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
