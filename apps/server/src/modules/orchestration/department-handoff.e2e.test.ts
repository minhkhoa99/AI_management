import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AgentDetail,
  agentDetailSchema,
  approvalListSchema,
  type Department,
  departmentSchema,
  taskDetailSchema,
  taskEventListSchema,
  workflowSchema,
} from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TASK_REPOSITORY, type TaskRepository } from './domain/repositories/task.repository';
import {
  agentReport,
  ScriptedEngine,
  untilAborted,
  waitFor,
} from '../../test-support/scripted-engine';
import { startTestApplication, type TestApplication } from '../../test-support/test-application';

const HANDED_OFF = 'phòng khác bàn giao';

describe('department handoff', () => {
  let app: TestApplication;
  let engine: ScriptedEngine;
  let project: string;
  let dev: Department;
  let review: Department;
  let devHead: AgentDetail;
  let qcHead: AgentDetail;

  beforeEach(async () => {
    project = realpathSync(mkdtempSync(path.join(tmpdir(), 'aiteam-handoff-')));
    mkdirSync(path.join(project, 'shop'));
    writeFileSync(path.join(project, 'shop', 'README.md'), '# shop\n');
    engine = new ScriptedEngine();
    app = await startTestApplication(':memory:', { agentEngineOverride: engine });
    app.database.prepare('INSERT INTO allowed_directories (path) VALUES (?)').run(project);
    dev = await createDepartment('Dev');
    review = await createDepartment('Review');
    devHead = await addHead(dev, 'Dev An', 'dev');
    qcHead = await addHead(review, 'QC Minh', 'qc');
    await saveWorkflow(review, 'Duyệt', [
      {
        name: 'Duyệt code',
        ownerRole: 'qc',
        gate: 'qc_pass',
        onFail: 'retry',
        returnToStepIndex: null,
        maxRetries: 2,
        requiredOutput: '',
      },
    ]);
  });

  afterEach(async () => {
    await app.closeApplication();
    rmSync(project, { recursive: true, force: true, maxRetries: 3 });
  });

  async function createDepartment(name: string) {
    return departmentSchema.parse(
      (await app.callApi('POST', '/api/departments', { name, color: '#60A5FA' })).body,
    );
  }

  async function addHead(department: Department, name: string, role: string) {
    const agent = agentDetailSchema.parse(
      (
        await app.callApi('POST', `/api/departments/${department.id}/members`, {
          name,
          role,
          provider: 'codex',
          reportsToPositionId: null,
        })
      ).body,
    );
    await app.callApi('PATCH', `/api/agents/${agent.id}/configuration`, {
      provider: agent.provider,
      accessLevel: 'edit_workspace',
      networkAccess: false,
    });
    return agent;
  }

  /** A new workflow of the department (the first one is its default) with these steps. */
  async function saveWorkflow(department: Department, name: string, steps: unknown[]) {
    const workflow = workflowSchema.parse(
      (
        await app.callApi('POST', `/api/departments/${department.id}/workflows`, {
          name,
          source: { kind: 'blank' },
        })
      ).body,
    );
    const saved = await app.callApi('PUT', `/api/workflows/${workflow.id}/steps`, { steps });
    expect(saved.statusCode, JSON.stringify(saved.body)).toBe(200);
    return workflowSchema.parse(saved.body);
  }

  const codeStep = {
    name: 'Code',
    ownerRole: 'dev',
    gate: 'auto',
    onFail: 'stop',
    returnToStepIndex: null,
    maxRetries: 0,
    requiredOutput: '',
  };
  const handoffStep = (departmentId: string) => ({
    name: 'Review',
    ownerRole: 'department',
    gate: 'auto',
    onFail: 'return_to_step',
    returnToStepIndex: 0,
    maxRetries: 0,
    requiredOutput: 'Nhận xét',
    handoffDepartmentId: departmentId,
  });

  async function createTask(workflowId: string) {
    const response = await app.callApi('POST', '/api/tasks', {
      departmentId: dev.id,
      title: 'Trang đăng nhập',
      description: 'Form đăng nhập',
      priority: 1,
      workflowId,
      assigneeAgentId: devHead.id,
      workingDirectory: path.join(project, 'shop'),
    });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    return taskDetailSchema.parse(response.body);
  }

  const readTask = async (taskId: string) =>
    taskDetailSchema.parse((await app.callApi('GET', `/api/tasks/${taskId}`)).body);
  const readEventKinds = async (taskId: string) =>
    taskEventListSchema
      .parse((await app.callApi('GET', `/api/tasks/${taskId}/events?limit=100`)).body)
      .map((event) => event.kind);
  const worktreeOf = (taskId: string) =>
    (
      app.database.prepare('SELECT worktree_path FROM tasks WHERE id = ?').get(taskId) as {
        worktree_path: string;
      }
    ).worktree_path;
  const requestsOf = (taskId: string) =>
    engine.requests.filter((request) => request.workingDirectory.includes(taskId));
  /** Payloads of the task's events of `kind`, oldest first (events are written in batches). */
  const payloadsOf = (taskId: string, kind: string) =>
    (
      app.database
        .prepare('SELECT payload_json FROM task_events WHERE task_id = ? AND kind = ? ORDER BY id')
        .all(taskId, kind) as Array<{ payload_json: string }>
    ).map((row) => JSON.parse(row.payload_json) as Record<string, unknown>);
  const devRequests = () =>
    engine.requests.filter((request) => !request.prompt.includes(HANDED_OFF));

  it('hands the step to the head of the other department on its default workflow', async () => {
    const devFlow = await saveWorkflow(dev, 'Code và duyệt', [codeStep, handoffStep(review.id)]);
    engine.respond = (request, signal) =>
      request.prompt.includes(HANDED_OFF)
        ? untilAborted(signal)
        : Promise.resolve(agentReport('done', 'Đã code'));
    const task = await createTask(devFlow.id);

    const waiting = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'waiting_children' && detail.subtasks.length === 1,
      'parent waiting for the other department',
    );
    const childId = waiting.subtasks[0]!.id;
    await waitFor(
      () => requestsOf(childId).length,
      (count) => count === 1,
      'review turn started',
    );
    const child = await readTask(childId);
    const reviewFlowId = (
      app.database
        .prepare('SELECT id FROM workflows WHERE department_id = ? AND is_default = 1')
        .get(review.id) as { id: string }
    ).id;

    expect(child.departmentId).toBe(review.id);
    expect(child.workflow?.id).toBe(reviewFlowId);
    expect(child.assignee?.id).toBe(qcHead.id);
    expect(child.description).toContain('Phòng Dev bàn giao bước «Review» của');
    expect(child.description).toContain('Đầu ra cần có: Nhận xét');
    expect(child.description).toContain('- Code (Dev An): Đã code');
    expect(waiting.currentStep?.name).toBe('Review');
    const devFiles = readdirSync(worktreeOf(task.id)).filter((file) => file.startsWith('turn-'));
    expect(devFiles.length).toBeGreaterThan(0);
    expect(readdirSync(worktreeOf(childId))).toEqual(expect.arrayContaining(devFiles));
    expect(await readEventKinds(task.id)).toContain('handoff_sent');
    expect(requestsOf(task.id)).toHaveLength(1);
  }, 30_000);

  it('ends a handed-off task at its first failed gate, ignoring the target workflow retries', async () => {
    const devFlow = await saveWorkflow(dev, 'Code và duyệt', [codeStep, handoffStep(review.id)]);
    engine.respond = (request) =>
      Promise.resolve(
        request.prompt.includes(HANDED_OFF)
          ? agentReport('fail', 'Thiếu test')
          : agentReport('done', 'Đã code'),
      );
    const task = await createTask(devFlow.id);

    const waiting = await waitFor(
      () => readTask(task.id),
      (detail) => detail.subtasks.length === 1,
      'handoff child created',
    );
    const childId = waiting.subtasks[0]!.id;
    const child = await waitFor(
      () => readTask(childId),
      (detail) => detail.status === 'failed',
      'handoff child failed',
    );

    expect(requestsOf(childId)).toHaveLength(1);
    expect(child.statusNote).toContain('Thiếu test');
    // Events are written in batches: wait for the row.
    const failed = await waitFor(
      () =>
        app.database
          .prepare(
            "SELECT payload_json FROM task_events WHERE task_id = ? AND kind = 'task_failed'",
          )
          .get(childId) as { payload_json: string } | undefined,
      (row) => row !== undefined,
      'task_failed event written',
    );
    expect(JSON.parse(failed!.payload_json)).toMatchObject({ reason: 'gate_rejected' });
  }, 30_000);

  it('fails the parent before spending tokens when the target hands off again or has no members', async () => {
    const empty = await createDepartment('Thiết kế');
    // Review's default workflow now hands off itself.
    const reviewFlowId = (
      app.database
        .prepare('SELECT id FROM workflows WHERE department_id = ? AND is_default = 1')
        .get(review.id) as { id: string }
    ).id;
    const resaved = await app.callApi('PUT', `/api/workflows/${reviewFlowId}/steps`, {
      steps: [
        { ...codeStep, ownerRole: 'qc' },
        { ...handoffStep(dev.id), name: 'Gửi lại' },
      ],
    });
    expect(resaved.statusCode, JSON.stringify(resaved.body)).toBe(200);
    const nested = await saveWorkflow(dev, 'Lồng nhau', [codeStep, handoffStep(review.id)]);
    const toEmpty = await saveWorkflow(dev, 'Phòng trống', [codeStep, handoffStep(empty.id)]);

    const nestedTask = await createTask(nested.id);
    const emptyTask = await createTask(toEmpty.id);
    const [nestedDone, emptyDone] = await Promise.all(
      [nestedTask, emptyTask].map((task) =>
        waitFor(
          () => readTask(task.id),
          (detail) => detail.status === 'failed',
          `${task.code} failed`,
        ),
      ),
    );

    expect(nestedDone?.statusNote).toBe(
      'Quy trình mặc định của phòng Review cũng có bước giao phòng khác; nền tảng không bàn giao lồng nhau.',
    );
    expect(emptyDone?.statusNote).toBe('Phòng Thiết kế chưa có thành viên để nhận bàn giao.');
    expect(nestedDone?.subtasks).toEqual([]);
    expect(emptyDone?.subtasks).toEqual([]);
  }, 30_000);

  it('fails the parent when nothing was built before the handoff step', async () => {
    const flow = await saveWorkflow(dev, 'Duyệt rồi giao', [
      {
        name: 'Bạn duyệt',
        ownerRole: 'user',
        gate: 'user_approval',
        onFail: 'stop',
        returnToStepIndex: null,
        maxRetries: 0,
        requiredOutput: '',
      },
      { ...handoffStep(review.id), onFail: 'stop', returnToStepIndex: null },
    ]);
    const task = await createTask(flow.id);
    await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'waiting_approval',
      'user approval',
    );
    const [approval] = approvalListSchema.parse(
      (await app.callApi('GET', '/api/approvals?status=pending')).body,
    );
    await app.callApi('POST', `/api/approvals/${approval!.id}/decision`, { approved: true });

    const done = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'failed',
      'parent failed',
    );

    expect(done.statusNote).toBe(
      'Chưa có code để bàn giao: bước bàn giao phải đứng sau một bước có agent làm.',
    );
    expect(done.subtasks).toEqual([]);
    expect(engine.requests).toHaveLength(0);
  }, 30_000);

  it('deletes the handoff child with its parent', async () => {
    const devFlow = await saveWorkflow(dev, 'Code và duyệt', [codeStep, handoffStep(review.id)]);
    engine.respond = (request, signal) =>
      request.prompt.includes(HANDED_OFF)
        ? untilAborted(signal)
        : Promise.resolve(agentReport('done', 'Đã code'));
    const task = await createTask(devFlow.id);
    const waiting = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'waiting_children' && detail.subtasks.length === 1,
      'parent waiting for the other department',
    );

    const deleted = await app.callApi('DELETE', `/api/tasks/${task.id}`);

    expect(deleted.statusCode).toBeLessThan(300);
    await waitFor(
      async () => (await app.callApi('GET', `/api/tasks/${waiting.subtasks[0]!.id}`)).statusCode,
      (statusCode) => statusCode === 404,
      'handoff child deleted',
    );
  }, 30_000);

  it("merges the other department's code and moves on when it passes", async () => {
    const devFlow = await saveWorkflow(dev, 'Code và duyệt', [codeStep, handoffStep(review.id)]);
    engine.respond = (request) =>
      Promise.resolve(
        request.prompt.includes(HANDED_OFF)
          ? agentReport('pass', 'Code ổn')
          : agentReport('done', 'Đã code'),
      );
    const task = await createTask(devFlow.id);

    const done = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'succeeded',
      'parent succeeded',
    );
    const childId = done.subtasks[0]!.id;
    const childFiles = readdirSync(worktreeOf(childId)).filter((file) => file.startsWith('turn-'));

    expect(childFiles.length).toBeGreaterThan(1);
    expect(readdirSync(worktreeOf(task.id))).toEqual(expect.arrayContaining(childFiles));
    const returned = await waitFor(
      () => payloadsOf(task.id, 'handoff_returned'),
      (payloads) => payloads.length === 1,
      'handoff_returned written',
    );
    expect(returned[0]).toMatchObject({ verdict: 'passed', childTaskId: childId });
  }, 30_000);

  it('sends the feedback back to the developer and hands off again', async () => {
    const devFlow = await saveWorkflow(dev, 'Code và duyệt', [codeStep, handoffStep(review.id)]);
    let reviews = 0;
    engine.respond = (request) => {
      if (!request.prompt.includes(HANDED_OFF))
        return Promise.resolve(agentReport('done', 'Đã code'));
      reviews += 1;
      return Promise.resolve(
        reviews === 1 ? agentReport('fail', 'Thiếu test') : agentReport('pass', 'Đủ test'),
      );
    };
    const task = await createTask(devFlow.id);

    const done = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'succeeded',
      'parent succeeded',
    );

    const secondDevPrompt = devRequests()[1]?.prompt ?? '';
    expect(secondDevPrompt).toContain('Phòng Review (T-');
    expect(secondDevPrompt).toContain('không đạt');
    expect(secondDevPrompt).toContain('Thiếu test');
    expect(done.subtasks).toHaveLength(2);
    const tasks = app.application.get<symbol, TaskRepository>(TASK_REPOSITORY);
    expect(tasks.listSplitSubtaskIds(task.id)).toEqual([]);
    expect(tasks.listSubtaskIds(task.id)).toHaveLength(2);
  }, 30_000);

  it('stops after 3 rejected rounds and counts again after a retry', async () => {
    const devFlow = await saveWorkflow(dev, 'Code và duyệt', [codeStep, handoffStep(review.id)]);
    engine.respond = (request) =>
      Promise.resolve(
        request.prompt.includes(HANDED_OFF)
          ? agentReport('fail', 'Thiếu test')
          : agentReport('done', 'Đã code'),
      );
    const task = await createTask(devFlow.id);

    const failed = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'failed',
      'parent failed',
    );

    expect(failed.statusNote).toBe('Quá 3 vòng bàn giao cho phòng Review.');
    expect(failed.subtasks).toHaveLength(3);
    expect(devRequests()).toHaveLength(4);

    const retried = await app.callApi('POST', `/api/tasks/${task.id}/retries`);
    expect(retried.statusCode, JSON.stringify(retried.body)).toBeLessThan(300);
    await waitFor(
      () => readTask(task.id),
      (detail) => detail.subtasks.length === 4,
      'a fourth round after the retry',
    );
  }, 60_000);

  it('treats an engine failure in the other department as technical', async () => {
    const devFlow = await saveWorkflow(dev, 'Code và duyệt', [codeStep, handoffStep(review.id)]);
    engine.respond = () => Promise.resolve(agentReport('done', 'Đã code'));
    engine.failWith = (request) =>
      request.prompt.includes(HANDED_OFF)
        ? { code: 'ENGINE_CRASHED', message: 'hỏng', retryable: false }
        : null;
    const task = await createTask(devFlow.id);

    const failed = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'failed',
      'parent failed',
    );

    expect(failed.statusNote).toMatch(/^Phòng Review lỗi kỹ thuật/);
    expect(devRequests()).toHaveLength(1);
  }, 30_000);

  it('fails the parent when its handoff child is deleted', async () => {
    const devFlow = await saveWorkflow(dev, 'Code và duyệt', [codeStep, handoffStep(review.id)]);
    engine.respond = (request, signal) =>
      request.prompt.includes(HANDED_OFF)
        ? untilAborted(signal)
        : Promise.resolve(agentReport('done', 'Đã code'));
    const task = await createTask(devFlow.id);
    const waiting = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'waiting_children' && detail.subtasks.length === 1,
      'parent waiting for the other department',
    );
    const childId = waiting.subtasks[0]!.id;
    await waitFor(
      () => requestsOf(childId).length,
      (count) => count === 1,
      'review turn started',
    );

    await app.callApi('DELETE', `/api/tasks/${childId}`);

    const failed = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'failed',
      'parent failed',
    );
    expect(failed.statusNote).toMatch(/^Phòng Review lỗi kỹ thuật \(task đã xoá\)/);
  }, 30_000);
});
