import { defineIndicatorPlugin } from '@tradejs/core/config';
import { type IndicatorPluginEntry } from '@tradejs/types';

const indicatorEntries = defineIndicatorPlugin({
  indicatorEntries: [
    {
      indicator: {
        id: 'sandboxDeterministicDrift',
        label: 'Sandbox Deterministic Drift',
        enabled: false,
      },
      historyKey: 'sandboxDeterministicDrift',
      compute: ({ data }) => {
        const last = data[data.length - 1];
        const previous = data[data.length - 2];

        if (!last || !previous || previous.close <= 0) {
          return null;
        }

        return ((last.close - previous.close) / previous.close) * 100;
      },
      renderer: {
        shortName: 'SBX DRIFT',
        minHeight: 120,
        figures: [
          {
            key: 'sandboxDeterministicDrift',
            title: 'Sandbox Drift: ',
            type: 'line',
            color: '#f59e0b',
          },
          {
            key: 'sandboxDeterministicDriftZero',
            title: 'Zero: ',
            type: 'line',
            color: '#64748b',
            dashed: true,
            constant: 0,
          },
        ],
      },
    } satisfies IndicatorPluginEntry,
  ],
}).indicatorEntries;

export { indicatorEntries };

export default defineIndicatorPlugin({ indicatorEntries });
