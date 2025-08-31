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
  title: string;
}

export const TestCardStat = () => {
  const {
    testResult: { stat },
  } = useTestContext();

  const StatItem = ({ id, title }: StatItemProps) => {
    const { formatted, level } = getFormatted(stat, id);

    return (
      <Stat.Root size={'md'}>
        <Stat.Label>{title}</Stat.Label>
        <Stat.ValueText color={getColorByLevel(level)}>
          {formatted}
        </Stat.ValueText>
      </Stat.Root>
    );
  };

  return (
    <SimpleGrid columns={{ base: 4, md: 8 }} p={4}>
      <StatItem id="netProfit" title="P&L" />
      <StatItem id="minAmount" title="Min Amount" />
      <StatItem id="maxDrawdown" title="Drawdown" />
      <StatItem id="orders" title="Orders" />
      <StatItem id="winRate" title="Win Rate" />
      <StatItem id="riskRewardRatio" title="Risk Ratio" />
      <StatItem id="sharpeRatio" title="Sharpe" />
      <StatItem id="exposure" title="Exposure" />
    </SimpleGrid>
  );
};
