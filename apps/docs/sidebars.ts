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
      label: 'API',
      collapsed: false,
      items: [
        'api/framework',
        {
          type: 'category',
          label: 'Runtime',
          items: ['runtime/execution/strategy-hooks'],
        },
        {
          type: 'category',
          label: 'Strategies',
          items: [
            {
              type: 'category',
              label: 'Authoring',
              items: [
                'strategies/authoring/write-strategies',
                'strategies/authoring/ma-strategy-step-by-step',
                'strategies/authoring/pine-strategy-step-by-step',
                'strategies/authoring/plugin-e2e',
              ],
            },
            {
              type: 'category',
              label: 'Built-In Strategies',
              items: [
                'strategies/reference/trendline',
                'strategies/reference/breakout',
                'strategies/reference/ma-strategy',
                'strategies/reference/volume-divergence',
                'strategies/reference/adaptive-momentum-ribbon',
              ],
            },
            {
              type: 'category',
              label: 'Validation and Live Ops',
              items: [
                'strategies/operations/risk-management',
                'strategies/operations/pre-live-checklist',
                'strategies/operations/debug-live',
              ],
            },
          ],
        },
        {
          type: 'category',
          label: 'Indicators',
          items: [
            'indicators/authoring',
            'indicators/pine',
            'indicators/catalog',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'CLI',
      collapsed: false,
      items: [
        'api/cli',
        {
          type: 'category',
          label: 'Runtime and Signals',
          items: [
            'runtime/execution/signals',
            'runtime/execution/multi-strategy-signals',
            'runtime/execution/telegram-notifications',
          ],
        },
        {
          type: 'category',
          label: 'Backtesting',
          items: [
            'runtime/backtesting/overview',
            'runtime/backtesting/grid-config',
            'runtime/backtesting/results-runtime-config',
            'runtime/backtesting/strategy-playbook',
          ],
        },
        {
          type: 'category',
          label: 'ML Pipeline',
          items: ['ai-ml/ml/inspect', 'ai-ml/ml/train-latest-select'],
        },
        {
          type: 'category',
          label: 'Data and Maintenance',
          items: [
            'runtime/data/continuity-update-history',
            'operations/derivatives-ingest',
            'operations/maintenance-cli-scripts',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'AI',
      items: [
        'ai-ml/ai/configuration',
        'ai-ml/ai/prompt-governance',
        'ai-ml/ai/offline-gating-eval',
      ],
    },
    {
      type: 'category',
      label: 'ML',
      items: [
        'ai-ml/ml/configuration',
        'ai-ml/ml/infer-service',
        'ai-ml/ml/feature-engineering-cookbook',
        'ai-ml/ml/model-promotion-policy',
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
