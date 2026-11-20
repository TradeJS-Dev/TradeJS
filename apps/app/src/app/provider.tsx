'use client';

import {
  ChakraProvider,
  createSystem,
  defaultConfig,
  defineConfig,
} from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import { setBacktestCacheSession } from '#app/store/tests';
import { SessionProvider, useSession } from 'next-auth/react';
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

function SessionCacheBoundary({ children }: { children: React.ReactNode }) {
  const { data, status } = useSession();
  const identity =
    status === 'authenticated'
      ? data?.user?.id ?? data?.user?.name ?? null
      : null;
  const [ready, setReady] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void setBacktestCacheSession(identity).then(() => {
      if (active) setReady(identity);
    });
    return () => {
      active = false;
    };
  }, [identity]);
  if (status === 'loading' || ready !== identity) return null;
  return <>{children}</>;
}

export default function Provider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ChakraProvider value={system}>
      <ColorModeProvider forcedTheme="dark">
        <SessionProvider>
          <SessionCacheBoundary>{children}</SessionCacheBoundary>
          <AppToaster />
        </SessionProvider>
      </ColorModeProvider>
    </ChakraProvider>
  );
}
