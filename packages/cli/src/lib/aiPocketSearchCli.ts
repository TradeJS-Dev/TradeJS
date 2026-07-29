export const AI_POCKET_SEARCH_CLI_DECIMAL_DEFAULTS = {
  minProfitFactor: '1.2',
  minWinRate: '0',
  minTotalProfit: '0',
  validationSplit: '0.25',
} as const;

export const readAiPocketSearchCliOption = ({
  argv,
  longName,
  shortName,
}: {
  argv: string[];
  longName: string;
  shortName?: string;
}): string | undefined => {
  const longPrefix = `--${longName}=`;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith(longPrefix)) {
      return arg.slice(longPrefix.length);
    }
    if (
      arg === `--${longName}` ||
      (shortName != null && arg === `-${shortName}`)
    ) {
      return argv[index + 1];
    }
  }

  return undefined;
};
