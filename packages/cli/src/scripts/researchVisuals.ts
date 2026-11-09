import {
  generateResearchVisuals,
  type ResearchVisualOptions,
} from '../lib/researchVisuals';
export async function main() {
  const args = process.argv.slice(2);
  const options: ResearchVisualOptions = { inputs: [], outDir: '' };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === 'research-visuals') continue;
    if (key === '--help') {
      console.log(
        'tradejs research-visuals --input FILE [--input SHARD] --outDir NEW_DIR [--population complete|selected] [--intervalMs N] [--strategy NAME] [--candles FILE] [--count 100] [--seed TEXT] [--png]',
      );
      return;
    }
    if (key === '--png') {
      options.png = true;
      continue;
    }
    const value = args[++i];
    if (!value || value.startsWith('--'))
      throw new Error(`Value required: ${key}`);
    switch (key) {
      case '--input':
        options.inputs.push(value);
        break;
      case '--outDir':
        options.outDir = value;
        break;
      case '--population':
        if (value !== 'complete' && value !== 'selected')
          throw new Error('Invalid population');
        options.population = value;
        break;
      case '--intervalMs':
        options.intervalMs = Number(value);
        break;
      case '--count':
        options.count = Number(value);
        break;
      case '--seed':
        options.seed = value;
        break;
      case '--strategy':
        options.strategy = value;
        break;
      case '--candles':
        options.candlesFile = value;
        break;
      default:
        throw new Error(`Unknown option ${key}`);
    }
  }
  if (!options.outDir) throw new Error('--outDir is required');
  console.log(JSON.stringify(await generateResearchVisuals(options)));
}
