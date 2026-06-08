import { normalizeCliArgv } from '../lib/cliArgs';

type CliOptionUsage = {
  longName: string;
  line: number | 'built-in';
  shortName: string;
};

const isArgsOptionCall = (
  ts: typeof import('typescript'),
  node: import('typescript').Node,
  sourceFile: import('typescript').SourceFile,
): node is import('typescript').CallExpression => {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression)
  ) {
    return false;
  }

  return (
    node.expression.name.text === 'option' &&
    node.expression.expression.getText(sourceFile).includes('args')
  );
};

const readOptionName = (
  ts: typeof import('typescript'),
  node: import('typescript').CallExpression,
): string | string[] | null => {
  const [name] = node.arguments;
  if (!name) {
    return null;
  }
  if (ts.isStringLiteral(name)) {
    return name.text;
  }
  if (!ts.isArrayLiteralExpression(name)) {
    return null;
  }

  const names = name.elements.map((element) =>
    ts.isStringLiteral(element) ? element.text : null,
  );
  return names.every((value): value is string => value != null) ? names : null;
};

const collectCliOptions = (
  ts: typeof import('typescript'),
  source: string,
  filePath: string,
): CliOptionUsage[] => {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const usages: CliOptionUsage[] = [];

  const visit = (node: import('typescript').Node) => {
    if (isArgsOptionCall(ts, node, sourceFile)) {
      const optionName = readOptionName(ts, node);
      if (optionName) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        if (typeof optionName === 'string') {
          const short = optionName.charAt(0);
          usages.push({
            longName: optionName,
            line: line + 1,
            shortName: usages.some((usage) => usage.shortName === short)
              ? short.toUpperCase()
              : short,
          });
        } else {
          usages.push({
            shortName: optionName[0],
            longName: optionName[1],
            line: line + 1,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  for (const builtInLongName of ['version', 'help']) {
    const short = builtInLongName.charAt(0);
    usages.push({
      longName: builtInLongName,
      line: 'built-in',
      shortName: usages.some((usage) => usage.shortName === short)
        ? short.toUpperCase()
        : short,
    });
  }

  return usages;
};

const listTypescriptFiles = (
  fs: typeof import('fs'),
  path: typeof import('path'),
  dir: string,
): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listTypescriptFiles(fs, path, entryPath);
    }
    return entry.name.endsWith('.ts') ? [entryPath] : [];
  });

describe('normalizeCliArgv', () => {
  it('rewrites legacy short flags to long flags', () => {
    expect(
      normalizeCliArgv(
        ['node', 'script', '-P', '1', '-S=123', '-E', '456', '-T', '10'],
        {
          '-E': '--endTime',
          '-P': '--progressStep',
          '-S': '--startTime',
          '-T': '--top',
        },
      ),
    ).toEqual([
      'node',
      'script',
      '--progressStep',
      '1',
      '--startTime=123',
      '--endTime',
      '456',
      '--top',
      '10',
    ]);
  });

  it('keeps unrelated args unchanged', () => {
    expect(
      normalizeCliArgv(['node', 'script', '--ai', '-d', '3'], {
        '-P': '--progressStep',
      }),
    ).toEqual(['node', 'script', '--ai', '-d', '3']);
  });

  it('keeps short CLI option aliases unique per args module', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const ts = require('typescript') as typeof import('typescript');
    const cliSrcDir = path.resolve(__dirname, '..');
    const duplicateReports: string[] = [];

    for (const filePath of listTypescriptFiles(fs, path, cliSrcDir)) {
      const source = fs.readFileSync(filePath, 'utf8');
      if (!source.includes('args') || !source.includes('.option')) {
        continue;
      }

      const byShortName = new Map<string, CliOptionUsage[]>();
      for (const usage of collectCliOptions(ts, source, filePath)) {
        const current = byShortName.get(usage.shortName) ?? [];
        current.push(usage);
        byShortName.set(usage.shortName, current);
      }

      for (const [shortName, usages] of byShortName) {
        if (usages.length < 2) {
          continue;
        }
        duplicateReports.push(
          `${path.relative(cliSrcDir, filePath)} -${shortName}: ${usages
            .map((usage) => `${usage.longName}@${usage.line}`)
            .join(', ')}`,
        );
      }
    }

    expect(duplicateReports).toEqual([]);
  });
});
