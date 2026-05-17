import {
  Box,
  Flex,
  Skeleton,
  SkeletonText,
  SimpleGrid,
} from '@chakra-ui/react';

export const RuntimeStrategyCardSkeleton = () => (
  <Box
    p={2}
    mb={4}
    maxW="1400px"
    borderRadius="md"
    shadow="sm"
    borderWidth="1px"
    borderColor="gray.800"
    overflowX="auto"
  >
    <Flex p={4} mb={3} alignItems="center" gap={4} wrap="wrap">
      <Skeleton height="28px" width="160px" />
      <Skeleton height="28px" width="90px" />
      <Skeleton height="28px" width="110px" />
      <Skeleton height="28px" width="320px" />
      <Skeleton height="28px" width="90px" />
      <Skeleton height="28px" width="90px" />
      <Skeleton height="20px" width="240px" ml="auto" />
    </Flex>

    <Box w="100%" minW="600px" h="350px" pr={2}>
      <Skeleton height="100%" />
    </Box>

    <SimpleGrid columns={{ base: 4, md: 8 }} p={4} gap={4}>
      {Array.from({ length: 8 }).map((_, index) => (
        <SkeletonText key={index} noOfLines={2} gap="3" />
      ))}
    </SimpleGrid>
  </Box>
);
