export const main = async () => {
  const { replayBacktest } = await import('./replayRunner');
  await replayBacktest();
};

if (require.main === module) {
  void main();
}
