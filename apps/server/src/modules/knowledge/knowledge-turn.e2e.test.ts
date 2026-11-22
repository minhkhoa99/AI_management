import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agentDetailSchema, departmentSchema, taskDetailSchema } from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentReport as report, ScriptedEngine, waitFor } from '../../test-support/scripted-engine';
import { startTestApplication, type TestApplication } from '../../test-support/test-application';

describe('knowledge in a task turn', () => {
  let app: TestApplication;
  let engine: ScriptedEngine;
  let project: string;
  let departmentId: string;

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
      return Promise.resolve(report('done', 'xong'));
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
  }, 60_000);
});
