'use client';

import {
  ChakraProvider,
  createSystem,
  defaultConfig,
  defineConfig,
} from '@chakra-ui/react';
import { SessionProvider } from 'next-auth/react';
import { AppToaster, ColorModeProvider } from '#ui';

const config = defineConfig({
  theme: {
    recipes: {
      button: {
        variants: {
          variant: {
            outline: {
              '--outline-color': 'colors.colorPalette.muted',
            },
          },
        },
      },
      badge: {
        variants: {
          variant: {
            outline: {
              '--outline-shadow': 'colors.colorPalette.muted',
            },
          },
        },
      },
    },
    slotRecipes: {
      tag: {
        slots: defaultConfig.theme?.slotRecipes?.tag?.slots ?? [],
        variants: {
          variant: {
            outline: {
              root: {
                '--outline-shadow': 'colors.colorPalette.muted',
              },
            },
          },
        },
      },
    },
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
      <ColorModeProvider forcedTheme="dark">
        <SessionProvider>
          {children}
          <AppToaster />
        </SessionProvider>
      </ColorModeProvider>
    </ChakraProvider>
  );
}
