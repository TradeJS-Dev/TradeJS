const stripAnsi = (value: string) =>
  value.replace(
    /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    '',
  );

export const parseBacktestProgressLine = (line: string, offset = 0) => {
  const text = stripAnsi(line);
  const progressMatch = text.match(
    /(\d+)\/(\d+).*?\bavg\s+(-?\d+(?:\.\d+)?)\$\s+win\s+(-?\d+(?:\.\d+)?)%/i,
  );
  if (progressMatch) {
    return {
      completed: offset + Number(progressMatch[1]),
      total: offset + Number(progressMatch[2]),
      averageProfit: Number(progressMatch[3]),
      winRate: Number(progressMatch[4]),
    };
  }
  const testsMatch = text.match(/\btests:\s*(\d+)\b/i);
  if (testsMatch) return { total: offset + Number(testsMatch[1]) };
  const successMatch = text.match(/\bSUCCESS TESTS:\s*(\d+)\b/i);
  if (successMatch) {
    return { successTests: offset + Number(successMatch[1]) };
  }
  const errorMatch = text.match(/\bERRORS:\s*(\d+)\b/i);
  return errorMatch ? { errorTests: Number(errorMatch[1]) } : null;
};
