import {
  apiErrorResponseSchema,
  type Department,
  departmentSchema,
  type Workflow,
  workflowListSchema,
  workflowSchema,
  workflowTemplateListSchema,
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

describe('workflows API', () => {
  let app: TestApplication;
  let department: Department;

  beforeEach(async () => {
    app = await startTestApplication();
    const created = await app.callApi('POST', '/api/departments', {
      name: 'Dev',
      color: '#60A5FA',
    });
    department = departmentSchema.parse(created.body);
  });

  afterEach(async () => {
    await app.closeApplication();
  });

  async function createWorkflow(body: Record<string, unknown>): Promise<Workflow> {
    const response = await app.callApi('POST', `/api/departments/${department.id}/workflows`, body);
    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    return workflowSchema.parse(response.body);
  }

  async function listWorkflows(): Promise<Workflow[]> {
    const response = await app.callApi('GET', `/api/departments/${department.id}/workflows`);
    return workflowListSchema.parse(response.body);
  }

  it('lists the built-in templates', async () => {
    const response = await app.callApi('GET', '/api/workflow-templates');

    expect(workflowTemplateListSchema.parse(response.body).map((template) => template.id)).toEqual([
      'software',
      'content',
      'hotfix',
      'ticket',
    ]);
  });

  it('creates from a template; the first workflow becomes the default', async () => {
    const software = await createWorkflow({
      name: 'Phát triển tính năng',
      source: { kind: 'template', templateId: 'software' },
    });
    const blank = await createWorkflow({ name: 'Trống', source: { kind: 'blank' } });

    expect(software).toMatchObject({ isDefault: true, enforce: true, taskCount: 0 });
    expect(software.steps.map((step) => step.ownerRole)).toEqual([
      'manager',
      'pm',
      'dev',
      'qc',
      'pm',
      'user',
    ]);
    expect(software.steps[3]?.returnToStepId).toBe(software.steps[2]?.id);
    expect(blank.isDefault).toBe(false);
    expect(blank.steps).toHaveLength(2);
  });

  it('copies, duplicates, renames and refuses duplicate names', async () => {
    const original = await createWorkflow({
      name: 'Sửa lỗi',
      source: { kind: 'template', templateId: 'hotfix' },
    });
    const copied = await createWorkflow({
      name: 'Sửa lỗi nhanh',
      source: { kind: 'copy', workflowId: original.id },
    });
    const duplicated = workflowSchema.parse(
      (await app.callApi('POST', `/api/workflows/${original.id}/duplicates`)).body,
    );
    const clash = await app.callApi('PATCH', `/api/workflows/${copied.id}`, { name: 'SỬA LỖI' });
    const renamed = await app.callApi('PATCH', `/api/workflows/${copied.id}`, {
      name: 'Hotfix',
      description: 'Bỏ bước lập kế hoạch',
    });

    expect(copied.steps.map((step) => step.name)).toEqual(original.steps.map((step) => step.name));
    expect(copied.steps[0]?.id).not.toBe(original.steps[0]?.id);
    expect(duplicated.name).toBe('Sửa lỗi (bản sao)');
    expect(readErrorCode(clash)).toBe('WORKFLOW_NAME_TAKEN');
    expect(workflowSchema.parse(renamed.body)).toMatchObject({
      name: 'Hotfix',
      description: 'Bỏ bước lập kế hoạch',
    });
  });

  it('saves a reordered chain, keeping step ids, and validates return targets', async () => {
    const workflow = await createWorkflow({
      name: 'Sửa lỗi',
      source: { kind: 'template', templateId: 'hotfix' },
    });
    const [intake, fix, test, approve] = workflow.steps;
    const toDraft = (step: Workflow['steps'][number], returnToStepIndex: number | null = null) => ({
      id: step.id,
      name: step.name,
      ownerRole: step.ownerRole,
      gate: step.gate,
      onFail: returnToStepIndex === null && step.onFail === 'return_to_step' ? 'stop' : step.onFail,
      returnToStepIndex,
      maxRetries: step.maxRetries,
      requiredOutput: step.requiredOutput,
    });

    // Drop "Tiếp nhận lỗi", add a review step, QC still returns to "Sửa lỗi" (now index 0).
    const saved = await app.callApi('PUT', `/api/workflows/${workflow.id}/steps`, {
      steps: [
        toDraft(fix!),
        toDraft(test!, 0),
        {
          name: 'Review',
          ownerRole: 'pm',
          gate: 'lead_approval',
          onFail: 'retry',
          returnToStepIndex: null,
          maxRetries: 2,
          requiredOutput: 'Nhận xét',
        },
        toDraft(approve!, 0),
      ],
    });
    const invalid = await app.callApi('PUT', `/api/workflows/${workflow.id}/steps`, {
      steps: [toDraft(fix!, 1), toDraft(test!)],
    });

    expect(saved.statusCode, JSON.stringify(saved.body)).toBe(200);
    const steps = workflowSchema.parse(saved.body).steps;
    expect(steps.map((step) => step.id).slice(0, 2)).toEqual([fix!.id, test!.id]);
    expect(steps.some((step) => step.id === intake!.id)).toBe(false);
    expect(steps[1]?.returnToStepId).toBe(fix!.id);
    expect(steps[2]).toMatchObject({ name: 'Review', maxRetries: 2 });
    expect(readErrorCode(invalid)).toBe('WORKFLOW_STEPS_INVALID');
    expect((await listWorkflows())[0]?.steps).toHaveLength(4);
  });

  it('refuses to remove a step an unfinished task is on', async () => {
    const workflow = await createWorkflow({
      name: 'Sửa lỗi',
      source: { kind: 'template', templateId: 'hotfix' },
    });
    app.database
      .prepare(
        "INSERT INTO tasks (id, department_id, workflow_id, current_step_id, title, priority, status) VALUES ('t1', ?, ?, ?, 'T', 2, 'running')",
      )
      .run(department.id, workflow.id, workflow.steps[1]!.id);

    const response = await app.callApi('PUT', `/api/workflows/${workflow.id}/steps`, {
      steps: [
        {
          name: 'Một bước',
          ownerRole: 'dev',
          gate: 'auto',
          onFail: 'stop',
          returnToStepIndex: null,
          maxRetries: 0,
          requiredOutput: '',
        },
      ],
    });

    expect(readErrorCode(response)).toBe('WORKFLOW_STEP_IN_USE');
  });

  it('updates enforcement and rules', async () => {
    const workflow = await createWorkflow({ name: 'Trống', source: { kind: 'blank' } });

    const response = await app.callApi('PATCH', `/api/workflows/${workflow.id}/rules`, {
      enforce: false,
      rules: { allowAgentSubsteps: true },
    });

    expect(workflowSchema.parse(response.body)).toMatchObject({
      enforce: false,
      rules: {
        noSkippingSteps: true,
        sensitiveActionsNeedApproval: true,
        allowAgentSubsteps: true,
      },
    });
  });

  it('moves the default, blocks deleting the last workflow, and hands tasks to the successor', async () => {
    const first = await createWorkflow({ name: 'Một', source: { kind: 'blank' } });
    const second = await createWorkflow({ name: 'Hai', source: { kind: 'blank' } });
    app.database
      .prepare(
        "INSERT INTO tasks (id, department_id, workflow_id, title, priority, status) VALUES ('done', ?, ?, 'T', 2, 'succeeded')",
      )
      .run(department.id, first.id);

    const setDefault = await app.callApi(
      'PUT',
      `/api/departments/${department.id}/default-workflow`,
      {
        workflowId: second.id,
      },
    );
    expect(workflowSchema.parse(setDefault.body).isDefault).toBe(true);
    expect((await listWorkflows()).map((workflow) => [workflow.name, workflow.isDefault])).toEqual([
      ['Hai', true],
      ['Một', false],
    ]);

    expect((await app.callApi('DELETE', `/api/workflows/${second.id}`)).statusCode).toBe(204);
    const [survivor] = await listWorkflows();
    expect(survivor).toMatchObject({ id: first.id, isDefault: true, taskCount: 1 });

    const last = await app.callApi('DELETE', `/api/workflows/${first.id}`);
    expect(readErrorCode(last)).toBe('WORKFLOW_LAST_IN_DEPARTMENT');
  });

  it('deletes a department together with its workflows', async () => {
    await createWorkflow({
      name: 'Phần mềm',
      source: { kind: 'template', templateId: 'software' },
    });

    expect((await app.callApi('DELETE', `/api/departments/${department.id}`)).statusCode).toBe(204);
    expect(app.database.prepare('SELECT COUNT(*) AS remaining FROM workflow_steps').get()).toEqual({
      remaining: 0,
    });
  });

  it('refuses to delete a workflow with unfinished tasks', async () => {
    const first = await createWorkflow({ name: 'Một', source: { kind: 'blank' } });
    await createWorkflow({ name: 'Hai', source: { kind: 'blank' } });
    app.database
      .prepare(
        "INSERT INTO tasks (id, department_id, workflow_id, title, priority, status) VALUES ('q', ?, ?, 'T', 2, 'queued')",
      )
      .run(department.id, first.id);

    expect(readErrorCode(await app.callApi('DELETE', `/api/workflows/${first.id}`))).toBe(
      'WORKFLOW_IN_USE',
    );
  });

  it('accepts only the team modes the platform can run', async () => {
    const supported = await app.callApi('PATCH', `/api/departments/${department.id}/team-mode`, {
      teamMode: 'orchestrator',
    });
    const unsupported = await app.callApi('PATCH', `/api/departments/${department.id}/team-mode`, {
      teamMode: 'codex_subagents',
    });

    expect(departmentSchema.parse(supported.body).teamMode).toBe('orchestrator');
    expect(readErrorCode(unsupported)).toBe('TEAM_MODE_NOT_SUPPORTED');
  });
});
