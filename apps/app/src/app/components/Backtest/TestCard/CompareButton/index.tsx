import { IconButton } from '@chakra-ui/react';
import { TbArrowsLeftRight } from 'react-icons/tb';
import { useTestsCompare } from '@store';
import { useTestContext } from '../context';

export const TestCardCompareButton = () => {
  const { testResult } = useTestContext();
  const { checkIsCompared, onChangeCompare } = useTestsCompare();
  const isCompared = checkIsCompared(testResult.test.name);

  return (
    <IconButton
      size="xs"
      colorPalette="teal"
      variant={isCompared ? 'solid' : 'outline'}
      onClick={() => onChangeCompare(testResult.test.name)}
    >
      <TbArrowsLeftRight />
    </IconButton>
  );
};
