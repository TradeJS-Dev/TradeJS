import { IconButton } from '@chakra-ui/react';
import { FiExternalLink } from 'react-icons/fi';
import { useTestContext } from '../context';

export const TestCardOpenReportButton = () => {
  const { testResult } = useTestContext();

  return (
    <IconButton
      size="xs"
      colorPalette="teal"
      variant="outline"
      onClick={() =>
        window.open(
          `/routes/backtest/${testResult.test.name}`,
          '_blank',
          'noopener,noreferrer',
        )
      }
    >
      <FiExternalLink />
    </IconButton>
  );
};
