import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Getting started',
      collapsed: false,
      items: [
        'intro',
        'getting-started/quickstart',
        'getting-started/root-user',
      ],
    },
    {
      type: 'category',
      label: 'Strategies',
      items: [
        {
          type: 'category',
          label: 'Authoring',
          items: [
            'api/framework',
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
      items: ['indicators/authoring', 'indicators/pine', 'indicators/catalog'],
    },
    {
      type: 'category',
      label: 'Backtesting',
      items: [
        {
          type: 'category',
          label: 'Workflow',
          items: [
            'runtime/backtesting/overview',
            'runtime/backtesting/grid-config',
            'runtime/backtesting/results-runtime-config',
          ],
        },
        {
          type: 'category',
          label: 'Playbook',
          items: ['runtime/backtesting/strategy-playbook'],
        },
      ],
    },
    {
      type: 'category',
      label: 'Runtime',
      items: [
        {
          type: 'category',
          label: 'Signals',
          items: [
            'runtime/execution/signals',
            'runtime/execution/multi-strategy-signals',
            'runtime/execution/telegram-notifications',
          ],
        },
        {
          type: 'category',
          label: 'Hooks and Data',
          items: [
            'runtime/execution/strategy-hooks',
            'runtime/data/continuity-update-history',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'ML',
      items: [
        'ai-ml/ml/configuration',
        'ai-ml/ml/inspect',
        'ai-ml/ml/train-latest-select',
        'ai-ml/ml/infer-service',
        'ai-ml/ml/feature-engineering-cookbook',
        'ai-ml/ml/model-promotion-policy',
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
      label: 'Operations',
      items: [
        'api/cli',
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
