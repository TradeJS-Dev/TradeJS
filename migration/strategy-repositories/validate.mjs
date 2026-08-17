import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(migrationRoot, '../..');

const readJson = (name) =>
  JSON.parse(fs.readFileSync(path.join(migrationRoot, name), 'utf8'));

const fail = (message) => {
  throw new Error(message);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const sorted = (values) =>
  [...values].sort((left, right) => left.localeCompare(right));

const assertUnique = (label, values) => {
  assert(
    new Set(values).size === values.length,
    `${label} must not contain duplicates`,
  );
};

const assertSameValues = (label, expected, actual) => {
  const normalizedExpected = sorted(new Set(expected));
  const normalizedActual = sorted(new Set(actual));
  if (JSON.stringify(normalizedExpected) !== JSON.stringify(normalizedActual)) {
    fail(
      `${label} mismatch\nexpected=${JSON.stringify(normalizedExpected)}\nactual=${JSON.stringify(normalizedActual)}`,
    );
  }
};

const toKebabCase = (value) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

const walkFiles = (root) => {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolutePath = path.join(root, entry.name);
    return entry.isDirectory() ? walkFiles(absolutePath) : [absolutePath];
  });
};

const catalog = readJson('catalog.json');
const helperOwnership = readJson('helper-ownership.json');
const characterizationContract = readJson('characterization-contract.json');
const documentationInventory = readJson('documentation-inventory.json');
const githubEnvironmentInventory = readJson(
  'github-environment-inventory.json',
);

assert(
  catalog.schema === 'tradejs-strategy-repositories/v2',
  'Unsupported strategy catalog schema',
);
assert(catalog.strategies.length > 0, 'Strategy catalog must not be empty');

const strategyNames = catalog.strategies.map((strategy) => strategy.name);
const repositories = catalog.strategies.map((strategy) => strategy.repository);
const packageNames = catalog.strategies.map((strategy) => strategy.packageName);
const repositoryGroups = catalog.repositoryGroups ?? [];
const repositoryGroupIds = repositoryGroups.map((group) => group.id);
assertUnique('Strategy names', strategyNames);
assert(
  catalog.groupPolicy === 'single-explicit-exception',
  'Unsupported grouped repository policy',
);
assert(
  repositoryGroups.length === 1,
  'Exactly one grouped repository exception is allowed',
);
assertUnique('Repository group ids', repositoryGroupIds);
assertUnique(
  'Repository group repositories',
  repositoryGroups.map((group) => group.repository),
);
assertUnique(
  'Repository group package names',
  repositoryGroups.map((group) => group.packageName),
);

const repositoryGroupsById = new Map(
  repositoryGroups.map((group) => [group.id, group]),
);
const groupedStrategyNames = repositoryGroups.flatMap(
  (group) => group.strategies,
);
assertUnique('Grouped strategy names', groupedStrategyNames);

for (const group of repositoryGroups) {
  assert(
    group.strategies.length > 1,
    `${group.id}: group must not be singular`,
  );
  assert(
    typeof group.rationale === 'string' && group.rationale.trim().length > 0,
    `${group.id}: grouped exception requires a rationale`,
  );
  for (const strategyName of group.strategies) {
    assert(
      strategyNames.includes(strategyName),
      `${group.id}: unknown grouped strategy ${strategyName}`,
    );
  }
  assertSameValues(
    `${group.id} strategy membership`,
    group.strategies,
    catalog.strategies
      .filter((strategy) => strategy.repositoryGroup === group.id)
      .map((strategy) => strategy.name),
  );
}

for (const strategy of catalog.strategies) {
  const expectedSourcePath = `packages/strategies/src/${strategy.name}`;
  const repositoryGroup = strategy.repositoryGroup
    ? repositoryGroupsById.get(strategy.repositoryGroup)
    : null;
  assert(
    !strategy.repositoryGroup || repositoryGroup,
    `${strategy.name}: unknown repository group ${strategy.repositoryGroup}`,
  );
  const expectedRepository =
    repositoryGroup?.repository ?? `TradeJS-Strategy-${strategy.name}`;
  const expectedPackageName =
    repositoryGroup?.packageName ??
    `@tradejs/strategy-${toKebabCase(strategy.name)}`;
  assert(
    strategy.sourcePath === expectedSourcePath,
    `${strategy.name}: expected sourcePath ${expectedSourcePath}`,
  );
  assert(
    strategy.repository === expectedRepository,
    `${strategy.name}: expected repository ${expectedRepository}`,
  );
  assert(
    strategy.packageName === expectedPackageName,
    `${strategy.name}: expected packageName ${expectedPackageName}`,
  );
  assert(
    fs.statSync(path.join(repositoryRoot, strategy.sourcePath)).isDirectory(),
    `${strategy.name}: source directory is missing`,
  );
}

const repositoryPackagePairs = new Map();
for (const strategy of catalog.strategies) {
  const knownPackageName = repositoryPackagePairs.get(strategy.repository);
  assert(
    knownPackageName == null || knownPackageName === strategy.packageName,
    `${strategy.repository}: repository maps to multiple package names`,
  );
  repositoryPackagePairs.set(strategy.repository, strategy.packageName);
}
assert(
  repositoryPackagePairs.size === new Set(packageNames).size,
  'Repository and package units must have a one-to-one mapping',
);

