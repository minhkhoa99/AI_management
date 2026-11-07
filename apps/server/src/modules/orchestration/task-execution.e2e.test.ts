import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AgentDetail,
  agentDetailSchema,
  approvalListSchema,
  type Department,
  departmentSchema,
  taskDeletionSchema,
  type TaskDetail,
  taskDetailSchema,
  taskEventListSchema,
  type Workflow,
  workflowSchema,
} from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentReport as report,
  ScriptedEngine,
  stepNameOf,
  waitFor,
} from '../../test-support/scripted-engine';
import { startTestApplication, type TestApplication } from '../../test-support/test-application';

describe('task execution', () => {
  let app: TestApplication;
  let engine: ScriptedEngine;
  let project: string;
  let department: Department;
  let departmentHead: AgentDetail;
  let pm: AgentDetail;
  let developer: AgentDetail;
  let qc: AgentDetail;

  beforeEach(async () => {
    project = realpathSync(mkdtempSync(path.join(tmpdir(), 'aiteam-exec-')));
    mkdirSync(path.join(project, 'shop'));
    writeFileSync(path.join(project, 'shop', 'README.md'), '# shop\n');
    engine = new ScriptedEngine();
    app = await startTestApplication(':memory:', { agentEngineOverride: engine });
    app.database.prepare('INSERT INTO allowed_directories (path) VALUES (?)').run(project);
    department = departmentSchema.parse(
      (await app.callApi('POST', '/api/departments', { name: 'Dev', color: '#60A5FA' })).body,
    );
    const addMember = async (body: Record<string, unknown>) =>
      agentDetailSchema.parse(
        (await app.callApi('POST', `/api/departments/${department.id}/members`, body)).body,
      );
    departmentHead = await addMember({
      name: 'Manager Dev',
      role: 'manager',
      provider: 'claude_code',
      reportsToPositionId: null,
    });
    pm = await addMember({
      name: 'PM Linh',
      role: 'pm',
      provider: 'claude_code',
      reportsToPositionId: departmentHead.positionId,
    });
    developer = await addMember({
      name: 'Dev backend',
      role: 'dev',
      provider: 'codex',
      reportsToPositionId: pm.positionId,
    });
    qc = await addMember({
      name: 'QC Minh',
      role: 'qc',
      provider: 'codex',
      reportsToPositionId: pm.positionId,
    });
    for (const agent of [departmentHead, pm, developer, qc]) {
      await app.callApi('PATCH', `/api/agents/${agent.id}/configuration`, {
        provider: agent.provider,
        accessLevel: 'edit_workspace',
        networkAccess: false,
      });
    }
  });

  afterEach(async () => {
    await app.closeApplication();
    rmSync(project, { recursive: true, force: true, maxRetries: 3 });
  });

  async function createWorkflow(templateId: string): Promise<Workflow> {
    return workflowSchema.parse(
      (
        await app.callApi('POST', `/api/departments/${department.id}/workflows`, {
          name: `Quy trình ${templateId}`,
          source: { kind: 'template', templateId },
        })
      ).body,
    );
  }

  async function createTask(body: Record<string, unknown>): Promise<TaskDetail> {
    const response = await app.callApi('POST', '/api/tasks', {
      departmentId: department.id,
      title: 'API đăng nhập',
      criteria: 'Sai mật khẩu trả 401',
      priority: 1,
      workingDirectory: path.join(project, 'shop'),
      ...body,
    });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    return taskDetailSchema.parse(response.body);
  }

  const readTask = async (taskId: string) =>
    taskDetailSchema.parse((await app.callApi('GET', `/api/tasks/${taskId}`)).body);
  const pendingApprovals = async () =>
    approvalListSchema.parse((await app.callApi('GET', '/api/approvals?status=pending')).body);

  it('runs Manager → PM → Dev → QC → review → user approval on the software template', async () => {
    await createWorkflow('software');
    const task = await createTask({ testCommand: 'node -e "process.exit(0)"' });

    const waiting = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'waiting_approval',
      'user approval',
    );
    const [approval] = await pendingApprovals();
    expect(approval).toMatchObject({
      kind: 'step_gate',
      stepName: 'Duyệt phát hành',
      task: { code: task.code },
    });
    const decided = await app.callApi('POST', `/api/approvals/${approval!.id}/decision`, {
      approved: true,
    });
    expect(decided.statusCode).toBe(200);
    const done = await readTask(task.id);

    expect(waiting.workflowSteps.map((step) => step.name)).toHaveLength(6);
    expect(done.status).toBe('succeeded');
    expect(done.boardColumn).toBe('done');
    // Who worked, in order: steps 1-5 and the two reviews by the superiors.
    expect(engine.requests.map((request) => stepNameOf(request.prompt))).toEqual([
      'Tiếp nhận và lập kế hoạch',
      'Chia task',
      'review',
      'Phát triển',
      'Kiểm thử',
      'Review',
      'review',
    ]);
    expect(done.delegations.map((delegation) => delegation.toAgentName)).toEqual([
      'PM Linh',
      'Dev backend',
      'QC Minh',
      'PM Linh',
    ]);
    // Reviews are read-only whatever the reviewer may do otherwise.
    expect(engine.requests[2]?.permissions.accessLevel).toBe('read_only');
    // Each step sees the previous results; the work lives on the task branch, not in the folder.
    expect(engine.requests[3]?.prompt).toContain('Kết quả các bước trước');
    const log = execFileSync(
      'git',
      ['-C', path.join(project, 'shop'), 'log', '--oneline', `agent/${task.id}`],
      {
        encoding: 'utf8',
      },
    );
    expect(log).toContain(task.code);
    expect(existsSync(path.join(project, 'shop', 'turn-1.txt'))).toBe(false);
    const events = taskEventListSchema.parse(
      (await app.callApi('GET', `/api/tasks/${task.id}/events?limit=200`)).body,
    );
    expect(events.map((event) => event.kind)).toContain('gate_evaluated');
  }, 60_000);

  it('deleting a running task stops the agent within 5 seconds and keeps its branch', async () => {
    let sawAbort = false;
    engine.respond = (_request, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          sawAbort = true;
          reject(new Error('aborted'));
        });
      });
    const task = await createTask({ workflowId: null });
    await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'running' && engine.requests.length > 0,
      'running',
    );
    const worktree = path.join(app.dataDirectory, 'worktrees', task.id);
    await waitFor(() => existsSync(worktree), Boolean, 'worktree');

    const startedAt = Date.now();
    const deletion = taskDeletionSchema.parse(
      (await app.callApi('DELETE', `/api/tasks/${task.id}`)).body,
    );
    await waitFor(
      async () => (await app.callApi('GET', `/api/tasks/${task.id}`)).statusCode,
      (status) => status === 404,
      'deletion',
    );

    expect(deletion.outcome).toBe('cancelling');
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(sawAbort).toBe(true);
    expect(existsSync(worktree)).toBe(false);
    const branches = execFileSync(
      'git',
      ['-C', path.join(project, 'shop'), 'branch', '--list', `agent/${task.id}`],
      {
        encoding: 'utf8',
      },
    );
    expect(branches).toContain(`agent/${task.id}`);
  }, 30_000);

  it('QC failure returns the task to development with the feedback, then passes', async () => {
    await createWorkflow('hotfix');
    let qcTurns = 0;
    engine.respond = (request) => {
      const step = stepNameOf(request.prompt);
      if (step === 'Kiểm thử') {
        qcTurns += 1;
        return Promise.resolve(
          qcTurns === 1 ? report('fail', 'TC-03 lỗi 500') : report('pass', 'đạt'),
        );
      }
      return Promise.resolve(report('done', `${step} xong`));
    };
    const task = await createTask({ assigneeAgentId: pm.id });

    await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'waiting_approval',
      'deploy approval',
    );

    const steps = engine.requests.map((request) => stepNameOf(request.prompt));
    expect(steps).toEqual(['Tiếp nhận lỗi', 'Sửa lỗi', 'Kiểm thử', 'Sửa lỗi', 'Kiểm thử']);
    expect(engine.requests[3]?.prompt).toContain('TC-03 lỗi 500');
  }, 60_000);

  it('failing tests are retried up to the step limit, then the task fails', async () => {
    await createWorkflow('hotfix');
    const task = await createTask({
      assigneeAgentId: pm.id,
      testCommand: 'node -e "console.log(\'2 failed\'); process.exit(1)"',
    });

    const failed = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'failed',
      'failure',
    );

    expect(engine.requests.map((request) => stepNameOf(request.prompt))).toEqual([
      'Tiếp nhận lỗi',
      'Sửa lỗi',
      'Sửa lỗi',
      'Sửa lỗi',
    ]);
    expect(engine.requests[2]?.prompt).toContain('2 failed');
    expect(failed.statusNote).toContain('không đạt sau 2 lần thử lại');
    expect((await app.callApi('POST', `/api/tasks/${task.id}/retries`)).statusCode).toBe(201);
  }, 60_000);

  it('sensitive work waits for the user, then the same agent session continues', async () => {
    let turns = 0;
    engine.respond = () => {
      turns += 1;
      return Promise.resolve(
        turns === 1
          ? report('needs_approval', 'cần xoá bảng cũ', 'DROP TABLE sessions')
          : report('done', 'đã xoá và xong'),
      );
    };
    const task = await createTask({ workflowId: null });

    await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'waiting_approval',
      'approval',
    );
    const [approval] = await pendingApprovals();
    expect(approval).toMatchObject({ kind: 'sensitive_action', request: 'DROP TABLE sessions' });
    await app.callApi('POST', `/api/approvals/${approval!.id}/decision`, {
      approved: true,
      note: 'ok',
    });
    await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'succeeded',
      'success',
    );

    expect(engine.requests[1]?.resumeSessionRef).toBe('session-1');
    expect(engine.requests[1]?.prompt).toContain('Người dùng đã DUYỆT');
  }, 30_000);

  it('reducing the agent permissions stops the current turn and reruns it with the new ones', async () => {
    let release: (() => void) | undefined;
    engine.respond = (request, signal) =>
      engine.requests.length === 1
        ? new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          })
        : new Promise((resolve) => {
            release = () => resolve(report('done', `xong với ${request.permissions.accessLevel}`));
          });
    const task = await createTask({ workflowId: null });
    await waitFor(
      () => engine.requests.length,
      (count) => count === 1,
      'first turn',
    );

    await app.callApi('PATCH', `/api/agents/${departmentHead.id}/configuration`, {
      provider: 'claude_code',
      accessLevel: 'read_only',
      networkAccess: false,
    });
    await waitFor(
      () => engine.requests.length,
      (count) => count === 2,
      'second turn',
    );
    release?.();
    await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'succeeded',
      'success',
    );

    expect(engine.requests[1]?.permissions.accessLevel).toBe('read_only');
  }, 30_000);

  it('hands a waiting task to a direct subordinate only', async () => {
    // The head is switched off: the task waits in the queue for a Manager.
    await app.callApi('PATCH', `/api/agents/${departmentHead.id}/enabled`, { enabled: false });
    const task = await createTask({ workflowId: null });
    await waitFor(
      () => readTask(task.id),
      (detail) => (detail.statusNote ?? '').includes('Chờ'),
      'waiting note',
    );

    const skipLevel = await app.callApi('POST', `/api/tasks/${task.id}/delegations`, {
      toAgentId: developer.id,
    });
    const direct = await app.callApi('POST', `/api/tasks/${task.id}/delegations`, {
      toAgentId: pm.id,
    });

    expect(skipLevel.statusCode).toBe(400);
    expect(direct.statusCode, JSON.stringify(direct.body)).toBe(201);
    const detail = taskDetailSchema.parse(direct.body);
    expect(detail.assignee?.id).toBe(pm.id);
    expect(detail.delegations.at(-1)).toMatchObject({
      fromAgentName: 'Manager Dev',
      toAgentName: 'PM Linh',
      reason: 'manual',
    });
  }, 30_000);
});
