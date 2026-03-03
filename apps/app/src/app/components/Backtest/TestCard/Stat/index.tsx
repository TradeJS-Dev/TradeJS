'use client';

import { SimpleGrid, Stat, Card, Heading } from '@chakra-ui/react';
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
  size?: 'sm' | 'md' | 'lg';
  title: string;
}

const StatItem = ({ id, title, size = 'md' }: StatItemProps) => {
  const {
    testResult: { stat },
  } = useTestContext();

  const { formatted, level } = getFormatted(stat, id);

  return (
    <Stat.Root size={size}>
      <Stat.Label>{title}</Stat.Label>
      <Stat.ValueText color={getColorByLevel(level)}>
        {formatted}
      </Stat.ValueText>
    </Stat.Root>
  );
};

export const TestCardStatLine = () => {
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

export const TestCardStatTable = () => {
  return (
    <>
      <Card.Root bg="gray.900" mb={4} size="sm">
        <Card.Header>
          <Heading size="md">Period & Activity</Heading>
        </Card.Header>
        <Card.Body>
          <SimpleGrid columns={{ base: 2, md: 5 }} p={4}>
            <StatItem id="periodDays" title="Days" />
            <StatItem id="periodMonths" title="Months" />
            <StatItem id="orders" title="Orders" />
            <StatItem id="ordersPerMonth" title="Orders / month" />
            <StatItem id="exposure" title="Exposure" />
          </SimpleGrid>
        </Card.Body>
      </Card.Root>

      <Card.Root bg="gray.900" mb={4} size="sm">
        <Card.Header>
          <Heading size="md">Performance</Heading>
        </Card.Header>
        <Card.Body>
          <SimpleGrid columns={{ base: 2, md: 5 }} p={4}>
            <StatItem id="amount" title="Final amount" />
            <StatItem id="netProfit" title="Net P&L" />
            <StatItem id="totalReturn" title="Total return" />
            <StatItem id="cagr" title="CAGR" />
          </SimpleGrid>
        </Card.Body>
      </Card.Root>

      <Card.Root bg="gray.900" mb={4} size="sm">
        <Card.Header>
          <Heading size="md">Risk & Risk-Adjusted</Heading>
        </Card.Header>
        <Card.Body>
          <SimpleGrid columns={{ base: 2, md: 5 }} p={4}>
            <StatItem id="maxDrawdown" title="Max drawdown" />
            <StatItem id="calmar" title="Calmar" />
            <StatItem id="sharpeRatio" title="Sharpe" />
          </SimpleGrid>
        </Card.Body>
      </Card.Root>

      <Card.Root bg="gray.900" mb={4} size="sm">
        <Card.Header>
          <Heading size="md">Trade Quality & Consistency</Heading>
        </Card.Header>
        <Card.Body>
          <SimpleGrid columns={{ base: 2, md: 5 }} p={4}>
            <StatItem id="winRate" title="Win rate" />
            <StatItem id="riskRewardRatio" title="R/R (payoff)" />
            <StatItem id="expectancy" title="Expectancy / trade" />
            <StatItem id="maxConsecutiveWins" title="Win streak" />
            <StatItem id="maxConsecutiveLosses" title="Loss streak" />
          </SimpleGrid>
        </Card.Body>
      </Card.Root>
    </>
  );
};
