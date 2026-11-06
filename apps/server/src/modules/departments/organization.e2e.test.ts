import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AgentDetail,
  agentDetailSchema,
  agentListSchema,
  apiErrorResponseSchema,
  type Department,
  departmentListSchema,
  departmentSchema,
  departmentSummaryListSchema,
  type OrgTreeNode,
  orgTreeSchema,
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

function describeTree(node: OrgTreeNode | null): unknown {
  return node === null
    ? null
    : { name: node.agent.name, children: node.children.map(describeTree) };
}

interface DevDepartment {
  department: Department;
  departmentHead: AgentDetail;
  productLead: AgentDetail;
  backend: AgentDetail;
  frontend: AgentDetail;
  qualityControl: AgentDetail;
}

/** The Dev department from the design mockup, built through the API like the UI does. */
async function createDevDepartment(app: TestApplication): Promise<DevDepartment> {
  const created = await app.callApi('POST', '/api/departments', {
    name: 'Phòng Dev',
    color: '#60a5fa',
  });
  expect(created.statusCode).toBe(201);
  const department = departmentSchema.parse(created.body);

  const addMember = async (body: Record<string, unknown>): Promise<AgentDetail> => {
    const response = await app.callApi('POST', `/api/departments/${department.id}/members`, body);
    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    return agentDetailSchema.parse(response.body);
  };

  const departmentHead = await addMember({
    name: 'Manager Dev',
    role: 'manager',
    provider: 'claude_code',
    reportsToPositionId: null,
  });
  const productLead = await addMember({
    name: 'PM',
    role: 'pm',
    provider: 'claude_code',
    reportsToPositionId: departmentHead.positionId,
  });
  const backend = await addMember({
    name: 'Dev backend',
    role: 'dev',
    provider: 'codex',
    reportsToPositionId: productLead.positionId,
  });
  const frontend = await addMember({
    name: 'Dev frontend',
    role: 'dev',
    provider: 'claude_code',
    reportsToPositionId: productLead.positionId,
  });
  const qualityControl = await addMember({
    name: 'QC',
    role: 'qc',
    provider: 'codex',
    reportsToPositionId: productLead.positionId,
  });
  return { department, departmentHead, productLead, backend, frontend, qualityControl };
}

