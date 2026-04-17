'use client';

import {
  ClientOnly,
  IconButton,
  Skeleton,
  Span,
  type IconButtonProps,
  type SpanProps,
} from '@chakra-ui/react';
import * as React from 'react';
import { LuMoon, LuSun } from 'react-icons/lu';

export type ColorMode = 'light' | 'dark';

export interface UseColorModeReturn {
  colorMode: ColorMode;
  setColorMode: (colorMode: ColorMode) => void;
  toggleColorMode: () => void;
}

export interface ColorModeProviderProps {
  children: React.ReactNode;
  forcedTheme?: ColorMode;
}

const ColorModeContext = React.createContext<UseColorModeReturn | null>(null);

export function ColorModeProvider({
  children,
  forcedTheme,
}: ColorModeProviderProps) {
  const [colorMode, setColorModeState] = React.useState<ColorMode>(
    forcedTheme ?? 'dark',
  );

  React.useEffect(() => {
    if (!forcedTheme) {
      return;
    }

    setColorModeState(forcedTheme);
  }, [forcedTheme]);

  React.useEffect(() => {
    const root = document.documentElement;
    const nextColorMode = forcedTheme ?? colorMode;
    const previousColorMode = nextColorMode === 'dark' ? 'light' : 'dark';

    root.classList.remove(previousColorMode);
    root.classList.add(nextColorMode);
    root.style.colorScheme = nextColorMode;
  }, [colorMode, forcedTheme]);

  const setColorMode = (nextColorMode: ColorMode) => {
    if (forcedTheme) {
      return;
    }

    setColorModeState(nextColorMode);
  };

  const toggleColorMode = () => {
    setColorMode(colorMode === 'dark' ? 'light' : 'dark');
  };

  const value: UseColorModeReturn = {
    colorMode: forcedTheme ?? colorMode,
    setColorMode,
    toggleColorMode,
  };

  return (
    <ColorModeContext.Provider value={value}>
      {children}
    </ColorModeContext.Provider>
  );
}

export function useColorMode(): UseColorModeReturn {
  return (
    React.useContext(ColorModeContext) ?? {
      colorMode: 'dark',
      setColorMode: () => {},
      toggleColorMode: () => {},
    }
  );
}

export function useColorModeValue<T>(light: T, dark: T) {
  const { colorMode } = useColorMode();
  return colorMode === 'dark' ? dark : light;
}

export function ColorModeIcon() {
  const { colorMode } = useColorMode();
  return colorMode === 'dark' ? <LuMoon /> : <LuSun />;
}

interface ColorModeButtonProps extends Omit<IconButtonProps, 'aria-label'> {}

export const ColorModeButton = React.forwardRef<
  HTMLButtonElement,
  ColorModeButtonProps
>(function ColorModeButton(props, ref) {
  const { toggleColorMode } = useColorMode();
  return (
    <ClientOnly fallback={<Skeleton boxSize="8" />}>
      <IconButton
        onClick={toggleColorMode}
        variant="ghost"
        aria-label="Toggle color mode"
        size="sm"
        ref={ref}
        {...props}
        css={{
          _icon: {
            width: '5',
            height: '5',
          },
        }}
      >
        <ColorModeIcon />
      </IconButton>
    </ClientOnly>
  );
});

export const LightMode = React.forwardRef<HTMLSpanElement, SpanProps>(
  function LightMode(props, ref) {
    return (
      <Span
        color="fg"
        display="contents"
        className="chakra-theme light"
        colorPalette="gray"
        colorScheme="light"
        ref={ref}
        {...props}
      />
    );
  },
);

export const DarkMode = React.forwardRef<HTMLSpanElement, SpanProps>(
  function DarkMode(props, ref) {
    return (
      <Span
        color="fg"
        display="contents"
        className="chakra-theme dark"
        colorPalette="gray"
        colorScheme="dark"
        ref={ref}
        {...props}
      />
    );
  },
);
