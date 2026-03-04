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
        'strategies/strategy-trendline',
        'strategies/strategy-breakout',
        'strategies/strategy-ma-strategy',
        'strategies/strategy-volume-divergence',
        'strategies/strategy-adaptive-momentum-ribbon',
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
      items: [
        'indicators/write-indicators',
        'indicators/pine-indicators',
        'indicators/indicator-catalog',
      ],
    },
    {
      type: 'category',
      label: 'Runtime',
      items: [
        'runtime/backtesting',
        'runtime/backtest-grid-config',
        'runtime/backtest-results-runtime-config',
        'runtime/strategy-playbook',
        'runtime/data-continuity-update-history',
        'runtime/signals',
        'runtime/multi-strategy-signals',
        'runtime/telegram-notifications',
      ],
    },
    {
      type: 'category',
      label: 'ML',
      items: [
        'ml/configuration',
        'ml/ml-inspect',
        'ml/ml-train-latest-select',
        'ml/ml-infer-service',
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
        'operations/add-exchange-connector',
        'operations/derivatives-ingest',
        'operations/maintenance-cli-scripts',
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
