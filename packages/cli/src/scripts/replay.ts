import { replayBacktest } from './replayRunner';

export const main = async () => {
  await replayBacktest();
};

if (require.main === module) {
  void main();
}
