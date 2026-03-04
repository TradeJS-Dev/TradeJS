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

  url: 'https://docs.aleksnick01inv.fvds.ru',
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
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'All Docs',
        },
        {
          type: 'doc',
          docId: 'getting-started/local',
          position: 'left',
          label: 'Start',
        },
        {
          type: 'doc',
          docId: 'strategies/authoring/write-strategies',
          position: 'left',
          label: 'Strategies',
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
          docId: 'indicators/authoring',
          position: 'left',
          label: 'Indicators',
        },
        {
          type: 'doc',
          docId: 'ai-ml/ml/configuration',
          position: 'left',
          label: 'ML/AI',
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
            { label: 'Local Setup', to: '/getting-started/local' },
            { label: 'Self-Hosted', to: '/getting-started/self-hosted' },
            { label: 'Cloud', to: '/getting-started/cloud' },
          ],
        },
        {
          title: 'Core Docs',
          items: [
            { label: 'Framework API', to: '/api/framework' },
            { label: 'CLI API', to: '/api/cli' },
            {
              label: 'Creating Strategies',
              to: '/strategies/authoring/write-strategies',
            },
            { label: 'Writing Indicators', to: '/indicators/authoring' },
          ],
        },
        {
          title: 'Runtime',
          items: [
            { label: 'Backtesting', to: '/runtime/backtesting/overview' },
            { label: 'Signals', to: '/runtime/execution/signals' },
            { label: 'ML', to: '/ai-ml/ml/configuration' },
            { label: 'AI', to: '/ai-ml/ai/configuration' },
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
