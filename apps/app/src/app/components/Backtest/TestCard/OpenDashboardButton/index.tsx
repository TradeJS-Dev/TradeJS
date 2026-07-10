import { IconButton } from '@chakra-ui/react';
import { FiBarChart2 } from 'react-icons/fi';
import { useTestContext } from '../context';

const connectorNameToProvider: Record<
  string,
  'bybit' | 'binance' | 'coinbase'
> = {
  bybit: 'bybit',
  binance: 'binance',
  coinbase: 'coinbase',
};

export const TestCardOpenDashboardButton = () => {
  const { testResult } = useTestContext();
  const provider =
    connectorNameToProvider[testResult.test.connectorName.toLowerCase()] ||
    'bybit';
  const params = new URLSearchParams();

  params.set('backtestId', testResult.test.name);
  params.set('backtestStrategy', testResult.test.strategyName);

  return (
    <IconButton
      size="xs"
      colorPalette="teal"
      variant="outline"
      onClick={() =>
        window.open(
          `/routes/dashboard/${provider}/${testResult.test.universe ?? 'crypto'}/${testResult.test.symbol}/${testResult.test.interval ?? '15'}?${params.toString()}`,
          '_blank',
          'noopener,noreferrer',
        )
      }
    >
      <FiBarChart2 />
    </IconButton>
  );
};
