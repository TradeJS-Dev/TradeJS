import { Box, Flex, Skeleton } from '@chakra-ui/react';

export const ChartSkeleton = () => (
  <Box
    pos="absolute"
    inset={0}
    zIndex="overlay"
    bg="gray.900"
    p={3}
    role="status"
    aria-label="Loading chart"
    pointerEvents="none"
  >
    <Flex h="full" direction="column" gap={2}>
      <Flex flex={1} minH={0} gap={2}>
        <Skeleton flex={1} borderRadius="sm" />
        <Flex direction="column" justify="space-around" w="48px">
          {[0, 1, 2, 3, 4].map((tick) => (
            <Skeleton key={tick} h="10px" />
          ))}
        </Flex>
      </Flex>
      <Flex justify="space-around" pr="50px">
        {[0, 1, 2, 3].map((tick) => (
          <Skeleton key={tick} h="10px" w="42px" />
        ))}
      </Flex>
    </Flex>
  </Box>
);
