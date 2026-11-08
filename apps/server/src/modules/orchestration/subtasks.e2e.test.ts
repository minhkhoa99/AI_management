import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AgentDetail,
  agentDetailSchema,
  type Department,
  departmentSchema,
  taskDetailSchema,
  taskEventListSchema,
  workflowSchema,
} from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentReport, ScriptedEngine, waitFor } from '../../test-support/scripted-engine';
import { startTestApplication, type TestApplication } from '../../test-support/test-application';

/** The lead's answer when it splits its work. */
function splitReport(subtasks: unknown[]): string {
  return `Chia việc.\n<aiteam-report>${JSON.stringify({ outcome: 'done', summary: 'Đã chia việc', subtasks })}</aiteam-report>`;
}

describe('subtasks', () => {
  let app: TestApplication;
  let engine: ScriptedEngine;
  let project: string;
  let department: Department;
  let pm: AgentDetail;
  let developer: AgentDetail;
  let qc: AgentDetail;

  beforeEach(async () => {
    project = realpathSync(mkdtempSync(path.join(tmpdir(), 'aiteam-subtasks-')));
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
    pm = await addMember({
      name: 'PM Linh',
      role: 'pm',
      provider: 'claude_code',
      reportsToPositionId: null,
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
    for (const agent of [pm, developer, qc]) {
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

  /** A free-run workflow (not enforced) whose rules allow or forbid splitting. */
  async function createWorkflow(allowSplitting: boolean) {
    const workflow = workflowSchema.parse(
      (
        await app.callApi('POST', `/api/departments/${department.id}/workflows`, {
          name: 'Tự do',
          source: { kind: 'template', templateId: 'software' },
        })
      ).body,
    );
    const updated = await app.callApi('PATCH', `/api/workflows/${workflow.id}/rules`, {
      enforce: false,
      rules: { allowAgentSubsteps: allowSplitting },
    });
    expect(updated.statusCode, JSON.stringify(updated.body)).toBe(200);
    return workflow;
  }

  async function createTask(workflowId: string) {
    const response = await app.callApi('POST', '/api/tasks', {
      departmentId: department.id,
      title: 'Trang đăng nhập',
      priority: 1,
      workflowId,
      assigneeAgentId: pm.id,
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

  it('splits work to subordinates, merges their code and lets the lead finish', async () => {
    const workflow = await createWorkflow(true);
    engine.respond = (request) => {
      const prompt = request.prompt;
      if (prompt.includes('task con do cấp trên tách ra')) {
        return Promise.resolve(
          agentReport('done', `Xong phần: ${/"([^"]+)"\. Chỉ làm/.exec(prompt)?.[1] ?? ''}`),
        );
      }
      if (prompt.includes('Các task con bạn giao cho cấp dưới đã kết thúc')) {
        return Promise.resolve(agentReport('done', 'Đã ghép và kiểm tra'));
      }
      return Promise.resolve(
        splitReport([
          { title: 'API đăng nhập', description: 'POST /login', assignee: 'Dev backend' },
          { title: 'Kịch bản kiểm thử', description: '5 kịch bản', assignee: 'qc minh' },
        ]),
      );
    };
    const task = await createTask(workflow.id);

    const done = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'succeeded',
      'lead finishes after subtasks',
    );

    expect(
      done.subtasks.map((subtask) => [subtask.title, subtask.assignee?.name, subtask.status]),
    ).toEqual([
      ['API đăng nhập', 'Dev backend', 'succeeded'],
      ['Kịch bản kiểm thử', 'QC Minh', 'succeeded'],
    ]);
    expect(done.subtasks.every((subtask) => subtask.parentTask?.code === task.code)).toBe(true);
    // Each subordinate's file (turn-<n>.txt) was merged into the lead's worktree.
    const leadFiles = readdirSync(worktreeOf(task.id));
    for (const subtask of done.subtasks) {
      const subtaskFiles = readdirSync(worktreeOf(subtask.id)).filter((file) =>
        file.startsWith('turn-'),
      );
      expect(subtaskFiles.length).toBeGreaterThan(0);
      expect(leadFiles).toEqual(expect.arrayContaining(subtaskFiles));
    }
    // The lead resumed its own session with the results.
    const leadRequests = engine.requests.filter((request) =>
      request.workingDirectory.includes(task.id),
    );
    expect(leadRequests).toHaveLength(2);
    expect(leadRequests[1]?.resumeSessionRef).not.toBeNull();
    expect(leadRequests[1]?.prompt).toContain('Xong phần');
    // Subtasks were never offered splitting themselves.
    const subtaskPrompts = engine.requests
      .filter((request) => request.prompt.includes('task con do cấp trên tách ra'))
      .map((request) => request.prompt);
    expect(subtaskPrompts).toHaveLength(2);
    expect(subtaskPrompts.every((prompt) => !prompt.includes('"subtasks"'))).toBe(true);
    expect(await readEventKinds(task.id)).toEqual(
      expect.arrayContaining(['subtasks_created', 'subtasks_finished', 'task_succeeded']),
    );
    const created = taskEventListSchema
      .parse((await app.callApi('GET', `/api/tasks/${task.id}/events?limit=100`)).body)
      .find((event) => event.kind === 'subtasks_created');
    expect(created?.text).toContain('tách 2 task con');
    expect(created?.text).toContain('API đăng nhập → Dev backend');
  }, 30_000);

  it('ignores a split when the workflow does not allow it', async () => {
    const workflow = await createWorkflow(false);
    engine.respond = () => Promise.resolve(splitReport([{ title: 'Phần việc' }]));
    const task = await createTask(workflow.id);

    const done = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'succeeded',
      'task judged as usual',
    );

    expect(done.subtasks).toEqual([]);
    expect(await readEventKinds(task.id)).toContain('subtasks_ignored');
    expect(engine.requests[0]?.prompt).not.toContain('"subtasks"');
  }, 30_000);

  it('keeps the lead worktree intact and tells the lead when subtasks conflict', async () => {
    const workflow = await createWorkflow(true);
    engine.respond = (request) => {
      const prompt = request.prompt;
      if (prompt.includes('task con do cấp trên tách ra')) {
        // Both subordinates rewrite the same file differently.
        writeFileSync(
          path.join(request.workingDirectory, 'README.md'),
          `# ${request.prompt.length}\n`,
        );
        return Promise.resolve(agentReport('done', 'sửa README'));
      }
      if (prompt.includes('Các task con bạn giao cho cấp dưới đã kết thúc')) {
        return Promise.resolve(agentReport('done', 'Đã xử lý xung đột'));
      }
      return Promise.resolve(
        splitReport([{ title: 'Viết README A' }, { title: 'Viết README B, khác hẳn' }]),
      );
    };
    const task = await createTask(workflow.id);

    await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'succeeded',
      'lead finishes after a conflict',
    );

    const resumed = engine.requests.filter((request) =>
      request.prompt.includes('Các task con bạn giao cho cấp dưới đã kết thúc'),
    );
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.prompt).toContain('KHÔNG được gộp vì xung đột');
    // The failed merge was undone: no conflict markers left behind.
    expect(readFileSync(path.join(worktreeOf(task.id), 'README.md'), 'utf8')).not.toContain(
      '<<<<<<<',
    );
  }, 30_000);

  it('deletes subtasks with their parent', async () => {
    const workflow = await createWorkflow(true);
    let releaseSubtasks: (() => void) | undefined;
    const subtasksHeld = new Promise<void>((resolve) => {
      releaseSubtasks = resolve;
    });
    engine.respond = async (request) => {
      if (request.prompt.includes('task con do cấp trên tách ra')) {
        await subtasksHeld;
        return agentReport('done', 'xong');
      }
      return splitReport([{ title: 'Một' }, { title: 'Hai' }]);
    };
    const task = await createTask(workflow.id);
    const waiting = await waitFor(
      () => readTask(task.id),
      (detail) => detail.status === 'waiting_children' && detail.subtasks.length === 2,
      'parent waiting for subtasks',
    );

    const deleted = await app.callApi('DELETE', `/api/tasks/${task.id}`);
    releaseSubtasks?.();

    expect(deleted.statusCode).toBeLessThan(300);
    for (const subtask of waiting.subtasks) {
      await waitFor(
        async () => (await app.callApi('GET', `/api/tasks/${subtask.id}`)).statusCode,
        (statusCode) => statusCode === 404,
        `subtask ${subtask.code} deleted`,
      );
    }
    expect((await app.callApi('GET', `/api/tasks/${task.id}`)).statusCode).toBe(404);
  }, 30_000);
});
