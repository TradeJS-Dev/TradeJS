import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';
import { neutral, teal } from './palette';

const scaleTokens = (scale: Record<number, string>) =>
  Object.fromEntries(
    Object.entries(scale).map(([step, value]) => [step, { value }]),
  );

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
      segmentGroup: {
        slots: defaultConfig.theme?.slotRecipes?.segmentGroup?.slots ?? [],
        base: {
          root: {
            bg: 'bg.panel',
            '--segment-indicator-bg': 'colors.teal.muted',
            '--segment-indicator-shadow': 'none',
            boxShadow: 'none',
            borderWidth: '1px',
            borderColor: 'border',
          },
          item: {
            color: 'fg.muted',
            '&[data-state=checked]': { color: 'teal.fg' },
            '&[data-state=checked][data-ssr]': { bg: 'teal.muted' },
          },
        },
        variants: {
          size: { xs: { item: { px: { base: 2, md: 3 } } } },
        },
      },
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
    semanticTokens: {
      colors: {
        bg: {
          DEFAULT: {
            value: { _light: '{colors.white}', _dark: '{colors.gray.950}' },
          },
          panel: {
            value: { _light: '{colors.white}', _dark: '{colors.gray.900}' },
          },
          muted: {
            value: { _light: '{colors.gray.100}', _dark: '{colors.gray.800}' },
          },
          emphasized: {
            value: { _light: '{colors.gray.200}', _dark: '{colors.gray.700}' },
          },
        },
        border: {
          DEFAULT: {
            value: { _light: '{colors.gray.200}', _dark: '{colors.gray.700}' },
          },
          muted: {
            value: { _light: '{colors.gray.100}', _dark: '{colors.gray.800}' },
          },
          emphasized: {
            value: { _light: '{colors.gray.300}', _dark: '{colors.gray.600}' },
          },
        },
        gray: {
          focusRing: {
            value: {
              _light: '{colors.teal.600}',
              _dark: '{colors.teal.400}',
            },
          },
        },
        teal: {
          solid: {
            value: { _light: '{colors.teal.700}', _dark: '{colors.teal.400}' },
          },
          contrast: {
            value: { _light: '{colors.white}', _dark: '{colors.teal.950}' },
          },
          focusRing: {
            value: { _light: '{colors.teal.600}', _dark: '{colors.teal.400}' },
          },
        },
      },
    },
    tokens: {
      colors: { gray: scaleTokens(neutral), teal: scaleTokens(teal) },
      cursor: {
        button: { value: 'pointer' },
      },
    },
  },
});

export const appTheme = createSystem(defaultConfig, config);
