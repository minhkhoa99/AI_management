import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  agentDetailSchema,
  apiErrorResponseSchema,
  type AgentDetail,
  type Department,
  departmentSchema,
  directoryPickSchema,
  directoryValidationSchema,
  recentDirectoryListSchema,
  taskAttachmentSchema,
  taskDeletionSchema,
  type TaskDetail,
  taskDetailSchema,
  taskSummaryListSchema,
  type Workflow,
  workflowSchema,
  workspaceSettingsSchema,
} from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startTestApplication,
  type TestApiResponse,
  type TestApplication,
} from '../../test-support/test-application';

function readErrorCode(response: TestApiResponse): string {
  return apiErrorResponseSchema.parse(response.body).error.code;
}

describe('tasks API', () => {
  let app: TestApplication;
  let folders: string;
  let pickedFolder: string | null;
  let department: Department;
  let head: AgentDetail;
  let developer: AgentDetail;
  let workflow: Workflow;

  beforeEach(async () => {
    folders = realpathSync(mkdtempSync(path.join(tmpdir(), 'aiteam-task-folders-')));
    mkdirSync(path.join(folders, 'shop-api', 'src'), { recursive: true });
    mkdirSync(path.join(folders, 'private'));
    pickedFolder = null;
    app = await startTestApplication(':memory:', {
      directoryPicker: { pickDirectory: () => Promise.resolve(pickedFolder) },
    });

    department = departmentSchema.parse(
      (await app.callApi('POST', '/api/departments', { name: 'Dev', color: '#60A5FA' })).body,
    );
    const addMember = async (body: Record<string, unknown>) =>
      agentDetailSchema.parse(
        (await app.callApi('POST', `/api/departments/${department.id}/members`, body)).body,
      );
    head = await addMember({
      name: 'Manager Dev',
      role: 'manager',
      provider: 'claude_code',
      reportsToPositionId: null,
    });
    developer = await addMember({
      name: 'Dev backend',
      role: 'dev',
      provider: 'codex',
      reportsToPositionId: head.positionId,
    });
    workflow = workflowSchema.parse(
      (
        await app.callApi('POST', `/api/departments/${department.id}/workflows`, {
          name: 'Phát triển',
          source: { kind: 'template', templateId: 'software' },
        })
      ).body,
    );
  });

  afterEach(async () => {
    await app.closeApplication();
    rmSync(folders, { recursive: true, force: true });
  });

  async function createTask(body: Record<string, unknown> = {}): Promise<TaskDetail> {
    const response = await app.callApi('POST', '/api/tasks', {
      departmentId: department.id,
      title: 'API đăng nhập',
      priority: 1,
      ...body,
    });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    return taskDetailSchema.parse(response.body);
  }

  async function allowFolder(folder: string): Promise<void> {
    pickedFolder = folder;
    const picked = await app.callApi('POST', '/api/workspace/dir-picker');
    expect(directoryPickSchema.parse(picked.body).path).toBe(folder);
  }

  it('creates a queued task for the head, on the default workflow, with a goal', async () => {
    const task = await createTask({ criteria: 'Sai mật khẩu trả 401\nKhoá sau 5 lần sai' });
    const second = await createTask({ title: 'Form đăng nhập', priority: 2 });

    expect(task).toMatchObject({
      code: 'T-1',
      status: 'queued',
      boardColumn: 'todo',
      assignee: { id: head.id, name: 'Manager Dev', available: true },
      workflow: { id: workflow.id, name: 'Phát triển' },
      workingDirectory: null,
      testCommand: null,
      completionGoal: {
        source: 'description',
        items: ['Sai mật khẩu trả 401', 'Khoá sau 5 lần sai'],
      },
    });
    expect(task.assigneeChain.map((agent) => agent.name)).toEqual(['Manager Dev']);
    expect(second.code).toBe('T-2');
  });

  it('assigns to a member, records the reporting chain and filters the board', async () => {
    const task = await createTask({
      assigneeAgentId: developer.id,
      workflowId: null,
      testCommand: ' npm test ',
    });

    expect(task.assigneeChain.map((agent) => agent.name)).toEqual(['Manager Dev', 'Dev backend']);
    expect(task).toMatchObject({ workflow: null, testCommand: 'npm test' });
    const byDepartment = taskSummaryListSchema.parse(
      (await app.callApi('GET', `/api/tasks?departmentId=${department.id}`)).body,
    );
    const byWorkflow = taskSummaryListSchema.parse(
      (await app.callApi('GET', `/api/tasks?workflowId=${workflow.id}`)).body,
    );
    expect(byDepartment).toHaveLength(1);
    expect(byWorkflow).toHaveLength(0);
  });

  it('refuses assignees from elsewhere, unknown workflows and disabled departments', async () => {
    const otherDepartment = departmentSchema.parse(
      (await app.callApi('POST', '/api/departments', { name: 'Ops', color: '#2DD4BF' })).body,
    );
    const outsider = agentDetailSchema.parse(
      (
        await app.callApi('POST', `/api/departments/${otherDepartment.id}/members`, {
          name: 'Ops lead',
          role: 'manager',
          provider: 'codex',
          reportsToPositionId: null,
        })
      ).body,
    );

    const foreignAssignee = await app.callApi('POST', '/api/tasks', {
      departmentId: department.id,
      title: 'X',
      priority: 2,
      assigneeAgentId: outsider.id,
    });
    const unknownWorkflow = await app.callApi('POST', '/api/tasks', {
      departmentId: department.id,
      title: 'X',
      priority: 2,
      workflowId: 'missing',
    });
    await app.callApi('PATCH', `/api/departments/${department.id}/enabled`, { enabled: false });
    const disabled = await app.callApi('POST', '/api/tasks', {
      departmentId: department.id,
      title: 'X',
      priority: 2,
    });

    expect(readErrorCode(foreignAssignee)).toBe('ASSIGNEE_NOT_IN_DEPARTMENT');
    expect(readErrorCode(unknownWorkflow)).toBe('WORKFLOW_NOT_FOUND');
    expect(readErrorCode(disabled)).toBe('DEPARTMENT_DISABLED');
  });

  it('accepts only folders inside one picked with the system dialog', async () => {
    const project = path.join(folders, 'shop-api');
    const beforePick = await app.callApi('POST', '/api/tasks', {
      departmentId: department.id,
      title: 'X',
      priority: 2,
      workingDirectory: project,
    });
    expect(beforePick.statusCode).toBe(403);
    expect(readErrorCode(beforePick)).toBe('WORKING_DIRECTORY_NOT_ALLOWED');

    await allowFolder(project);
    const insideTyped = await createTask({
      workingDirectory: path.join(project, 'src', '..', 'src'),
    });
    const sibling = directoryValidationSchema.parse(
      (
        await app.callApi('POST', '/api/workspace/dir-validation', {
          path: path.join(folders, 'private'),
        })
      ).body,
    );
    const escape = directoryValidationSchema.parse(
      (
        await app.callApi('POST', '/api/workspace/dir-validation', {
          path: path.join(project, '..', 'private'),
        })
      ).body,
    );
    const missing = directoryValidationSchema.parse(
      (
        await app.callApi('POST', '/api/workspace/dir-validation', {
          path: path.join(project, 'nope'),
        })
      ).body,
    );

    expect(insideTyped.workingDirectory).toBe(path.join(project, 'src'));
    expect(sibling).toMatchObject({ exists: true, allowed: false });
    expect(escape).toMatchObject({ path: path.join(folders, 'private'), allowed: false });
    expect(missing).toMatchObject({
      exists: false,
      problem: 'Không tìm thấy thư mục này trên máy.',
    });
    expect(
      recentDirectoryListSchema.parse(
        (await app.callApi('GET', '/api/workspace/recent-dirs')).body,
      ),
    ).toEqual([path.join(project, 'src')]);
  });

  it('cancelling the folder dialog allows nothing; settings can only remove folders', async () => {
    const cancelled = directoryPickSchema.parse(
      (await app.callApi('POST', '/api/workspace/dir-picker')).body,
    );
    await allowFolder(path.join(folders, 'shop-api'));

    const injected = await app.callApi('PATCH', '/api/settings', {
      allowedDirectories: [path.join(folders, 'shop-api'), path.join(folders, 'private')],
    });
    const updated = await app.callApi('PATCH', '/api/settings', {
      allowedDirectories: [],
      maxParallelAgents: 3,
    });

    expect(cancelled.path).toBeNull();
    expect(readErrorCode(injected)).toBe('ALLOWED_DIRECTORY_NOT_PICKED');
    expect(workspaceSettingsSchema.parse(updated.body)).toEqual({
      allowedDirectories: [],
      maxParallelAgents: 3,
    });
  });

  it('stores QA documents, counts text test cases and uses them as the goal', async () => {
    const task = await createTask();
    const feature = Buffer.from('Feature: Login\n  Scenario: ok\n  Scenario: sai mật khẩu\n');

    const uploaded = await app.uploadBytes(
      'PUT',
      `/api/tasks/${task.id}/attachments?fileName=login.feature`,
      feature,
    );
    const binary = await app.uploadBytes(
      'PUT',
      `/api/tasks/${task.id}/attachments?fileName=edge.xlsx`,
      Buffer.from([1, 2, 3]),
    );
    const replaced = await app.uploadBytes(
      'PUT',
      `/api/tasks/${task.id}/attachments?fileName=login.feature`,
      Buffer.from('Scenario: một\n'),
    );
    const traversal = await app.uploadBytes(
      'PUT',
      `/api/tasks/${task.id}/attachments?fileName=..%2Fevil.md`,
      feature,
    );
    const wrongType = await app.uploadBytes(
      'PUT',
      `/api/tasks/${task.id}/attachments?fileName=run.exe`,
      feature,
    );

    expect(uploaded.statusCode, JSON.stringify(uploaded.body)).toBe(200);
    expect(taskAttachmentSchema.parse(binary.body).detectedCases).toBeNull();
    expect(taskAttachmentSchema.parse(replaced.body).detectedCases).toBe(1);
    expect(traversal.statusCode).toBe(400);
    expect(wrongType.statusCode).toBe(400);
    const detail = taskDetailSchema.parse((await app.callApi('GET', `/api/tasks/${task.id}`)).body);
    expect(detail.attachments.map((attachment) => attachment.fileName)).toEqual([
      'edge.xlsx',
      'login.feature',
    ]);
    expect(detail.completionGoal).toMatchObject({
      source: 'qa',
      items: ['edge.xlsx', 'login.feature – 1 kịch bản'],
    });
    expect(detail.attachmentCount).toBe(2);

    const qaFolder = path.join(app.dataDirectory, 'qa-documents', task.id);
    expect(existsSync(qaFolder)).toBe(true);
    const removed = await app.callApi(
      'DELETE',
      `/api/tasks/${task.id}/attachments/${detail.attachments[0]!.id}`,
    );
    expect(removed.statusCode).toBe(204);
    const deletion = taskDeletionSchema.parse(
      (await app.callApi('DELETE', `/api/tasks/${task.id}`)).body,
    );
    expect(deletion).toEqual({ taskId: task.id, outcome: 'deleted' });
    expect(existsSync(qaFolder)).toBe(false);
    expect((await app.callApi('GET', `/api/tasks/${task.id}`)).statusCode).toBe(404);
  });

  it('edits a queued task and refuses folder changes once work started', async () => {
    const task = await createTask();

    const edited = taskDetailSchema.parse(
      (
        await app.callApi('PATCH', `/api/tasks/${task.id}`, {
          title: 'API đăng nhập v2',
          priority: 3,
          assigneeAgentId: developer.id,
          workflowId: null,
        })
      ).body,
    );
    app.database.prepare("UPDATE tasks SET status = 'running' WHERE id = ?").run(task.id);
    const lateFolderChange = await app.callApi('PATCH', `/api/tasks/${task.id}`, {
      workflowId: workflow.id,
    });
    const runningDeletion = await app.callApi('DELETE', `/api/tasks/${task.id}`);

    expect(edited).toMatchObject({
      title: 'API đăng nhập v2',
      priority: 3,
      workflow: null,
      assignee: { id: developer.id },
    });
    expect(readErrorCode(lateFolderChange)).toBe('TASK_ALREADY_STARTED');
    expect(readErrorCode(runningDeletion)).toBe('TASK_IN_PROGRESS');
  });

  it('keeps departments and members that still have tasks', async () => {
    await createTask({ assigneeAgentId: developer.id });

    const removeDeveloper = await app.callApi(
      'DELETE',
      `/api/departments/${department.id}/members/${developer.positionId}`,
    );
    expect(readErrorCode(removeDeveloper)).toBe('MEMBER_HAS_UNFINISHED_TASKS');

    app.database.exec("UPDATE tasks SET status = 'succeeded'");
    await app.callApi(
      'DELETE',
      `/api/departments/${department.id}/members/${developer.positionId}`,
    );
    await app.callApi('DELETE', `/api/departments/${department.id}/members/${head.positionId}`);
    const deleteDepartment = await app.callApi('DELETE', `/api/departments/${department.id}`);
    expect(readErrorCode(deleteDepartment)).toBe('DEPARTMENT_HAS_TASKS');
  });
});
