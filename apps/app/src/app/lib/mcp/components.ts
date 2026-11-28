import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { INSTALL_USER_NAME } from '../installation';

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const timestamp = z.number().int().nonnegative();
const applicationNames = ['app', 'agent', 'ml-infer', 'site', 'docs'] as const;
const standaloneNames = [
  ...applicationNames,
  'certbot',
  'certbot-cron',
] as const;
const componentSchema = z
  .object({
    name: z.enum(standaloneNames),
    declaredImage: z
      .string()
      .regex(
        /^ghcr\.io\/tradejs-dev\/tradejs-[a-z-]+(?::[a-f0-9]{40}|@sha256:[a-f0-9]{64})$/,
      ),
    sourceSha: sha.nullable(),
    containerId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    imageId: digest.nullable(),
    imageDigest: digest.nullable(),
    state: z.enum([
      'missing',
      'created',
      'running',
      'paused',
      'restarting',
      'removing',
      'exited',
      'dead',
    ]),
    running: z.boolean(),
    health: z.enum(['healthy', 'unhealthy', 'starting']).nullable(),
    startedAt: z.string().nullable(),
    exitCode: z.number().int().nullable(),
    restartCount: z.number().int().nonnegative().nullable(),
    matchesRelease: z.boolean().nullable(),
    ok: z.boolean(),
  })
  .strict();
const reportSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    reportType: z.literal('runtime-components'),
    userName: z.literal(INSTALL_USER_NAME),
    projectSha: sha,
    deploySourceSha: sha,
    observedAt: timestamp,
    ok: z.boolean(),
    components: z.array(componentSchema).max(standaloneNames.length),
  })
  .strict();
const envelopeSchema = z
  .object({
    bytes: z.number().int().min(1).max(48000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    data: z
      .string()
      .max(64000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
const attemptSchema = z
  .object({
    observedAt: timestamp,
    status: z.enum(['running', 'failed', 'succeeded']),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();

/** Reads only a Deploy-owned snapshot. No Docker, credentials or collection jobs. */
export const readRuntimeComponents = async (
  projectRoot: string,
  userName: string,
  now = Date.now(),
) => {
  if (userName !== INSTALL_USER_NAME)
    throw Error('MCP components require the installation owner');
  const root = await realpath(
    path.join(projectRoot, 'data', 'runtime-components', userName),
  );
  const read = async (name: string, limit: number) => {
    const file = await realpath(path.join(root, name));
    if (!file.startsWith(root + path.sep) || (await stat(file)).size > limit)
      throw Error('MCP component file invalid');
    const bytes = await readFile(file);
    if (bytes.length > limit) throw Error('MCP component file too large');
    return JSON.parse(bytes.toString('utf8')) as unknown;
  };
  const envelope = envelopeSchema.parse(await read('latest.json', 70000));
  const bytes = Buffer.from(envelope.data, 'base64');
  if (
    bytes.length !== envelope.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== envelope.sha256
  )
    throw Error('MCP component checksum mismatch');
  const report = reportSchema.parse(JSON.parse(bytes.toString('utf8')));
  const manifest = z
    .object({ projectSha: sha })
    .parse(
      JSON.parse(
        await readFile(
          path.join(projectRoot, 'runtime-package-manifest.json'),
          'utf8',
        ),
      ),
    );
  const app = report.components.find((c) => c.name === 'app');
  const expectedNames =
    report.schemaVersion === 1 ? standaloneNames : applicationNames;
  const observedNames = new Set(report.components.map((c) => c.name));
  if (
    report.components.length !== expectedNames.length ||
    !expectedNames.every((name) => observedNames.has(name)) ||
    report.projectSha !== manifest.projectSha ||
    app?.sourceSha !== manifest.projectSha ||
    app.imageDigest !== process.env.TRADEJS_PROJECT_IMAGE_DIGEST
  )
    throw Error('MCP component binding mismatch');
  if (
    report.observedAt > now + 30000 ||
    report.ok !== report.components.every((c) => c.ok) ||
    report.components.some(
      (c) =>
        c.ok &&
        (!c.matchesRelease ||
          !c.imageDigest ||
          !c.imageId ||
          !c.containerId ||
          (!(c.running && c.state === 'running') &&
            !(
              c.name === 'certbot' &&
              c.state === 'exited' &&
              c.exitCode === 0
            )) ||
          ![null, 'healthy'].includes(c.health)),
    )
  )
    throw Error('MCP component result invalid');
  const collection = attemptSchema.parse(
    await read('latest-attempt.json', 2048),
  );
  if (
    collection.observedAt > now + 30000 ||
    (collection.status === 'succeeded' &&
      (collection.sha256 !== envelope.sha256 ||
        collection.observedAt !== report.observedAt))
  )
    throw Error('MCP component collection invalid');
  const ageMs = Math.max(0, now - report.observedAt);
  return {
    report,
    payload: { encoding: 'base64', data: envelope.data },
    bytes: envelope.bytes,
    sha256: envelope.sha256,
    observedAt: now,
    ageMs,
    fresh: ageMs <= 25 * 60 * 60000 && collection.status === 'succeeded',
    collection,
    source: 'deploy_owned_component_snapshot',
  };
};
