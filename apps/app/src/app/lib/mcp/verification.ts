import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

type Binding = {
  userName: string;
  deploymentId: string;
  accountId: string;
  deploymentCompositionId: string;
};
const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

export const parseDeploymentVerification = (
  bytes: Buffer,
  pointer: { sha256: string; bytes: number },
  binding: Binding,
  manifestBytes: Buffer,
  imageDigest: string,
  now = Date.now(),
) => {
  if (bytes.length !== pointer.bytes || hash(bytes) !== pointer.sha256)
    throw Error('MCP verification checksum mismatch');
  const report = JSON.parse(bytes.toString('utf8'));
  if (
    report.schemaVersion !== 1 ||
    report.reportType !== 'runtime-deployment-verification' ||
    Object.entries(binding).some(([key, value]) => report[key] !== value)
  )
    throw Error('MCP verification binding mismatch');
  if (
    typeof report.ok !== 'boolean' ||
    typeof report.verification?.ok !== 'boolean' ||
    !Array.isArray(report.verification?.strategies) ||
    !report.verification.strategies.length ||
    typeof report.health?.status !== 'string' ||
    report.verification.strategies.some(
      (strategy: {
        strategyName?: string;
        strategyRevision?: string;
        controlState?: string;
      }) =>
        !strategy.strategyName ||
        !/^sr1:[a-f0-9]+$/.test(strategy.strategyRevision ?? '') ||
        !['active', 'entries_paused'].includes(strategy.controlState ?? ''),
    ) ||
    report.ok !== (report.verification.ok && report.health.status === 'healthy')
  )
    throw Error('MCP verification result invalid');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (
    !/^sha256:[a-f0-9]{64}$/.test(imageDigest) ||
    report.projectSha !== manifest.projectSha ||
    report.imageDigest !== imageDigest ||
    report.runtimePackageManifest?.sha256 !== hash(manifestBytes) ||
    report.runtimePackageManifest?.bytes !== manifestBytes.length ||
    JSON.stringify(report.runtimePackageManifest.manifest) !==
      JSON.stringify(manifest)
  )
    throw Error('MCP verification image or manifest mismatch');
  if (
    !Number.isSafeInteger(report.observedAt) ||
    report.observedAt > now + 30000 ||
    (report.deploymentVerifiedAt !== null &&
      (!Number.isSafeInteger(report.deploymentVerifiedAt) ||
        report.deploymentVerifiedAt > report.observedAt))
  )
    throw Error('MCP verification timestamp invalid');
  return {
    report,
    payload: { encoding: 'base64', data: bytes.toString('base64') },
    sha256: pointer.sha256,
    bytes: pointer.bytes,
    observedAt: now,
    fresh: now - report.observedAt <= 10 * 60000,
    source: 'deploy_owned_verification_bundle',
  };
};

const readVerification = async (projectRoot: string, binding: Binding) => {
  const manifestBytes = await readFile(
    path.join(projectRoot, 'runtime-package-manifest.json'),
  );
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (
    !/^[a-f0-9]{40}$/.test(manifest.projectSha) ||
    !/^[\w-]+$/.test(binding.userName) ||
    !/^[\w-]+$/.test(binding.deploymentId) ||
    !/^dc1:[a-f0-9]+$/.test(binding.deploymentCompositionId)
  )
    throw Error('MCP verification identity invalid');
  const root = await realpath(
    path.join(projectRoot, 'data', 'runtime-verification'),
  );
  const dir = path.join(
    root,
    binding.userName,
    binding.deploymentId,
    manifest.projectSha,
    binding.deploymentCompositionId,
  );
  const confined = async (name: string) => {
    const resolved = await realpath(path.join(dir, name));
    if (!resolved.startsWith(root + path.sep))
      throw Error('MCP verification outside data root');
    return resolved;
  };
  const pointerBytes = await readFile(await confined('latest.json'));
  if (pointerBytes.length > 1024)
    throw Error('MCP verification pointer too large');
  const pointer = JSON.parse(pointerBytes.toString('utf8'));
  if (
    !/^[a-f0-9]{64}\.json$/.test(pointer.file) ||
    pointer.file !== `${pointer.sha256}.json` ||
    !Number.isSafeInteger(pointer.bytes) ||
    pointer.bytes < 1 ||
    pointer.bytes > 48000
  )
    throw Error('MCP verification pointer invalid');
  const payloadPath = await confined(pointer.file);
  if ((await stat(payloadPath)).size !== pointer.bytes)
    throw Error('MCP verification size mismatch');
  const bytes = await readFile(payloadPath);
  const result = parseDeploymentVerification(
    bytes,
    pointer,
    binding,
    manifestBytes,
    String(process.env.TRADEJS_PROJECT_IMAGE_DIGEST ?? ''),
  );
  const attemptPath = path.join(
    root,
    binding.userName,
    binding.deploymentId,
    'latest-attempt.json',
  );
  try {
    const resolved = await realpath(attemptPath);
    if (
      !resolved.startsWith(root + path.sep) ||
      (await stat(resolved)).size > 2048
    )
      throw Error('MCP verification attempt invalid');
    const attempt = JSON.parse(await readFile(resolved, 'utf8'));
    if (
      attempt.projectSha !== manifest.projectSha ||
      attempt.imageDigest !== result.report.imageDigest ||
      !Number.isSafeInteger(attempt.observedAt) ||
      !['running', 'failed', 'succeeded'].includes(attempt.status)
    )
      throw Error('MCP verification attempt binding invalid');
    return {
      ...result,
      fresh:
        result.fresh &&
        !(
          attempt.status !== 'succeeded' &&
          attempt.observedAt + 1000 >= result.report.observedAt
        ),
      collection: attempt,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return result;
  }
};

export const readDeploymentVerification = async (
  projectRoot: string,
  binding: Binding,
) => {
  try {
    return await readVerification(projectRoot, binding);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(
        'MCP deployment verification is not published for the current image and composition',
      );
    throw error;
  }
};
