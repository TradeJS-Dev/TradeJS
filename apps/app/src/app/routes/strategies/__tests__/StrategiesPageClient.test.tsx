import { fireEvent, render, screen } from '@testing-library/react';
import {
  getAiStrategies,
  getReplayStrategies,
  getRuntimeStrategies,
} from '#actions/strategies';
import StrategiesPageClient from '../StrategiesPageClient';

jest.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

jest.mock('@chakra-ui/react', () => {
  const Container = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Box: Container,
    ClientOnly: Container,
    Flex: Container,
    Stack: Container,
  };
});

jest.mock('#shared/PageLayout', () => ({
  PageHeader: () => null,
  PageLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('#actions/strategies', () => ({
  getAiStrategies: jest.fn(),
  getReplayStrategies: jest.fn(),
  getRuntimeStrategies: jest.fn(),
}));

jest.mock('#components/Strategies/RuntimeStrategyCard', () => ({
  RuntimeStrategyCard: ({ strategy }: { strategy: { runtimeKey: string } }) => (
    <div>{strategy.runtimeKey}</div>
  ),
}));
jest.mock('#components/Strategies/RuntimeStrategyCardSkeleton', () => ({
  RuntimeStrategyCardSkeleton: () => null,
}));
jest.mock('#components/Strategies/StrategySnapshotList', () => ({
  StrategySnapshotList: ({
    strategies,
  }: {
    strategies: { cardId: string }[];
  }) => strategies.map(({ cardId }) => <div key={cardId}>{cardId}</div>),
}));
jest.mock('#actions/backtest', () => ({ deleteBacktest: jest.fn() }));
jest.mock('#store', () => ({
  useBacktestMutations: () => ({}),
  useTestList: () => ({
    tests: [
      {
        value: 'BTCUSDT_suiteA_test1',
        data: { strategyName: 'Trend', configId: 'config-1' },
      },
      {
        value: 'ETHUSDT_suiteA_test2',
        data: { strategyName: 'Trend', configId: 'config-2' },
      },
      {
        value: 'SOLUSDT_suiteB_test3',
        data: { strategyName: 'Trend', configId: 'config-1' },
      },
      {
        value: 'XRPUSDT_suiteA_test4',
        data: { strategyName: 'Other', configId: 'config-1' },
      },
    ],
  }),
}));
jest.mock('#components/Backtest/CompareList', () => ({
  CompareList: () => null,
}));
jest.mock('#components/Backtest/TestList', () => ({
  TestList: ({ tests }: { tests: { value: string }[] }) =>
    tests.map(({ value }) => <div key={value}>{value}</div>),
}));
jest.mock('#components/Shared/BulkSelection', () => ({
  BulkDeleteToolbar: () => null,
  useBulkSelection: () => ({
    clearSelection: jest.fn(),
  }),
}));
jest.mock('#ui', () => ({
  EmptyState: () => null,
  Segment: () => null,
  Select: ({
    placeholder,
    value,
    items,
    onChange,
  }: {
    placeholder: string;
    value: string[];
    items: { label: string; value: string }[];
    onChange: (values: string[]) => void;
  }) => (
    <select
      aria-label={placeholder}
      value={value[0]}
      onChange={(event) => onChange([event.target.value])}
    >
      {items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
  toaster: { error: jest.fn() },
}));

it.each([
  ['replay', getReplayStrategies],
  ['ai', getAiStrategies],
] as const)(
  'keeps the %s strategy filter through data loading and remount',
  async (mode, getStrategies) => {
    const strategy = 'Trend + Volume';
    const path = `/routes/strategies/${mode}`;
    window.history.replaceState(
      null,
      '',
      `${path}?strategy=Trend+%2B+Volume&view=compact#cards`,
    );
    jest.mocked(getStrategies).mockResolvedValue({
      strategies: [
        { cardId: 'matching-card', strategyName: strategy },
        { cardId: 'other-card', strategyName: 'Other' },
      ],
    } as Awaited<ReturnType<typeof getStrategies>>);

    const page = render(<StrategiesPageClient />);

    await screen.findByText('matching-card');
    expect(screen.queryByText('other-card')).toBeNull();

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: '__all__' },
    });
    expect(window.location.search).toBe('?view=compact');
    expect(window.location.hash).toBe('#cards');

    page.rerender(<StrategiesPageClient />);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: strategy },
    });
    expect(new URLSearchParams(window.location.search).get('strategy')).toBe(
      strategy,
    );

    page.unmount();
    render(<StrategiesPageClient />);

    await screen.findByText('matching-card');
    expect(screen.queryByText('other-card')).toBeNull();
  },
);

it('loads the runtime window and applies all runtime filters from the URL', async () => {
  window.history.replaceState(
    null,
    '',
    '/routes/strategies/runtime?hours=24&strategy=Trend&status=enabled&deployment=primary&universe=crypto',
  );
  const matching = {
    runtimeKey: 'matching-runtime',
    strategyName: 'Trend',
    enabled: true,
    deploymentId: 'primary',
    deploymentLabel: 'Primary',
    universe: 'crypto',
    stat: { netProfit: 1 },
  };
  jest.mocked(getRuntimeStrategies).mockResolvedValue({
    generatedAt: 1,
    hours: 24,
    strategies: [
      matching,
      { ...matching, runtimeKey: 'other-strategy', strategyName: 'Other' },
      { ...matching, runtimeKey: 'disabled', enabled: false },
      { ...matching, runtimeKey: 'other-deployment', deploymentId: 'test' },
      { ...matching, runtimeKey: 'other-universe', universe: 'stocks' },
    ],
  } as Awaited<ReturnType<typeof getRuntimeStrategies>>);

  render(<StrategiesPageClient />);

  await screen.findByText('matching-runtime');
  expect(getRuntimeStrategies).toHaveBeenCalledWith({ hours: 24 });
  for (const label of [
    'other-strategy',
    'disabled',
    'other-deployment',
    'other-universe',
  ]) {
    expect(screen.queryByText(label)).toBeNull();
  }
});

it('restores backtest filters and keeps the config when it is available in the new suite', () => {
  window.history.replaceState(
    null,
    '',
    '/routes/strategies/backtest?strategy=Trend&suite=suiteA&config=config-1',
  );

  const page = render(<StrategiesPageClient />);

  expect(screen.getByText('BTCUSDT_suiteA_test1')).toBeTruthy();
  expect(screen.queryByText('ETHUSDT_suiteA_test2')).toBeNull();
  expect(screen.queryByText('SOLUSDT_suiteB_test3')).toBeNull();
  expect(screen.queryByText('XRPUSDT_suiteA_test4')).toBeNull();

  fireEvent.change(screen.getByRole('combobox', { name: 'Test suite' }), {
    target: { value: 'suiteB' },
  });
  expect(window.location.search).toBe(
    '?strategy=Trend&suite=suiteB&config=config-1',
  );

  page.unmount();
  render(<StrategiesPageClient />);

  expect(screen.getByText('SOLUSDT_suiteB_test3')).toBeTruthy();
  expect(screen.queryByText('BTCUSDT_suiteA_test1')).toBeNull();
});