const strategiesSourceRoot = path.join(
  repositoryRoot,
  'packages/strategies/src',
);
const ignoredStrategyDirectories = new Set([
  '__tests__',
  'shared',
  'testUtils',
]);
const discoveredStrategies = fs
  .readdirSync(strategiesSourceRoot, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && !ignoredStrategyDirectories.has(entry.name),
  )
  .map((entry) => entry.name);
assertSameValues(
  'Strategy source directories',
  strategyNames,
  discoveredStrategies,
);

const strategyIndexContents = fs.readFileSync(
  path.join(strategiesSourceRoot, 'index.ts'),
  'utf8',
);
const registeredStrategyDirectories = [
  ...strategyIndexContents.matchAll(/from '\.\/([^/]+)\/strategy';/g),
].map((match) => match[1]);
assertSameValues(
  'Registered strategy directories',
  strategyNames,
  registeredStrategyDirectories,
);

assert(
  characterizationContract.schema === 'tradejs-strategy-characterization/v1',
  'Unsupported characterization contract schema',
);
assert(
  /^[0-9a-f]{40}$/.test(characterizationContract.baselineGitCommit),
  'Characterization baseline must be a full Git commit SHA',
);
assert(
  characterizationContract.scope === 'all-catalog-strategies',
  'Characterization must cover every catalog strategy',
);
assertUnique(
  'Characterization evidence ids',
  characterizationContract.requiredEvidence.map((item) => item.id),
);
assert(
  characterizationContract.requiredEvidence.length > 0,
  'Characterization evidence must not be empty',
);
for (const strategyName of characterizationContract.completedStrategies) {
  assert(
    strategyNames.includes(strategyName),
    `Unknown completed characterization strategy: ${strategyName}`,
  );
}

assert(
  helperOwnership.schema === 'tradejs-strategy-helper-ownership/v2',
  'Unsupported helper ownership schema',
);
const sharedRoot = path.join(strategiesSourceRoot, 'shared');
const strategyKitSourceRoot = path.join(
  repositoryRoot,
  'packages/strategy-kit/src',
);
const discoveredHelperSourcePaths = [sharedRoot, strategyKitSourceRoot]
  .flatMap((root) => walkFiles(root))
  .filter(
    (filePath) =>
      filePath.endsWith('.ts') &&
      !filePath.split(path.sep).includes('__tests__'),
  )
  .map((filePath) =>
    path.relative(repositoryRoot, filePath).replaceAll(path.sep, '/'),
  )
  .concat(
    helperOwnership.helpers
      .filter(
        (helper) =>
          helper.state === 'indicator-extracted' ||
          helper.state === 'strategy-family-owned',
      )
      .map((helper) => helper.sourcePath),
  );
const helperIds = helperOwnership.helpers.map((helper) => helper.id);
assertUnique('Helper ids', helperIds);
assertSameValues(
  'Strategy helper source modules',
  helperOwnership.helpers.map((helper) => helper.sourcePath),
  discoveredHelperSourcePaths,
);

const strategyKitManifest = readJson(
  '../../packages/strategy-kit/package.json',
);
const indicatorsManifest = readJson('../../packages/indicators/package.json');

const strategyFiles = walkFiles(strategiesSourceRoot).filter(
  (filePath) => filePath.endsWith('.ts') && !filePath.startsWith(sharedRoot),
);
for (const helper of helperOwnership.helpers) {
  assert(
    fs.existsSync(path.join(repositoryRoot, helper.sourcePath)),
    `${helper.id}: source helper is missing`,
  );
  assert(
    helper.state === 'strategies-shared' ||
      helper.state === 'strategy-kit-extracted' ||
      helper.state === 'indicator-extracted' ||
      helper.state === 'strategy-family-owned',
    `${helper.id}: unsupported helper state ${helper.state}`,
  );
  if (helper.state === 'strategy-kit-extracted') {
    assert(
      helper.target.packageName === '@tradejs/strategy-kit',
      `${helper.id}: extracted helper must be owned by @tradejs/strategy-kit`,
    );
    assert(
      Object.hasOwn(strategyKitManifest.exports, `./${helper.target.subpath}`),
      `${helper.id}: missing @tradejs/strategy-kit/${helper.target.subpath} export`,
    );
  }
  if (helper.state === 'indicator-extracted') {
    assert(
      helper.target.packageName === '@tradejs/indicators',
      `${helper.id}: indicator helper must be owned by @tradejs/indicators`,
    );
    assert(
      helper.target.decision === 'approved-neutral',
      `${helper.id}: indicator helper neutrality must be approved`,
    );
    assert(
      Object.hasOwn(indicatorsManifest.exports, `./${helper.target.subpath}`),
      `${helper.id}: missing @tradejs/indicators/${helper.target.subpath} export`,
    );
  }
  if (helper.state === 'strategy-family-owned') {
    const targetGroup = repositoryGroups.find(
      (group) => group.packageName === helper.target.packageName,
    );
    assert(
      helper.target.kind === 'combined-strategy-package',
      `${helper.id}: family helper must target a combined strategy package`,
    );
    assert(
      targetGroup,
      `${helper.id}: combined package is missing from repository groups`,
    );
    assert(
      targetGroup.repository === helper.target.repository,
      `${helper.id}: combined repository does not match its catalog group`,
    );
  }
  const importNeedles =
    helper.state === 'strategy-kit-extracted'
      ? [`@tradejs/strategy-kit/${helper.target.subpath}`]
      : helper.state === 'indicator-extracted'
        ? [`@tradejs/indicators/${helper.target.subpath}`]
        : helper.state === 'strategy-family-owned'
          ? ["from './family'", "from '../family'", 'TrendLine/family']
          : [`/shared/${helper.id}`];
  const consumers = new Set();
  for (const filePath of strategyFiles) {
    const contents = fs.readFileSync(filePath, 'utf8');
    if (
      !importNeedles.some((importNeedle) => contents.includes(importNeedle))
    ) {
      continue;
    }
    const relativePath = path.relative(strategiesSourceRoot, filePath);
    const strategyName = relativePath.split(path.sep)[0];
    if (strategyNames.includes(strategyName)) consumers.add(strategyName);
  }
  assertSameValues(`${helper.id} consumers`, helper.consumers, consumers);
}

