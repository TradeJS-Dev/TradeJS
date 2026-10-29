import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  MCP_FEEDBACK_CONTRACT,
  assertMcpFeedbackContract,
  type McpToolDescription,
} from './mcpFeedbackContract';
import { verifyRuntimeEvidenceBundle } from './runtimeEvidenceArtifacts';
import { verifyRuntimeFeedbackReplayBundle } from './runtimeFeedbackArtifacts';

export type McpArtifactFile =
  | 'payload'
  | 'manifest.json'
  | '.complete'
  | 'replay.log';
export type McpBundleDescriptor = {
  id: string;
  kind: 'runtime-evidence' | 'runtime-feedback-replay';
  files: {
    file: McpArtifactFile;
    bytes: number;
    sha256: string;
    available: boolean;
  }[];
};
export class McpReadTransportError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}
type ChunkRequest = {
  artifactId: string;
  file: McpArtifactFile;
  offset: number;
  length: number;
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const exists = async (file: string) =>
  fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
const checkFile = async (file: string) => {
  const stat = await exists(file);
  if (stat && (!stat.isFile() || stat.isSymbolicLink()))
    throw new Error('Invalid local bundle file');
  return stat;
};

/** The caller owns the authenticated MCP connection. This function only reads artifacts. */
export const downloadMcpBundle = async ({
  descriptor,
  root,
  contractVersion,
  tools,
  readChunk,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: {
  descriptor: McpBundleDescriptor;
  root: string;
  contractVersion: unknown;
  tools: McpToolDescription[];
  readChunk: (request: ChunkRequest) => Promise<unknown>;
  wait?: (ms: number) => Promise<unknown>;
}) => {
  assertMcpFeedbackContract(contractVersion, tools);
  if (!/^[a-f0-9]{64}$/.test(descriptor.id))
    throw new Error('Invalid artifact identity');
  const required: McpArtifactFile[] = ['payload', 'manifest.json', '.complete'];
  if (descriptor.kind === 'runtime-feedback-replay')
    required.push('replay.log');
  for (const name of required) {
    const matches = descriptor.files.filter((f) => f.file === name);
    if (
      matches.length !== 1 ||
      !matches[0].available ||
      !Number.isSafeInteger(matches[0].bytes) ||
      matches[0].bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(matches[0].sha256)
    )
      throw new Error(`Incomplete bundle descriptor: ${name}`);
  }
  const bundleDir = path.join(root, descriptor.id);
  await fs.mkdir(bundleDir, { recursive: true });
  const dir = await fs.lstat(bundleDir);
  if (dir.isSymbolicLink()) throw new Error('Invalid bundle directory');
  const lock = path.join(bundleDir, '.download-lock');
  await fs.mkdir(lock);
  try {
    // Publish the original complete marker only after every other file is verified.
    for (const name of [
      ...required.filter((f) => f !== '.complete'),
      '.complete' as const,
    ]) {
      const expected = descriptor.files.find((f) => f.file === name);
      if (!expected) throw new Error('Missing bundle file');
      const filename =
        name === 'payload'
          ? descriptor.kind === 'runtime-evidence'
            ? 'runtime-evidence.json'
            : 'replay-runtime-evidence.json'
          : name;
      const target = path.join(bundleDir, filename);
      const verified = await checkFile(target);
      if (verified) {
        if (
          verified.size !== expected.bytes ||
          digest(await fs.readFile(target)) !== expected.sha256
        )
          throw new Error('Local bundle checksum mismatch');
        continue;
      }
      const partial = target + '.part';
      const checkpoint = partial + '.json';
      const identity = JSON.stringify({
        artifactId: descriptor.id,
        file: name,
        bytes: expected.bytes,
        sha256: expected.sha256,
      });
      await checkFile(checkpoint);
      const stat = await checkFile(partial);
      if (stat) {
        if (
          (await fs.readFile(checkpoint, 'utf8')) !== identity ||
          stat.size > expected.bytes
        )
          throw new Error('Artifact changed during download');
      } else {
        if (await checkFile(checkpoint)) {
          if ((await fs.readFile(checkpoint, 'utf8')) !== identity)
            throw new Error('Artifact changed during download');
        } else await fs.writeFile(checkpoint, identity, { flag: 'wx' });
      }
      let offset = stat?.size ?? 0;
      if (!stat) await fs.writeFile(partial, Buffer.alloc(0), { flag: 'wx' });
      while (offset < expected.bytes) {
        const request = {
          artifactId: descriptor.id,
          file: name,
          offset,
          length: MCP_FEEDBACK_CONTRACT.maximumChunkBytes,
        };
        let response: unknown;
        for (let attempt = 0; ; attempt++) {
          try {
            response = await readChunk(request);
            break;
          } catch (error) {
            if (!(error instanceof McpReadTransportError) || attempt >= 3)
              throw error;
            await wait(
              Math.max([2000, 5000, 10000][attempt], error.retryAfterMs ?? 0),
            );
          }
        }
        if (
          !record(response) ||
          response.id !== descriptor.id ||
          response.file !== name ||
          response.offset !== offset ||
          response.bytes !== expected.bytes ||
          response.sha256 !== expected.sha256 ||
          response.encoding !== 'base64' ||
          typeof response.data !== 'string' ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            response.data,
          )
        )
          throw new Error('Invalid artifact chunk identity');
        const bytes = Buffer.from(response.data, 'base64');
        const next = offset + bytes.length;
        if (
          !bytes.length ||
          bytes.length > request.length ||
          next > expected.bytes ||
          response.nextOffset !== (next === expected.bytes ? null : next)
        )
          throw new Error('Invalid artifact chunk range');
        await fs.appendFile(partial, bytes);
        offset = next;
      }
      if (digest(await fs.readFile(partial)) !== expected.sha256)
        throw new Error('Downloaded bundle checksum mismatch');
      await fs.rename(partial, target);
      await fs.unlink(checkpoint);
    }
    const bundle =
      descriptor.kind === 'runtime-evidence'
        ? await verifyRuntimeEvidenceBundle(bundleDir)
        : await verifyRuntimeFeedbackReplayBundle(bundleDir);
    return bundle;
  } finally {
    await fs.rmdir(lock);
  }
};
