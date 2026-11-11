import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEngineEvent } from '@aiteam/contracts';
import type { CliProcessTracker } from '../../../../../shared/runtime/cli-process-tracker';
import { AntigravityCliEngine } from './antigravity-cli.engine';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

// These tests spawn real git (slow on Windows), so they get more than the default 5 s under load.
describe('AntigravityCliEngine', { timeout: 30_000 }, () => {
  it('ends with one failed event and spawns nothing when the workspace guard refuses', async () => {
    const workingDirectory = await mkdtemp(path.join(tmpdir(), 'aiteam-agy-work-'));
    const unrelatedRoot = await mkdtemp(path.join(tmpdir(), 'aiteam-agy-root-'));
    temporaryDirectories.push(workingDirectory, unrelatedRoot);
    const processTracker: CliProcessTracker = {
      recordSpawnedProcess: vi.fn(() => () => undefined),
      listRecordedProcesses: () => [],
      forgetRecordedProcess: () => undefined,
    };
    const engine = new AntigravityCliEngine(processTracker);

    const events: AgentEngineEvent[] = [];
    for await (const event of engine.startSession(
      {
        prompt: 'làm việc',
        workingDirectory,
        workspaceRoot: unrelatedRoot,
        model: null,
        permissions: {
          accessLevel: 'read_only',
          networkAccess: false,
          blockDangerousCommands: true,
        },
        resumeSessionRef: null,
        apiConnection: null,
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'failed',
        code: 'ENGINE_WORKSPACE_UNSUPPORTED',
        retryable: false,
      }),
    ]);
    expect(processTracker.recordSpawnedProcess).not.toHaveBeenCalled();
  });
});