assert(
  documentationInventory.schema === 'tradejs-documentation-migration/v1',
  'Unsupported documentation inventory schema',
);
for (const relativePath of documentationInventory.currentTradejsFiles) {
  assert(
    fs.existsSync(path.join(repositoryRoot, relativePath)),
    `Documented TradeJS file is missing: ${relativePath}`,
  );
}

assert(
  githubEnvironmentInventory.schema ===
    'tradejs-github-environment-migration/v1',
  'Unsupported GitHub environment inventory schema',
);
assert(
  githubEnvironmentInventory.containsSecretValues === false,
  'GitHub environment inventory must never contain secret values',
);

const tradejsCredentialInventory = githubEnvironmentInventory.repositories.find(
  (repository) => repository.repository === 'TradeJS',
);
assert(tradejsCredentialInventory, 'TradeJS credential inventory is missing');
const inventoriedTradejsCredentials =
  tradejsCredentialInventory.credentials.map((credential) => credential.name);
const workflowRoot = path.join(repositoryRoot, '.github/workflows');
const readWorkflowCredentialNames = (root) => {
  const names = new Set();
  for (const workflowPath of walkFiles(root).filter((filePath) =>
    /\.ya?ml$/.test(filePath),
  )) {
    const contents = fs.readFileSync(workflowPath, 'utf8');
    for (const match of contents.matchAll(/secrets\.([A-Z0-9_]+)/g)) {
      names.add(match[1]);
    }
  }
  return names;
};
const referencedTradejsCredentials = readWorkflowCredentialNames(workflowRoot);
assertSameValues(
  'TradeJS workflow credential references',
  inventoriedTradejsCredentials,
  referencedTradejsCredentials,
);

const optionalSiblingRepositories = [
  ['TradeJS-Deploy', '../tradejs-deploy'],
  ['TradeJS-Docs', '../tradejs-docs'],
  ['TradeJS-Site', '../tradejs-site'],
];
let validatedSiblingRepositories = 0;
for (const [repositoryName, relativePath] of optionalSiblingRepositories) {
  const siblingRoot = path.resolve(repositoryRoot, relativePath);
  const siblingWorkflowRoot = path.join(siblingRoot, '.github/workflows');
  if (!fs.existsSync(siblingWorkflowRoot)) continue;
  const repositoryInventory = githubEnvironmentInventory.repositories.find(
    (repository) => repository.repository === repositoryName,
  );
  assert(
    repositoryInventory,
    `${repositoryName} credential inventory is missing`,
  );
  assertSameValues(
    `${repositoryName} workflow credential references`,
    repositoryInventory.credentials.map((credential) => credential.name),
    readWorkflowCredentialNames(siblingWorkflowRoot),
  );
  validatedSiblingRepositories += 1;
}

console.log(
  [
    `Validated ${strategyNames.length} strategy mappings across ${repositoryPackagePairs.size} repository/package units`,
    `${helperIds.length} strategy helper ownership records`,
    `${helperOwnership.helpers.filter((helper) => helper.state === 'strategy-kit-extracted').length} extracted Strategy Kit modules`,
    `${helperOwnership.helpers.filter((helper) => helper.state === 'indicator-extracted').length} extracted indicator modules`,
    `${helperOwnership.helpers.filter((helper) => helper.state === 'strategy-family-owned').length} strategy-family-owned modules`,
    `${documentationInventory.currentTradejsFiles.length} TradeJS documentation files`,
    `${inventoriedTradejsCredentials.length} TradeJS workflow credential references`,
    `${validatedSiblingRepositories} sibling repository credential inventories`,
  ].join(', '),
);
