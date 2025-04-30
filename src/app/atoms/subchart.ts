import { atom } from 'recoil';

export const subchartState = atom({
  key: 'Subchart',
  default: {
    enabled: false,
  },
});
