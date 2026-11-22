import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  agentDetailSchema,
  approvalListSchema,
  departmentSchema,
  type TaskDetail,
  taskDetailSchema,
} from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentReport as report,
  ScriptedEngine,
  stepNameOf,
  waitFor,
} from '../../test-support/scripted-engine';
import { startTestApplication, type TestApplication } from '../../test-support/test-application';

describe('knowledge in a task turn', () => {
  let app: TestApplication;
  let engine: ScriptedEngine;
  let project: string;
  let departmentId: string;
  let headPositionId: string;

  beforeEach(async () => {
    project = realpathSync(mkdtempSync(path.join(tmpdir(), 'aiteam-knowledge-')));
    mkdirSync(path.join(project, 'shop', 'src'), { recursive: true });
    writeFileSync(path.join(project, 'shop', 'src', 'a.ts'), 'export function login() {}\n');
    engine = new ScriptedEngine();
    app = await startTestApplication(':memory:', { agentEngineOverride: engine });
    app.database.prepare('INSERT INTO allowed_directories (path) VALUES (?)').run(project);
    departmentId = departmentSchema.parse(
      (await app.callApi('POST', '/api/departments', { name: 'Dev', color: '#60A5FA' })).body,
    ).id;
    const head = agentDetailSchema.parse(
      (
        await app.callApi('POST', `/api/departments/${departmentId}/members`, {
          name: 'Manager Dev',
          role: 'manager',
          provider: 'claude_code',
          reportsToPositionId: null,
        })
      ).body,
    );
    headPositionId = head.positionId;
    await app.callApi('PATCH', `/api/agents/${head.id}/configuration`, {
      provider: head.provider,
      accessLevel: 'edit_workspace',
      networkAccess: false,
    });
  });

  afterEach(async () => {
    await app.closeApplication();
    rmSync(project, { recursive: true, force: true, maxRetries: 3 });
  });

  it('briefs the turn with the code map and keeps the knowledge folder out of git', async () => {
    let knowledgeFolderSeen = false;
    engine.respond = (request) => {
      knowledgeFolderSeen = existsSync(
        path.join(request.workingDirectory, '.aiteam-knowledge', 'code-map.md'),
      );
      return Promise.resolve(
        '<aiteam-report>{"outcome":"done","summary":"xong","learnings":["Luôn chạy migration trước test e2e"]}</aiteam-report>',
      );
    };
    const created = await app.callApi('POST', '/api/tasks', {
      departmentId,
      title: 'Sửa hàm login',
      criteria: 'Sai mật khẩu trả 401',
      priority: 1,
      workingDirectory: path.join(project, 'shop'),
      workflowId: null,
    });
    expect(created.statusCode, JSON.stringify(created.body)).toBe(201);
    const task = taskDetailSchema.parse(created.body);

    await waitFor(
      async () =>
        taskDetailSchema.parse((await app.callApi('GET', `/api/tasks/${task.id}`)).body).status,
      (status) => status === 'succeeded',
      'the free task to finish',
    );

    expect(engine.requests[0]?.prompt).toContain('- src/a.ts | export: login');
    expect(engine.requests[0]?.prompt).toContain('.aiteam-knowledge/code-map.md');
    expect(knowledgeFolderSeen).toBe(true);
    const committed = execFileSync(
      'git',
      ['-C', path.join(project, 'shop'), 'ls-tree', '-r', '--name-only', `agent/${task.id}`],
      { encoding: 'utf8' },
    );
    expect(committed).toContain('turn-1.txt');
    expect(committed).not.toContain('.aiteam-knowledge');
    const row = app.database
      .prepare('SELECT repository_root FROM tasks WHERE id = ?')
      .get(task.id) as { repository_root: string | null };
    expect(row.repository_root).not.toBeNull();
    expect(app.database.prepare('SELECT source, body FROM knowledge_lessons').all()).toEqual([
      { source: 'agent_learning', body: 'Luôn chạy migration trước test e2e' },
    ]);
  }, 60_000);

  describe('on the hotfix workflow', () => {
    let pmId: string;

    beforeEach(async () => {
      const addMember = async (name: string, role: string, reportsToPositionId: string) => {
        const member = agentDetailSchema.parse(
          (
            await app.callApi('POST', `/api/departments/${departmentId}/members`, {
              name,
              role,
              provider: 'claude_code',
              reportsToPositionId,
            })
          ).body,
        );
        await app.callApi('PATCH', `/api/agents/${member.id}/configuration`, {
          provider: member.provider,
          accessLevel: 'edit_workspace',
          networkAccess: false,
        });
        return member;
      };
      const pm = await addMember('PM Linh', 'pm', headPositionId);
      await addMember('Dev backend', 'dev', pm.positionId);
      await addMember('QC Minh', 'qc', pm.positionId);
      pmId = pm.id;
    });

    async function createHotfixWorkflow(): Promise<void> {
      const created = await app.callApi('POST', `/api/departments/${departmentId}/workflows`, {
        name: 'Sửa lỗi khẩn',
        source: { kind: 'template', templateId: 'hotfix' },
      });
      expect(created.statusCode).toBe(201);
    }

    async function createTask(body: Record<string, unknown>): Promise<TaskDetail> {
      const created = await app.callApi('POST', '/api/tasks', {
        departmentId,
        title: 'Sửa hàm login',
        criteria: 'Sai mật khẩu trả 401',
        priority: 1,
        workingDirectory: path.join(project, 'shop'),
        assigneeAgentId: pmId,
        ...body,
      });
      expect(created.statusCode, JSON.stringify(created.body)).toBe(201);
      return taskDetailSchema.parse(created.body);
    }

    async function waitForStatus(task: TaskDetail, status: TaskDetail['status']): Promise<void> {
      await waitFor(
        async () =>
          taskDetailSchema.parse((await app.callApi('GET', `/api/tasks/${task.id}`)).body).status,
        (current) => current === status,
        `the task to be ${status}`,
      );
    }

    it('learns from QC feedback and briefs the next turn with it', async () => {
      await createHotfixWorkflow();
      let qcTurns = 0;
      engine.respond = (request) => {
        const step = stepNameOf(request.prompt);
        if (step !== 'Kiểm thử') return Promise.resolve(report('done', `${step} xong`));
        qcTurns += 1;
        return Promise.resolve(
          qcTurns === 1 ? report('fail', 'TC-03 lỗi 500 ở src/a.ts') : report('pass', 'đạt'),
        );
      };
      const task = await createTask({});

      await waitForStatus(task, 'waiting_approval');

      expect(engine.requests[3]?.prompt).toContain('> TC-03 lỗi 500 ở src/a.ts');
      expect(
        app.database.prepare('SELECT source, body, paths_json FROM knowledge_lessons').all(),
      ).toEqual([
        { source: 'qc_feedback', body: 'TC-03 lỗi 500 ở src/a.ts', paths_json: '["src/a.ts"]' },
      ]);
    }, 60_000);

    it('learns nothing from failing tests', async () => {
      await createHotfixWorkflow();
      const task = await createTask({
        testCommand: 'node -e "process.exit(1)"',
      });

      await waitForStatus(task, 'failed');

      expect(app.database.prepare('SELECT COUNT(*) AS count FROM knowledge_lessons').get()).toEqual(
        { count: 0 },
      );
    }, 60_000);

    it('learns from the user note when a step is rejected', async () => {
      await createHotfixWorkflow();
      const task = await createTask({});
      await waitForStatus(task, 'waiting_approval');
      const [approval] = approvalListSchema.parse(
        (await app.callApi('GET', '/api/approvals?status=pending')).body,
      );

      const decided = await app.callApi('POST', `/api/approvals/${approval!.id}/decision`, {
        approved: false,
        note: 'Thiếu log lỗi ở src/a.ts',
      });

      expect(decided.statusCode).toBe(200);
      expect(app.database.prepare('SELECT source, body FROM knowledge_lessons').all()).toEqual([
        { source: 'user_review', body: 'Thiếu log lỗi ở src/a.ts' },
      ]);
    }, 60_000);
  });
});
