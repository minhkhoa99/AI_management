import {
  type CreateWrittenSkillRequest,
  departmentSkillListSchema,
  departmentSkillSchema,
  skillDetailSchema,
  skillTemplateListSchema,
  type UpdateSkillRequest,
} from '@aiteam/contracts';
import {
  fetchApiJson,
  sendApiBytes,
  sendApiCommand,
  sendApiJson,
} from '../../shared/api/api-client';
import { invalidateApiQueries } from '../../shared/api/use-api-query';

const encodeId = encodeURIComponent;

async function refreshAfterWrite<Result>(pendingWrite: Promise<Result>): Promise<Result> {
  const result = await pendingWrite;
  invalidateApiQueries();
  return result;
}

const departmentSkillsPath = (departmentId: string) =>
  `/api/departments/${encodeId(departmentId)}/skills`;

export const loadDepartmentSkills = (departmentId: string) =>
  fetchApiJson(departmentSkillsPath(departmentId), departmentSkillListSchema);

export const loadSkillTemplates = () =>
  fetchApiJson('/api/skills/templates', skillTemplateListSchema);

export const loadSkillDetail = (skillId: string) =>
  fetchApiJson(`/api/skills/${encodeId(skillId)}`, skillDetailSchema);

export const loadAgentSkills = (agentId: string) =>
  fetchApiJson(`/api/agents/${encodeId(agentId)}/skills`, departmentSkillListSchema);

export const createWrittenSkill = (departmentId: string, request: CreateWrittenSkillRequest) =>
  refreshAfterWrite(
    sendApiJson('POST', departmentSkillsPath(departmentId), request, departmentSkillSchema),
  );

export const addTemplateSkill = (departmentId: string, templateId: string) =>
  refreshAfterWrite(
    sendApiJson(
      'POST',
      `${departmentSkillsPath(departmentId)}/from-template`,
      { templateId },
      departmentSkillSchema,
    ),
  );

export const importGithubSkill = (departmentId: string, url: string) =>
  refreshAfterWrite(
    sendApiJson(
      'POST',
      `${departmentSkillsPath(departmentId)}/from-github`,
      { url },
      departmentSkillSchema,
    ),
  );

export const uploadSkillFile = (departmentId: string, file: File) =>
  refreshAfterWrite(
    sendApiBytes(
      'PUT',
      `${departmentSkillsPath(departmentId)}/upload?fileName=${encodeURIComponent(file.name)}`,
      file,
      departmentSkillSchema,
    ),
  );

export const updateSkill = (skillId: string, request: UpdateSkillRequest) =>
  refreshAfterWrite(
    sendApiJson('PATCH', `/api/skills/${encodeId(skillId)}`, request, skillDetailSchema),
  );

export const deleteSkill = (skillId: string) =>
  refreshAfterWrite(sendApiCommand('DELETE', `/api/skills/${encodeId(skillId)}`));

export const copySkill = (skillId: string, targetDepartmentId: string) =>
  refreshAfterWrite(
    sendApiJson(
      'POST',
      `/api/skills/${encodeId(skillId)}/copy`,
      { targetDepartmentId },
      departmentSkillSchema,
    ),
  );

export const setAgentSkills = (agentId: string, skillIds: string[]) =>
  refreshAfterWrite(
    sendApiJson(
      'PUT',
      `/api/agents/${encodeId(agentId)}/skills`,
      { skillIds },
      departmentSkillListSchema,
    ),
  );