describe('organization API (departments, members, agents)', () => {
  let app: TestApplication;

  beforeEach(async () => {
    app = await startTestApplication();
  });

  afterEach(async () => {
    await app.closeApplication();
  });

  describe('departments', () => {
    it('creates, lists, renames and recolours a department', async () => {
      const { department } = await createDevDepartment(app);
      expect(department).toMatchObject({
        name: 'Phòng Dev',
        color: '#60A5FA',
        enabled: true,
        teamMode: 'orchestrator',
      });

      const updated = await app.callApi('PATCH', `/api/departments/${department.id}`, {
        name: 'Phòng Kỹ thuật',
        color: '#2dd4bf',
      });
      expect(departmentSchema.parse(updated.body)).toMatchObject({
        name: 'Phòng Kỹ thuật',
        color: '#2DD4BF',
        agentCount: 5,
      });

      const listed = departmentListSchema.parse(
        (await app.callApi('GET', '/api/departments')).body,
      );
      expect(listed.map((item) => [item.name, item.agentCount])).toEqual([['Phòng Kỹ thuật', 5]]);
    });

    it('rejects a duplicate name, comparing with Vietnamese case rules', async () => {
      await app.callApi('POST', '/api/departments', { name: 'Phòng Dev', color: '#000000' });

      const duplicate = await app.callApi('POST', '/api/departments', {
        name: '  PHÒNG DEV ',
        color: '#111111',
      });

      expect(duplicate.statusCode).toBe(409);
      expect(readErrorCode(duplicate)).toBe('DEPARTMENT_NAME_TAKEN');
    });

    it.each([
      ['an unknown field', { name: 'Ops', color: '#000000', isAdmin: true }],
      ['a bad colour', { name: 'Ops', color: 'red' }],
      ['an empty name', { name: '   ', color: '#000000' }],
    ])('rejects a request with %s', async (_label, body) => {
      const response = await app.callApi('POST', '/api/departments', body);

      expect(response.statusCode).toBe(400);
      const error = apiErrorResponseSchema.parse(response.body).error;
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual(expect.any(Array));
    });

    it('blocks deleting a department that still has members, then deletes it once empty', async () => {
      const blocked = await app.callApi('POST', '/api/departments', {
        name: 'Ops',
        color: '#000000',
      });
      const ops = departmentSchema.parse(blocked.body);
      const head = agentDetailSchema.parse(
        (
          await app.callApi('POST', `/api/departments/${ops.id}/members`, {
            name: 'Lead',
            role: 'manager',
            provider: 'codex',
            reportsToPositionId: null,
          })
        ).body,
      );

      const refused = await app.callApi('DELETE', `/api/departments/${ops.id}`);
      expect(refused.statusCode).toBe(409);
      expect(readErrorCode(refused)).toBe('DEPARTMENT_NOT_EMPTY');

      expect(
        (await app.callApi('DELETE', `/api/departments/${ops.id}/members/${head.positionId}`))
          .statusCode,
      ).toBe(204);
      expect((await app.callApi('DELETE', `/api/departments/${ops.id}`)).statusCode).toBe(204);
      expect((await app.callApi('GET', `/api/departments/${ops.id}/org-tree`)).statusCode).toBe(
        404,
      );
    });

    it('turns a department off without touching each agent flag', async () => {
      const dev = await createDevDepartment(app);
      await app.callApi('PATCH', `/api/agents/${dev.qualityControl.id}/enabled`, {
        enabled: false,
      });

      const off = await app.callApi('PATCH', `/api/departments/${dev.department.id}/enabled`, {
        enabled: false,
      });
      expect(departmentSchema.parse(off.body).enabled).toBe(false);
      await app.callApi('PATCH', `/api/departments/${dev.department.id}/enabled`, {
        enabled: true,
      });

      const agents = agentListSchema.parse((await app.callApi('GET', '/api/agents')).body);
      expect(agents.filter((agent) => !agent.enabled).map((agent) => agent.name)).toEqual(['QC']);
    });

    it('summarises departments with their head and a member preview', async () => {
      await createDevDepartment(app);
      await app.callApi('POST', '/api/departments', { name: 'Marketing', color: '#F472B6' });

      const summaries = departmentSummaryListSchema.parse(
        (await app.callApi('GET', '/api/departments/summary')).body,
      );

      expect(
        summaries.map((summary) => [summary.name, summary.headAgentName, summary.agentCount]),
      ).toEqual([
        ['Phòng Dev', 'Manager Dev', 5],
        ['Marketing', null, 0],
      ]);
      expect(summaries[0]?.memberPreview.map((member) => member.name)).toEqual([
        'Manager Dev',
        'PM',
        'Dev backend',
        'Dev frontend',
        'QC',
      ]);
    });
  });

  describe('members and org chart', () => {
    it('builds the Dev department tree from the design', async () => {
      const dev = await createDevDepartment(app);

      const tree = orgTreeSchema.parse(
        (await app.callApi('GET', `/api/departments/${dev.department.id}/org-tree`)).body,
      );

      expect(describeTree(tree.root)).toEqual({
        name: 'Manager Dev',
        children: [
          {
            name: 'PM',
            children: [
              { name: 'Dev backend', children: [] },
              { name: 'Dev frontend', children: [] },
              { name: 'QC', children: [] },
            ],
          },
        ],
      });
      expect(dev.backend).toMatchObject({
        reportsToAgentName: 'PM',
        accessLevel: 'read_only',
        networkAccess: false,
      });
    });

    it('rejects a second head and a manager from another department', async () => {
      const dev = await createDevDepartment(app);
      const marketing = departmentSchema.parse(
        (await app.callApi('POST', '/api/departments', { name: 'Marketing', color: '#F472B6' }))
          .body,
      );

      const secondHead = await app.callApi(
        'POST',
        `/api/departments/${dev.department.id}/members`,
        { name: 'CTO', role: 'manager', provider: 'codex', reportsToPositionId: null },
      );
      expect(readErrorCode(secondHead)).toBe('DEPARTMENT_HEAD_EXISTS');

      const crossDepartment = await app.callApi(
        'POST',
        `/api/departments/${marketing.id}/members`,
        {
          name: 'Writer',
          role: 'writer',
          provider: 'codex',
          reportsToPositionId: dev.departmentHead.positionId,
        },
      );
      expect(crossDepartment.statusCode).toBe(400);
      expect(readErrorCode(crossDepartment)).toBe('MANAGER_NOT_IN_DEPARTMENT');
    });

    it('requires an existing connection for Custom API agents', async () => {
      const dev = await createDevDepartment(app);
      const membersUrl = `/api/departments/${dev.department.id}/members`;
      const base = {
        name: 'Analyst',
        role: 'analyst',
        reportsToPositionId: dev.departmentHead.positionId,
      };

      expect(
        readErrorCode(await app.callApi('POST', membersUrl, { ...base, provider: 'custom_api' })),
      ).toBe('CONNECTION_REQUIRED');
      expect(
        readErrorCode(
          await app.callApi('POST', membersUrl, {
            ...base,
            provider: 'custom_api',
            connectionId: 'missing',
          }),
        ),
      ).toBe('CONNECTION_NOT_FOUND');
      expect(
        readErrorCode(
          await app.callApi('POST', membersUrl, {
            ...base,
            provider: 'codex',
            connectionId: 'missing',
          }),
        ),
      ).toBe('CONNECTION_NOT_APPLICABLE');

      const agents = agentListSchema.parse((await app.callApi('GET', '/api/agents')).body);
      expect(agents).toHaveLength(5);
    });

    it('moves a member and refuses reporting cycles', async () => {
      const dev = await createDevDepartment(app);
      const reportsToUrl = (positionId: string) =>
        `/api/departments/${dev.department.id}/members/${positionId}/reports-to`;

      const moved = await app.callApi('PUT', reportsToUrl(dev.qualityControl.positionId), {
        reportsToPositionId: dev.departmentHead.positionId,
      });
      expect(agentDetailSchema.parse(moved.body).reportsToAgentName).toBe('Manager Dev');

      const cycle = await app.callApi('PUT', reportsToUrl(dev.productLead.positionId), {
        reportsToPositionId: dev.backend.positionId,
      });
      expect(cycle.statusCode).toBe(409);
      expect(readErrorCode(cycle)).toBe('REPORTING_CYCLE');
    });

    it('renames a member and changes their role', async () => {
      const dev = await createDevDepartment(app);

      const updated = await app.callApi(
        'PATCH',
        `/api/departments/${dev.department.id}/members/${dev.frontend.positionId}`,
        { name: 'Dev mobile', role: 'designer' },
      );

      expect(agentDetailSchema.parse(updated.body)).toMatchObject({
        name: 'Dev mobile',
        role: 'designer',
      });
      expect(
        app.database
          .prepare('SELECT title FROM positions WHERE id = ?')
          .get(dev.frontend.positionId),
      ).toEqual({ title: 'designer' });
    });

    it('blocks removing a member with subordinates; removing a leaf deletes seat and agent', async () => {
      const dev = await createDevDepartment(app);
      const memberUrl = (positionId: string) =>
        `/api/departments/${dev.department.id}/members/${positionId}`;

      const blocked = await app.callApi('DELETE', memberUrl(dev.productLead.positionId));
      expect(blocked.statusCode).toBe(409);
      expect(readErrorCode(blocked)).toBe('MEMBER_HAS_SUBORDINATES');

      expect(
        (await app.callApi('DELETE', memberUrl(dev.qualityControl.positionId))).statusCode,
      ).toBe(204);
      expect((await app.callApi('GET', `/api/agents/${dev.qualityControl.id}`)).statusCode).toBe(
        404,
      );
    });

    it('does not accept a seat of another department in the member URL', async () => {
      const dev = await createDevDepartment(app);
      const marketing = departmentSchema.parse(
        (await app.callApi('POST', '/api/departments', { name: 'Marketing', color: '#F472B6' }))
          .body,
      );

      const response = await app.callApi(
        'DELETE',
        `/api/departments/${marketing.id}/members/${dev.qualityControl.positionId}`,
      );

      expect(response.statusCode).toBe(404);
      expect(readErrorCode(response)).toBe('POSITION_NOT_FOUND');
    });
  });

  describe('agents', () => {
    it('filters by department and searches name or role ignoring Vietnamese case', async () => {
      const dev = await createDevDepartment(app);
      const marketing = departmentSchema.parse(
        (await app.callApi('POST', '/api/departments', { name: 'Marketing', color: '#F472B6' }))
          .body,
      );
      await app.callApi('POST', `/api/departments/${marketing.id}/members`, {
        name: 'Trưởng Marketing',
        role: 'manager',
        provider: 'claude_code',
        reportsToPositionId: null,
      });

      const listAgentNames = async (query: string) =>
        agentListSchema
          .parse((await app.callApi('GET', `/api/agents${query}`)).body)
          .map((agent) => agent.name);

      expect(await listAgentNames(`?departmentId=${marketing.id}`)).toEqual(['Trưởng Marketing']);
      expect(await listAgentNames('?q=DEV%20BACKEND')).toEqual(['Dev backend']);
      expect(await listAgentNames('?q=TR%C6%AF%E1%BB%9ENG')).toEqual(['Trưởng Marketing']);
      expect(await listAgentNames(`?departmentId=${dev.department.id}&q=qc`)).toEqual(['QC']);
    });

    it('rejects unknown query parameters', async () => {
      const response = await app.callApi('GET', '/api/agents?limit=5');

      expect(response.statusCode).toBe(400);
    });

    it('toggles one agent and many agents at once', async () => {
      const dev = await createDevDepartment(app);

      const single = await app.callApi('PATCH', `/api/agents/${dev.backend.id}/enabled`, {
        enabled: false,
      });
      expect(agentDetailSchema.parse(single.body).enabled).toBe(false);

      const bulk = await app.callApi('PATCH', '/api/agents/enabled', {
        agentIds: [dev.backend.id, dev.frontend.id],
        enabled: false,
      });
      expect(bulk.body).toEqual({ updatedCount: 2 });

      const agents = agentListSchema.parse((await app.callApi('GET', '/api/agents')).body);
      expect(agents.filter((agent) => !agent.enabled).map((agent) => agent.name)).toEqual([
        'Dev backend',
        'Dev frontend',
      ]);
    });

    it('changes nothing when a bulk toggle contains an unknown agent', async () => {
      const dev = await createDevDepartment(app);

      const response = await app.callApi('PATCH', '/api/agents/enabled', {
        agentIds: [dev.backend.id, 'ghost-agent'],
        enabled: false,
      });

      expect(response.statusCode).toBe(404);
      expect(apiErrorResponseSchema.parse(response.body).error.details).toEqual({
        missingAgentIds: ['ghost-agent'],
      });
      expect(
        agentDetailSchema.parse((await app.callApi('GET', `/api/agents/${dev.backend.id}`)).body)
          .enabled,
      ).toBe(true);
    });

    it('rejects duplicate ids in a bulk toggle', async () => {
      const response = await app.callApi('PATCH', '/api/agents/enabled', {
        agentIds: ['a', 'a'],
        enabled: true,
      });

      expect(response.statusCode).toBe(400);
    });
  });
});

describe('persistence across restarts', () => {
  it('keeps the Dev department after the server is stopped and started again', async () => {
    const dataDirectory = mkdtempSync(path.join(tmpdir(), 'aiteam-restart-'));
    const databaseFile = path.join(dataDirectory, 'aiteam.db');
    try {
      const firstRun = await startTestApplication(databaseFile);
      const dev = await createDevDepartment(firstRun);
      await firstRun.callApi('PATCH', `/api/agents/${dev.qualityControl.id}/enabled`, {
        enabled: false,
      });
      await firstRun.closeApplication();

      const secondRun = await startTestApplication(databaseFile);
      const tree = orgTreeSchema.parse(
        (await secondRun.callApi('GET', `/api/departments/${dev.department.id}/org-tree`)).body,
      );
      const qualityControl = agentDetailSchema.parse(
        (await secondRun.callApi('GET', `/api/agents/${dev.qualityControl.id}`)).body,
      );
      await secondRun.closeApplication();

      expect(tree.root?.children[0]?.children).toHaveLength(3);
      expect(qualityControl.enabled).toBe(false);
    } finally {
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });
});
