import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandboxRoot = path.join(root, 'examples/sandbox');
const configPath = path.join(sandboxRoot, 'tsconfig.json');
const configResult = ts.readConfigFile(configPath, ts.sys.readFile);

if (configResult.error) {
  process.stderr.write(
    ts.formatDiagnosticsWithColorAndContext([configResult.error], {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => root,
      getNewLine: () => ts.sys.newLine,
    }),
  );
  process.exit(1);
}

const parsed = ts.parseJsonConfigFileContent(
  {
    ...configResult.config,
    compilerOptions: {
      ...configResult.config.compilerOptions,
      baseUrl: root,
      lib: ['ES2023'],
      paths: {
        '@tradejs/core/*': ['packages/core/src/*'],
        '@tradejs/types': ['packages/types/src/index.ts'],
      },
      target: 'ES2023',
    },
  },
  ts.sys,
  sandboxRoot,
  undefined,
  configPath,
);

const diagnostics = [
  ...parsed.errors,
  ...ts.getPreEmitDiagnostics(
    ts.createProgram({
      rootNames: parsed.fileNames,
      options: parsed.options,
      projectReferences: parsed.projectReferences,
    }),
  ),
];

if (diagnostics.length > 0) {
  process.stderr.write(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => root,
      getNewLine: () => ts.sys.newLine,
    }),
  );
  process.exit(1);
}

console.log('Validated external sandbox against the current TradeJS source API.');
