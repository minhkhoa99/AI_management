import {
  type AgentDetail,
  agentDetailSchema,
  apiErrorResponseSchema,
  type Department,
  departmentSchema,
  type Workflow,
  workflowProposalSchema,
  workflowSchema,
} from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScriptedEngine } from '../../test-support/scripted-engine';
import {
  startTestApplication,
  TEST_LISTEN_PORT,
  TEST_SESSION_TOKEN,
  type TestApplication,
} from '../../test-support/test-application';
import { TASK_EVENT_LOG, type TaskEventLog } from './application/ports/task-execution.ports';

/** The answer block the AI ends with; steps are filled with defaults. */
function block(steps: Array<{ name: string; fromStepIndex: number | null }>): string {
  return `Đề xuất.\n<aiteam-workflow>${JSON.stringify({
    steps: steps.map((step) => ({
      ownerRole: 'dev',
      gate: 'auto',
      onFail: 'stop',
      returnToStepIndex: null,
      maxRetries: 0,
      requiredOutput: '',
      ...step,
    })),
    changes: [{ title: 'Gộp bước', reason: 'Nhanh hơn' }],
  })}</aiteam-workflow>`;
}

describe('workflow proposals API', () => {
  let app: TestApplication;
  let engine: ScriptedEngine;
  let department: Department;
  let departmentHead: AgentDetail;

  beforeEach(async () => {
    engine = new ScriptedEngine();
    app = await startTestApplication(':memory:', { agentEngineOverride: engine });
    department = departmentSchema.parse(
      (await app.callApi('POST', '/api/departments', { name: 'Dev', color: '#60A5FA' })).body,
    );
    departmentHead = agentDetailSchema.parse(
      (
        await app.callApi('POST', `/api/departments/${department.id}/members`, {
          name: 'Manager Dev',
          role: 'manager',
          provider: 'claude_code',
          reportsToPositionId: null,
        })
      ).body,
    );
    await app.callApi('POST', `/api/departments/${department.id}/members`, {
      name: 'Dev backend',
      role: 'dev',
      provider: 'claude_code',
      reportsToPositionId: departmentHead.positionId,
    });
    await app.callApi('PATCH', `/api/agents/${departmentHead.id}/configuration`, {
      provider: 'claude_code',
      accessLevel: 'edit_workspace',
      networkAccess: true,
    });
  });

  afterEach(async () => {
    await app.closeApplication();
  });

  async function createWorkflow(): Promise<Workflow> {
    return workflowSchema.parse(
      (
        await app.callApi('POST', `/api/departments/${department.id}/workflows`, {
          name: 'Sửa lỗi',
          source: { kind: 'template', templateId: 'hotfix' },
        })
      ).body,
    );
  }

  it('drafts steps and returns them unsaved (200)', async () => {
    engine.respond = () => Promise.resolve(block([{ name: 'Viết bài', fromStepIndex: null }]));

    const response = await app.callApi(
      'POST',
      `/api/departments/${department.id}/workflow-drafts`,
      { goal: 'Viết blog mỗi tuần' },
    );

    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    const proposal = workflowProposalSchema.parse(response.body);
    expect(proposal).toMatchObject({
      steps: [{ name: 'Viết bài', fromStepIndex: null }],
      changes: [{ title: 'Gộp bước', reason: 'Nhanh hơn' }],
      basedOnTaskCount: 0,
    });
    expect(engine.requests[0]).toMatchObject({
      workspaceRoot: null,
      permissions: { accessLevel: 'read_only', networkAccess: false },
    });
    expect(engine.requests[0]?.prompt).toContain('Viết blog mỗi tuần');
    const workflows = await app.callApi('GET', `/api/departments/${department.id}/workflows`);
    expect(workflows.body).toEqual([]);
  });

  it('refuses a draft request without Origin (403)', async () => {
    const response = await app.application.inject({
      method: 'POST',
      url: `/api/departments/${department.id}/workflow-drafts`,
      headers: {
        host: `127.0.0.1:${TEST_LISTEN_PORT}`,
        cookie: `aiteam_session=${TEST_SESSION_TOKEN}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ goal: 'Viết blog' }),
    });

    expect(response.statusCode).toBe(403);
    expect(engine.requests).toHaveLength(0);
  });

  it('refuses to optimize with fewer than 5 finished tasks, without calling the engine', async () => {
    const workflow = await createWorkflow();

    const response = await app.callApi(
      'POST',
      `/api/workflows/${workflow.id}/optimization-proposals`,
      {},
    );

    expect(response.statusCode).toBe(400);
    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('WORKFLOW_STATS_TOO_FEW');
    expect(engine.requests).toHaveLength(0);
  });

  it('optimizes from 5 finished tasks and keeps ids through fromStepIndex', async () => {
    const workflow = await createWorkflow();
    const eventLog = app.application.get<symbol, TaskEventLog>(TASK_EVENT_LOG);
    for (let index = 0; index < 5; index += 1) {
      const taskId = `done-${index}`;
      app.database
        .prepare(
          "INSERT INTO tasks (id, department_id, workflow_id, title, priority, status) VALUES (?, ?, ?, 'T', 2, 'succeeded')",
        )
        .run(taskId, department.id, workflow.id);
      // Buffered, not flushed: the use case must flush before reading.
      eventLog.recordTaskEvent({
        taskId,
        agentId: null,
        kind: 'step_report',
        payload: { stepKey: workflow.steps[0]!.id },
      });
    }
    engine.respond = () =>
      Promise.resolve(
        block([
          { name: 'Sửa', fromStepIndex: 1 },
          { name: 'Tiếp nhận', fromStepIndex: 0 },
        ]),
      );

    const response = await app.callApi(
      'POST',
      `/api/workflows/${workflow.id}/optimization-proposals`,
      {},
    );

    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    const proposal = workflowProposalSchema.parse(response.body);
    expect(proposal.basedOnTaskCount).toBe(5);
    expect(proposal.steps[0]?.id).toBe(workflow.steps[1]?.id);
    expect(proposal.steps[1]?.id).toBe(workflow.steps[0]?.id);
    expect(engine.requests[0]?.prompt).toContain('lượt 5');
  });
});
