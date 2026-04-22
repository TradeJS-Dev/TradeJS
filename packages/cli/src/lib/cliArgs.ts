export const normalizeCliArgv = (
  argv: string[],
  legacyFlagMap: Record<string, string>,
): string[] =>
  argv.map((arg) => {
    const [flag, ...rest] = String(arg).split('=');
    const normalizedFlag = legacyFlagMap[flag];
    if (!normalizedFlag) {
      return arg;
    }

    if (!rest.length) {
      return normalizedFlag;
    }

    return `${normalizedFlag}=${rest.join('=')}`;
  });
