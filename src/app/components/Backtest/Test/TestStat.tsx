'use client';

import { useContext } from 'react';
import { SimpleGrid, Stat } from '@chakra-ui/react';
import { getFormatted } from '@utils/stat';
import { TestContext } from './TestContext';
import { BacktestStat, ThresholdLevel, BacktestThresholds } from '@types';

const getColorByLevel = (level: ThresholdLevel) => {
  switch (level) {
    case 'success':
      return 'teal.500';
    case 'warning':
      return 'fg.warning';
    case 'error':
    default:
      return 'fg.error';
  }
};

interface StatItemProps {
  stat: BacktestStat;
  id: keyof BacktestThresholds;
  description: string;
}

const StatItem = ({ id, stat, description }: StatItemProps) => {
  const { formatted, level } = getFormatted(stat, id);

  return (
    <Stat.Root>
      <Stat.Label>{description}</Stat.Label>
      <Stat.ValueText color={getColorByLevel(level)}>
        {formatted}
      </Stat.ValueText>
    </Stat.Root>
  );
};

export const TestStat = () => {
  const { test } = useContext(TestContext);

  if (!test || !test.stat) {
    return null;
  }

  return (
    <SimpleGrid columns={{ base: 4, md: 8 }} p={4} mt={6}>
      <StatItem id="netProfit" description="Net Profit" stat={test.stat} />
      <StatItem id="minAmount" description="Min Amount" stat={test.stat} />
      <StatItem id="maxDrawdown" description="Max Drawdown" stat={test.stat} />
      <StatItem id="winRate" description="Win Rate" stat={test.stat} />
      <StatItem
        id="riskRewardRatio"
        description="Risk/Reward Ratio"
        stat={test.stat}
      />
      <StatItem id="sharpeRatio" description="Sharpe" stat={test.stat} />
      <StatItem id="sortinoRatio" description="Sortino" stat={test.stat} />
      <StatItem id="exposure" description="Exposure" stat={test.stat} />
    </SimpleGrid>
  );
};
