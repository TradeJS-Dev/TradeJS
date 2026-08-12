import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appendCoreResearchLedger,
  canonicalJson,
  prepareCoreResearch,
  readCoreResearchLedger,
  sha256Json,
  validateCoreResearchParentLineage,
  validateCoreResearchSpec,
  verifyCoreResearchArtifacts,
  verifyCoreResearchLedger,
  writeCoreResearchStageIndex,
  writeJsonAtomic,
} from '../io';
import type { CoreResearchResult, CoreResearchSpec } from '../types';
import { makeSpec, makeVariant } from '../__fixtures__/fixtures';

describe('core research immutable storage and lineage', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'core-io-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const localSpec = (overrides: Partial<CoreResearchSpec> = {}) =>
    makeSpec({
      artifacts: {
        rootDir: path.join(tempRoot, 'experiments'),
        ledgerPath: path.join(tempRoot, 'experiments', 'ledger.jsonl'),
      },
      ...overrides,
    });

  it('canonicalizes objects recursively without reordering arrays or retaining undefined', () => {
    const left = { z: 1, a: { d: undefined, c: 3 }, list: [{ b: 2, a: 1 }, 3] };
    const right = { list: [{ a: 1, b: 2 }, 3], a: { c: 3 }, z: 1 };
    expect(canonicalJson(left)).toBe(
      '{"a":{"c":3},"list":[{"a":1,"b":2},3],"z":1}',
    );
    expect(sha256Json(left)).toBe(sha256Json(right));
  });

  it('validates the frozen universe and resolved config hashes before touching artifacts', () => {
    const valid = localSpec();
    expect(validateCoreResearchSpec(valid)).toBe(valid);
    expect(() =>
      validateCoreResearchSpec({
        ...valid,
        universe: {
          ...valid.universe,
          symbols: [...valid.universe.symbols].reverse(),
        },
      }),
    ).toThrow('universe.sha256 does not match');
    expect(() =>
      validateCoreResearchSpec({
        ...valid,
        variants: valid.variants.map((variant, index) =>
          index === 0
            ? { ...variant, resolvedConfig: { DRIFTED: true } }
            : variant,
        ),
      }),
    ).toThrow('configSha256 does not match resolvedConfig');
    expect(() =>
      validateCoreResearchSpec({
        ...valid,
        stage: 'isolated_long',
        parentResearchIds: [],
      }),
    ).toThrow('require parentResearchIds');
  });

  it('prepares idempotently but rejects a changed spec under the same research id', async () => {
    const spec = localSpec();
    const first = await prepareCoreResearch(spec);
    const second = await prepareCoreResearch(spec);
    expect(second.manifest).toEqual(first.manifest);
    expect(
      await readCoreResearchLedger(spec.artifacts.ledgerPath),
    ).toHaveLength(1);

    await expect(
      prepareCoreResearch({
        ...spec,
        hypothesis: { ...spec.hypothesis, claim: 'A changed claim.' },
      }),
    ).rejects.toThrow('immutable and already has a different spec');
  });

  it('serializes concurrent ledger appends and verifies the resulting hash chain', async () => {
    const ledgerPath = path.join(tempRoot, 'ledger.jsonl');
    const append = (researchId: string) =>
      appendCoreResearchLedger({
        ledgerPath,
        researchId,
        event: 'prepared',
        specSha256: 'a'.repeat(64),
        hypothesisFamily: 'family',
      });
    const results = await Promise.allSettled([append('one'), append('two')]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      verifyCoreResearchLedger(await readCoreResearchLedger(ledgerPath)),
    ).toMatchObject({
      records: 1,
    });
  });

  it('verifies artifact hashes and detects post-completion tampering', async () => {
    const spec = localSpec();
    const prepared = await prepareCoreResearch(spec);
    await expect(verifyCoreResearchArtifacts(spec)).resolves.toMatchObject({
      artifacts: 1,
    });
    await fs.writeFile(prepared.paths.specPath, '{}\n', 'utf8');
    await expect(verifyCoreResearchArtifacts(spec)).rejects.toThrow(
      'Artifact hash mismatch: spec.json',
    );
  });

  it('requires later stages to carry a selected candidate config from the expected parent stage', async () => {
    const rootDir = path.join(tempRoot, 'experiments');
    const parent = localSpec({ researchId: 'parent-screen' });
    const prepared = await prepareCoreResearch(parent);
    const result = {
      schema: 'tradejs-core-research-result/v1',
      researchId: parent.researchId,
      stage: parent.stage,
      variants: parent.variants.map((variant) => ({ variant })),
      comparisons: [
        {
          candidateId: 'candidate',
          selection: { passed: true },
        },
      ],
    } as unknown as CoreResearchResult;
    await writeJsonAtomic(prepared.paths.resultPath, result);
    await writeJsonAtomic(prepared.paths.manifestPath, {
      ...prepared.manifest,
      status: 'completed',
      artifactHashes: prepared.manifest.artifactHashes,
    });

    const candidate = parent.variants.find(
      (variant) => variant.role === 'candidate',
    )!;
    const child = localSpec({
      researchId: 'child-long',
      stage: 'isolated_long',
      parentResearchIds: [parent.researchId],
      variants: [
        makeVariant({ id: 'control-long', role: 'control' }),
        { ...candidate, id: 'candidate-long' },
      ],
      artifacts: {
        rootDir,
        ledgerPath: path.join(rootDir, 'ledger.jsonl'),
      },
    });
    await expect(
      validateCoreResearchParentLineage(child),
    ).resolves.toBeUndefined();
    await expect(
      validateCoreResearchParentLineage({
        ...child,
        variants: [
          child.variants[0],
          makeVariant({ id: 'drifted-candidate', role: 'candidate' }),
        ],
      }),
    ).rejects.toThrow(
      'does not carry forward a passed parent candidate config SHA',
    );
  });

  it('builds one stage index pass and rejects missing or cross-family parents', async () => {
    const rootDir = path.join(tempRoot, 'index');
    const parent = localSpec({
      researchId: 'screen-one',
      artifacts: { rootDir, ledgerPath: path.join(rootDir, 'ledger.jsonl') },
    });
    await prepareCoreResearch(parent);
    const index = await writeCoreResearchStageIndex(rootDir);
    expect(index.families).toEqual([
      {
        family: 'fixture-family',
        experiments: [expect.objectContaining({ researchId: 'screen-one' })],
      },
    ]);

    const orphan = localSpec({
      researchId: 'orphan-long',
      stage: 'isolated_long',
      parentResearchIds: ['missing-screen'],
      artifacts: { rootDir, ledgerPath: path.join(rootDir, 'ledger.jsonl') },
    });
    const orphanDir = path.join(rootDir, orphan.researchId);
    await fs.mkdir(orphanDir, { recursive: true });
    await writeJsonAtomic(path.join(orphanDir, 'spec.json'), orphan);
    await writeJsonAtomic(path.join(orphanDir, 'manifest.json'), {
      schema: 'tradejs-core-research-manifest/v1',
      researchId: orphan.researchId,
      specSha256: sha256Json(orphan),
      status: 'prepared',
      createdAt: orphan.createdAt,
      artifactHashes: {},
    });
    await expect(writeCoreResearchStageIndex(rootDir)).rejects.toThrow(
      'references missing parent missing-screen',
    );
  });
});
