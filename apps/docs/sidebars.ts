import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/local',
        'getting-started/root-user',
        'getting-started/self-hosted',
        'getting-started/cloud',
      ],
    },
    {
      type: 'category',
      label: 'APIs',
      items: ['framework/api', 'cli/api'],
    },
    {
      type: 'category',
      label: 'Strategies',
      items: [
        'strategies/write-strategies',
        'strategies/ma-strategy-step-by-step',
        'strategies/pine-strategy-step-by-step',
        'strategies/debug-live',
        'strategies/risk-management',
        'strategies/pre-live-checklist',
        'strategies/plugin-e2e',
      ],
    },
    {
      type: 'category',
      label: 'Indicators',
      items: ['indicators/write-indicators', 'indicators/pine-indicators'],
    },
    {
      type: 'category',
      label: 'Runtime',
      items: [
        'runtime/backtesting',
        'runtime/signals',
        'runtime/telegram-notifications',
      ],
    },
    {
      type: 'category',
      label: 'ML',
      items: [
        'ml/configuration',
        'ml/feature-engineering-cookbook',
        'ml/model-promotion-policy',
      ],
    },
    {
      type: 'category',
      label: 'AI',
      items: [
        'ai/configuration',
        'ai/prompt-governance',
        'ai/offline-gating-eval',
      ],
    },
    {
      type: 'category',
      label: 'Operations',
      items: [
        'operations/env-reference',
        'operations/redis-data-model',
        'operations/timescale-schema',
        'operations/production-runbook',
        'operations/monitoring-alerts',
        'operations/backup-restore',
        'operations/cloud-blueprint',
        'operations/security-hardening',
      ],
    },
  ],
};

export default sidebars;
