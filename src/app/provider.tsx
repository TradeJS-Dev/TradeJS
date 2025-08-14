'use client';

import {
  ChakraProvider,
  createSystem,
  defaultConfig,
  defineConfig,
} from '@chakra-ui/react';
import { ColorModeProvider } from '@UI';

const config = defineConfig({
  theme: {
    tokens: {
      cursor: {
        button: { value: 'pointer' },
      },
    },
  },
});

const system = createSystem(defaultConfig, config);

export default function Provider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ChakraProvider value={system}>
      <ColorModeProvider forcedTheme="dark">{children}</ColorModeProvider>
    </ChakraProvider>
  );
}
