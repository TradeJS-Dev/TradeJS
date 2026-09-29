import args from 'args';
import { runJevResearch } from '../lib/jevResearch';

args.option('action', 'Jev workflow: evaluate, export, train, compare');
args.option(
  'input',
  'Input JSONL; export optionally joins outcomes by exact assessment record',
);
args.option('out', 'New output file (existing files are never overwritten)');
args.option('user', 'Account settings user', 'root');
args.option('strategy', 'Select one strategy');
args.option('recordsDir', 'Jev recordings directory', 'data/ai/jev');
args.option('model', 'Local Jev gate JSON for comparison');
args.option('maxDepth', 'Maximum local rule tree depth', 3);
args.option(['l', 'minLeaf'], 'Minimum training samples per leaf', 10);

export const main = async () => {
  const flags = args.parse(process.argv);
  if (!flags.out) throw new Error('Provide --out for the immutable Jev result');
  console.log(
    JSON.stringify(
      await runJevResearch({
        action: String(flags.action),
        projectRoot: process.env.PROJECT_CWD || process.cwd(),
        userName: String(flags.user),
        input: flags.input,
        out: String(flags.out),
        strategy: flags.strategy,
        recordsDir: String(flags.recordsDir),
        model: flags.model,
        maxDepth: Number(flags.maxDepth),
        minLeaf: Number(flags.minLeaf),
      }),
      null,
      2,
    ),
  );
};
