export const main = async () => {
  const { replayBacktest } = await import('./backtest');
  await replayBacktest();
};

if (require.main === module) {
  void main();
}
