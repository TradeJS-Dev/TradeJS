import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stageCanonicalSkillBundle } = require('../dist/index.js');
const manifest = stageCanonicalSkillBundle();

console.log(`Staged TradeJS skill bundle ${manifest.bundleSha256}`);
