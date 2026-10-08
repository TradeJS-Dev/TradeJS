import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type RuntimeEvidenceProducer = {
  schemaVersion: 1;
  projectSha: string;
  imageDigest: string;
  runtimePackageManifest: {
    file: 'runtime-package-manifest.json';
    sha256: string;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const sha256 = (value: Buffer) =>
  createHash('sha256').update(value).digest('hex');

export const parseRuntimeEvidenceProducer = (
  value: unknown,
): RuntimeEvidenceProducer => {
  const producer = isRecord(value) ? value : null;
  const runtimePackageManifest = isRecord(producer?.runtimePackageManifest)
    ? producer.runtimePackageManifest
    : null;

  if (
    producer?.schemaVersion !== 1 ||
    typeof producer.projectSha !== 'string' ||
    !/^[a-f0-9]{40}$/.test(producer.projectSha) ||
    typeof producer.imageDigest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(producer.imageDigest) ||
    runtimePackageManifest?.file !== 'runtime-package-manifest.json' ||
    typeof runtimePackageManifest.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(runtimePackageManifest.sha256)
  ) {
    throw new Error('Runtime evidence producer image identity is invalid');
  }

  return producer as unknown as RuntimeEvidenceProducer;
};

export const resolveRuntimeEvidenceProducer = async ({
  projectRoot,
  required,
}: {
  projectRoot: string;
  required: boolean;
}): Promise<RuntimeEvidenceProducer | null> => {
  const projectSha = String(process.env.TRADEJS_PROJECT_SHA ?? '').trim();
  const imageDigest = String(
    process.env.TRADEJS_PROJECT_IMAGE_DIGEST ?? '',
  ).trim();

  if (!projectSha && !imageDigest && !required) {
    return null;
  }
  if (!/^[a-f0-9]{40}$/.test(projectSha)) {
    throw new Error(
      'TRADEJS_PROJECT_SHA must be a full lowercase Git SHA before publishing runtime evidence',
    );
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(imageDigest)) {
    throw new Error(
      'TRADEJS_PROJECT_IMAGE_DIGEST must be an immutable sha256 digest before publishing runtime evidence',
    );
  }

  const manifestPath = path.join(projectRoot, 'runtime-package-manifest.json');
  let manifest: Buffer;
  try {
    manifest = await fs.readFile(manifestPath);
  } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new Error(
      `Runtime package manifest is required for runtime evidence: ${manifestPath}`,
      { cause: error },
    );
  }

  return {
    schemaVersion: 1,
    projectSha,
    imageDigest,
    runtimePackageManifest: {
      file: 'runtime-package-manifest.json',
      sha256: sha256(manifest),
    },
  };
};
