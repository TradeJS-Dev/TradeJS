import { Box, SkeletonText, Skeleton, Stack } from '@chakra-ui/react';

export const TestCardSkeleton = () => (
  <Box
    p={2}
    mb={4}
    width="1400px"
    height="628px"
    bg="gray.900"
    borderRadius="md"
    shadow="sm"
    borderWidth="1px"
    overflowX="auto"
  >
    <Stack gap="6">
      <SkeletonText noOfLines={2} gap="6" />
      <Skeleton height="400px" />
      <SkeletonText noOfLines={3} gap="6" />
    </Stack>
  </Box>
);
