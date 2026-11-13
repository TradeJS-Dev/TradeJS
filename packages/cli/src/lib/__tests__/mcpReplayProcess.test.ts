/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildMcpReplayProcess } from '../mcpReplayProcess';

jest.mock('../runtimeEvidenceArtifacts', () => ({
  verifyRuntimeEvidenceBundle: async (directory: string) => ({
    payloadPath: path.join(directory, 'runtime-evidence.json'),
    manifest: {
      artifactId: 'artifact',
      deploymentId: 'production',
      payload: { sha256: 'b'.repeat(64) },
    },
  }),
}));

test.each(['original', 'missing', 'invalid'])(
  'failed replay preserves original failure with %s log',
  async (mode) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-client-'));
    try {
      const queue = path.join(root, 'data/mcp-replay-requests');
      await fs.mkdir(queue, { recursive: true });
      const evidencePath = path.join(root, 'data/runtime-evidence.json');
      await fs.writeFile(evidencePath, '{}');
      await fs.writeFile(
        path.join(queue, 'heartbeat.json'),
        JSON.stringify({ protocolVersion: 2, observedAt: Date.now() }),
      );
      const id = 'a'.repeat(64);
      const original = 'b'.repeat(64);
      await fs.writeFile(
        path.join(queue, id + '.result'),
        JSON.stringify({
          exitCode: 1,
          message: 'original preflight failure',
          logRequestId: mode === 'invalid' ? '../outside' : original,
        }),
      );
      if (mode === 'original')
        await fs.writeFile(
          path.join(queue, original + '.log'),
          'specific original cause\n',
        );
      const command = await buildMcpReplayProcess({
        evidencePath,
        outDir: root,
        runId: id,
        projectRoot: root,
        env: {},
      });
      expect(JSON.parse(command.args[4])).toMatchObject({
        payloadSha256: 'b'.repeat(64),
      });
      await expect(
        buildMcpReplayProcess({
          evidencePath,
          expectedEvidenceSha256: 'c'.repeat(64),
          outDir: root,
          runId: id,
          projectRoot: root,
          env: {},
        }),
      ).rejects.toThrow('changed since job submission');
      const result = spawnSync(command.executable, command.args, {
        encoding: 'utf8',
        timeout: 5000,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('original preflight failure');
      expect(result.stderr).toContain(
        mode === 'original'
          ? 'specific original cause'
          : 'original preflight failure; log unavailable:',
      );
      expect(result.stderr).not.toContain(
        'Host replay log unavailable: ENOENT',
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
