'use client';

import { SimpleGrid, Stat } from '@chakra-ui/react';
import { getFormatted } from '@utils/stat';
import { useTestContext } from '../context';
import { ThresholdLevel, TestThresholdsKey } from '@types';

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
  id: TestThresholdsKey;
  description: string;
}

export const TestCardStat = () => {
  const {
    testResult: { stat, test, orderLog },
  } = useTestContext();

  const StatItem = ({ id, description }: StatItemProps) => {
    const { formatted, level } = getFormatted(stat, id);

    return (
      <Stat.Root size={'md'}>
        <Stat.Label>{description}</Stat.Label>
        <Stat.ValueText color={getColorByLevel(level)}>
          {formatted}
        </Stat.ValueText>
      </Stat.Root>
    );
  };

  return (
    <SimpleGrid columns={{ base: 3, md: 9 }} p={4}>
      <StatItem id="netProfit" description="Net Profit" />
      <StatItem id="minAmount" description="Min Amount" />
      <StatItem id="maxDrawdown" description="Drawdown" />
      <StatItem id="orders" description="Orders" />
      <StatItem id="winRate" description="Win Rate" />
      <StatItem id="riskRewardRatio" description="Risk Ratio" />
      <StatItem id="sharpeRatio" description="Sharpe" />
      <StatItem id="sortinoRatio" description="Sortino" />
      <StatItem id="exposure" description="Exposure" />
    </SimpleGrid>
  );
};
