import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  agentDetailSchema,
  agentTileListSchema,
  apiErrorResponseSchema,
  checkpointListSchema,
  type Department,
  departmentSchema,
  lineCommentListSchema,
  lineCommentSchema,
  type TaskDetail,
  taskDetailSchema,
  taskEventListSchema,
  workspaceDiffSchema,
  workspaceFileSchema,
  workspaceTreeSchema,
  workflowSchema,
} from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentReport,
  ScriptedEngine,
  stepNameOf,
  untilAborted,
  waitFor,
} from '../../test-support/scripted-engine';
import {
  startTestApplication,
  type TestApiResponse,
  type TestApplication,
} from '../../test-support/test-application';

function readErrorCode(response: TestApiResponse): string {
  return apiErrorResponseSchema.parse(response.body).error.code;
}

describe('live monitor and code review', () => {
  let app: TestApplication;
  let engine: ScriptedEngine;
  let project: string;
  let department: Department;
  let developerId: string;

  beforeEach(async () => {
    project = realpathSync(mkdtempSync(path.join(tmpdir(), 'aiteam-monitor-')));
    mkdirSync(path.join(project, 'app', 'src'), { recursive: true });
    writeFileSync(path.join(project, 'app', 'src', 'index.ts'), 'export const value = 1;\n');
    writeFileSync(path.join(project, 'app', '.gitignore'), 'node_modules/\n');
    mkdirSync(path.join(project, 'app', 'node_modules'));
    writeFileSync(path.join(project, 'app', 'node_modules', 'ignored.js'), '');
    engine = new ScriptedEngine();
    app = await startTestApplication(':memory:', { agentEngineOverride: engine });
    app.database.prepare('INSERT INTO allowed_directories (path) VALUES (?)').run(project);
    department = departmentSchema.parse(
      (await app.callApi('POST', '/api/departments', { name: 'Dev', color: '#60A5FA' })).body,
    );
    const developer = agentDetailSchema.parse(
      (
        await app.callApi('POST', `/api/departments/${department.id}/members`, {
          name: 'Dev backend',
          role: 'dev',
          provider: 'claude_code',
          reportsToPositionId: null,
        })
      ).body,
    );
    developerId = developer.id;
    await app.callApi('PATCH', `/api/agents/${developerId}/configuration`, {
      provider: 'claude_code',
      accessLevel: 'edit_workspace',
      networkAccess: false,
    });
  });

  afterEach(async () => {
    await app.closeApplication();
    rmSync(project, { recursive: true, force: true, maxRetries: 3 });
  });

  async function createTask(body: Record<string, unknown> = {}): Promise<TaskDetail> {
    const response = await app.callApi('POST', '/api/tasks', {
      departmentId: department.id,
      title: 'Thêm hàm đăng nhập',
      priority: 1,
      workingDirectory: path.join(project, 'app'),
      workflowId: null,
      ...body,
    });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    return taskDetailSchema.parse(response.body);
  }

  const readTask = async (taskId: string) =>
    taskDetailSchema.parse((await app.callApi('GET', `/api/tasks/${taskId}`)).body);
  const listCheckpoints = async (taskId: string) =>
    checkpointListSchema.parse((await app.callApi('GET', `/api/tasks/${taskId}/checkpoints`)).body);

  it('shows the worktree files, a file, checkpoints and their diffs; refuses paths outside', async () => {
    const task = await createTask();
    await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'succeeded',
      'success',
    );

    const tree = workspaceTreeSchema.parse(
      (await app.callApi('GET', `/api/tasks/${task.id}/workspace/tree`)).body,
    );
    const checkpoints = await listCheckpoints(task.id);
    const turnFile = 'turn-1.txt';
    const file = workspaceFileSchema.parse(
      (
        await app.callApi(
          'GET',
          `/api/tasks/${task.id}/workspace/file?path=${encodeURIComponent(turnFile)}`,
        )
      ).body,
    );
    const checkpointDiff = workspaceDiffSchema.parse(
      (await app.callApi('GET', `/api/checkpoints/${checkpoints[0]!.id}/diff`)).body,
    );
    const taskDiff = workspaceDiffSchema.parse(
      (await app.callApi('GET', `/api/tasks/${task.id}/diff`)).body,
    );
    const events = taskEventListSchema.parse(
      (await app.callApi('GET', `/api/tasks/${task.id}/events`)).body,
    );
    const escape = await app.callApi(
      'GET',
      `/api/tasks/${task.id}/workspace/file?path=${encodeURIComponent('../../secret.txt')}`,
    );
    const absolute = await app.callApi(
      'GET',
      `/api/tasks/${task.id}/workspace/file?path=${encodeURIComponent(path.join(project, 'app', 'src', 'index.ts'))}`,
    );

    expect(tree.agentFolder).toBe('');
    expect(tree.files).toEqual(expect.arrayContaining(['src/index.ts', '.gitignore', turnFile]));
    expect(tree.files.some((filePath) => filePath.startsWith('node_modules'))).toBe(false);
    expect(file).toMatchObject({ path: turnFile, binary: false });
    expect(file.content).toContain('<aiteam-report>');
    expect(checkpoints[0]).toMatchObject({
      agentName: 'Dev backend',
      files: [turnFile],
      openCommentCount: 0,
    });
    expect(checkpointDiff.files.map((changed) => [changed.path, changed.change])).toEqual([
      [turnFile, 'added'],
    ]);
    expect(taskDiff.files.map((changed) => changed.path)).toEqual([turnFile]);
    // Regression: the engine reports an absolute path; the log keeps it relative to the worktree.
    expect(events.find((event) => event.kind === 'file_change')).toMatchObject({
      filePath: turnFile,
      text: `tạo ${turnFile}`,
    });
    expect(escape.statusCode).toBe(400);
    expect(absolute.statusCode).toBe(400);
  }, 30_000);

  it('line comments + "Yêu cầu sửa" send the task back to the same agent, which makes a new checkpoint', async () => {
    const task = await createTask();
    await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'succeeded',
      'first run',
    );
    const [checkpoint] = await listCheckpoints(task.id);

    const comment = lineCommentSchema.parse(
      (
        await app.callApi('POST', `/api/checkpoints/${checkpoint!.id}/line-comments`, {
          filePath: 'turn-1.txt',
          line: 1,
          body: 'Đổi thông báo lỗi sang tiếng Việt',
        })
      ).body,
    );
    const review = await app.callApi('POST', `/api/tasks/${task.id}/reviews`, {
      decision: 'request_changes',
      checkpointId: checkpoint!.id,
    });
    expect(review.statusCode, JSON.stringify(review.body)).toBe(200);
    await waitFor(
      () => listCheckpoints(task.id),
      (checkpoints) => checkpoints.length === 2,
      'new checkpoint',
    );
    const done = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'succeeded',
      'second run',
    );

    expect(comment.status).toBe('open');
    expect(engine.requests).toHaveLength(2);
    expect(engine.requests[1]?.prompt).toContain(
      'turn-1.txt:1 — Đổi thông báo lỗi sang tiếng Việt',
    );
    // Same agent, same engine: the session continues.
    expect(engine.requests[1]?.resumeSessionRef).toBe('session-1');
    expect(done.assignee?.id).toBe(developerId);
    const comments = lineCommentListSchema.parse(
      (await app.callApi('GET', `/api/checkpoints/${checkpoint!.id}/line-comments`)).body,
    );
    expect(comments.map((stored) => stored.status)).toEqual(['sent']);
  }, 30_000);

  it('"Yêu cầu sửa" needs feedback, and "Duyệt thay đổi" passes the pending user approval', async () => {
    const workflow = workflowSchema.parse(
      (
        await app.callApi('POST', `/api/departments/${department.id}/workflows`, {
          name: 'Code rồi duyệt',
          source: { kind: 'blank' },
        })
      ).body,
    );
    await app.callApi('PUT', `/api/workflows/${workflow.id}/steps`, {
      steps: [
        {
          name: 'Code',
          ownerRole: 'dev',
          gate: 'user_approval',
          onFail: 'stop',
          returnToStepIndex: null,
          maxRetries: 0,
          requiredOutput: '',
        },
      ],
    });
    const task = await createTask({ workflowId: workflow.id });
    await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'waiting_approval',
      'approval',
    );
    const [checkpoint] = await listCheckpoints(task.id);

    const empty = await app.callApi('POST', `/api/tasks/${task.id}/reviews`, {
      decision: 'request_changes',
      checkpointId: checkpoint!.id,
    });
    const approved = await app.callApi('POST', `/api/tasks/${task.id}/reviews`, {
      decision: 'approve',
      checkpointId: checkpoint!.id,
    });

    expect(readErrorCode(empty)).toBe('REVIEW_WITHOUT_FEEDBACK');
    expect(taskDetailSchema.parse(approved.body).status).toBe('succeeded');
  }, 30_000);

  it('reverts a file to how it was when the task started, as a new checkpoint', async () => {
    const task = await createTask();
    await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'succeeded',
      'success',
    );
    const worktree = path.join(app.dataDirectory, 'worktrees', task.id);
    writeFileSync(path.join(worktree, 'src', 'index.ts'), 'export const value = 2;\n');

    await app.callApi('POST', `/api/tasks/${task.id}/workspace/file-reverts`, {
      path: 'turn-1.txt',
    });
    const reverted = await app.callApi('POST', `/api/tasks/${task.id}/workspace/file-reverts`, {
      path: 'src/index.ts',
    });

    expect(reverted.statusCode, JSON.stringify(reverted.body)).toBe(200);
    expect(existsSync(path.join(worktree, 'turn-1.txt'))).toBe(false);
    const content = workspaceFileSchema.parse(
      (await app.callApi('GET', `/api/tasks/${task.id}/workspace/file?path=src%2Findex.ts`)).body,
    ).content;
    // git may check files out with CRLF on Windows (core.autocrlf).
    expect(content?.replace(/\r\n/g, '\n')).toBe('export const value = 1;\n');
    expect((await listCheckpoints(task.id)).map((checkpoint) => checkpoint.message)).toEqual(
      expect.arrayContaining(['aiteam: hoàn tác turn-1.txt']),
    );
  }, 30_000);

  it('pauses a running task and resumes it with the same session; tiles follow', async () => {
    engine.respond = (request, signal) =>
      engine.requests.length === 1
        ? untilAborted(signal)
        : Promise.resolve(agentReport('done', `${stepNameOf(request.prompt)} xong`));
    const task = await createTask();
    await waitFor(
      () => engine.requests.length,
      (count) => count === 1,
      'first turn',
    );
    const workingTiles = agentTileListSchema.parse(
      (await app.callApi('GET', `/api/monitor/agents?departmentId=${department.id}`)).body,
    );

    await app.callApi('POST', `/api/tasks/${task.id}/pause`);
    const paused = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'paused',
      'paused',
    );
    const pausedTiles = agentTileListSchema.parse(
      (await app.callApi('GET', '/api/monitor/agents')).body,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(engine.requests).toHaveLength(1);
    const resumed = await app.callApi('POST', `/api/tasks/${task.id}/resume`);
    await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'succeeded',
      'success',
    );
    const finishedTiles = agentTileListSchema.parse(
      (await app.callApi('GET', '/api/monitor/agents')).body,
    );

    expect(workingTiles[0]).toMatchObject({
      state: 'working',
      workType: 'code',
      task: { code: task.code },
    });
    expect(paused.statusNote).toBe('Bạn đã tạm dừng task.');
    expect(pausedTiles[0]).toMatchObject({ state: 'waiting', task: { status: 'paused' } });
    expect(resumed.statusCode).toBe(200);
    expect(engine.requests[1]?.resumeSessionRef).toBe('session-1');
    // A finished task stays on the tile so its changes can still be reviewed.
    expect(finishedTiles[0]).toMatchObject({
      state: 'idle',
      task: { code: task.code, status: 'succeeded' },
    });
  }, 30_000);
});
