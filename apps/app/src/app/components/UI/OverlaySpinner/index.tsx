import { Box, Center, VStack, Spinner, Text } from '@chakra-ui/react';

export const OverlaySpinner = () => {
  return (
    <>
      <Box
        pos="absolute"
        inset="0"
        bg="gray.900"
        opacity="0.5"
        zIndex={'overlay'}
      />
      <Box pos="absolute" inset="0" zIndex={'modal'}>
        <Center h="full">
          <VStack colorPalette="teal">
            <Spinner color="colorPalette.500" size="lg" />
            <Text color="colorPalette.500">Loading...</Text>
          </VStack>
        </Center>
      </Box>
    </>
  );
};
