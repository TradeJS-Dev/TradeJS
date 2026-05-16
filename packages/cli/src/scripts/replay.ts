export const main = async () => {
  process.env.TRADEJS_REPLAY = '1';
  const { backtest } = await import('./backtest');
  await backtest();
};

if (require.main === module) {
  void main();
}
