import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
  departmentSkillListSchema,
  departmentSkillSchema,
  skillDetailSchema,
  skillTemplateListSchema,
  taskDetailSchema,
} from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentReport, ScriptedEngine, waitFor } from '../../test-support/scripted-engine';
import { startTestApplication, type TestApplication } from '../../test-support/test-application';
import { buildZipArchive } from '../../test-support/zip-builder';

describe('department skills', () => {
  let app: TestApplication;
  let engine: ScriptedEngine;
  let project: string;
  let department: Department;
  let otherDepartment: Department;
  let developer: AgentDetail;
  let tester: AgentDetail;

  beforeEach(async () => {
    project = realpathSync(mkdtempSync(path.join(tmpdir(), 'aiteam-skills-')));
    mkdirSync(path.join(project, 'shop'));
    writeFileSync(path.join(project, 'shop', 'README.md'), '# shop\n');
    engine = new ScriptedEngine();
    app = await startTestApplication(':memory:', { agentEngineOverride: engine });
    app.database.prepare('INSERT INTO allowed_directories (path) VALUES (?)').run(project);
    const createDepartment = async (name: string) =>
      departmentSchema.parse(
        (await app.callApi('POST', '/api/departments', { name, color: '#60A5FA' })).body,
      );
    department = await createDepartment('Dev');
    otherDepartment = await createDepartment('QA');
    const addMember = async (body: Record<string, unknown>) =>
      agentDetailSchema.parse(
        (await app.callApi('POST', `/api/departments/${department.id}/members`, body)).body,
      );
    developer = await addMember({
      name: 'Dev backend',
      role: 'dev',
      provider: 'claude_code',
      reportsToPositionId: null,
    });
    tester = await addMember({
      name: 'QC Minh',
      role: 'qc',
      provider: 'codex',
      reportsToPositionId: developer.positionId,
    });
    await app.callApi('PATCH', `/api/agents/${developer.id}/configuration`, {
      provider: 'claude_code',
      accessLevel: 'edit_workspace',
      networkAccess: false,
    });
  });

  afterEach(async () => {
    await app.closeApplication();
    rmSync(project, { recursive: true, force: true, maxRetries: 3 });
  });

  const skillsUrl = (departmentId: string) => `/api/departments/${departmentId}/skills`;
  const listSkills = async (departmentId: string) =>
    departmentSkillListSchema.parse((await app.callApi('GET', skillsUrl(departmentId))).body);

  async function createWrittenSkill(name: string, content = 'Làm theo các bước.') {
    const response = await app.callApi('POST', skillsUrl(department.id), {
      name,
      description: `Khi cần ${name}`,
      content,
    });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    return departmentSkillSchema.parse(response.body);
  }

  it('creates skills from text, templates, .md and .zip files', async () => {
    const written = await createWrittenSkill('Quy ước API');
    const templates = skillTemplateListSchema.parse(
      (await app.callApi('GET', '/api/skills/templates')).body,
    );
    const fromTemplate = async () =>
      departmentSkillSchema.parse(
        (
          await app.callApi('POST', `${skillsUrl(department.id)}/from-template`, {
            templateId: templates[0]!.id,
          })
        ).body,
      );
    const firstTemplate = await fromTemplate();
    const secondTemplate = await fromTemplate();
    const markdown = departmentSkillSchema.parse(
      (
        await app.uploadBytes(
          'PUT',
          `${skillsUrl(department.id)}/upload?fileName=SKILL.md`,
          Buffer.from('---\nname: Đặt tên biến\ndescription: Khi đặt tên\n---\n# Đặt tên\n'),
        )
      ).body,
    );
    const zipped = departmentSkillSchema.parse(
      (
        await app.uploadBytes(
          'PUT',
          `${skillsUrl(department.id)}/upload?fileName=pdf.zip`,
          buildZipArchive([
            {
              path: 'pdf/SKILL.md',
              content: '---\nname: PDF\ndescription: Xử lý PDF\n---\nDùng script.',
            },
            { path: 'pdf/scripts/fill.py', content: 'print(1)\n' },
          ]),
        )
      ).body,
    );
    const unsafeZip = await app.uploadBytes(
      'PUT',
      `${skillsUrl(department.id)}/upload?fileName=evil.zip`,
      buildZipArchive([{ path: '../SKILL.md', content: 'x' }]),
    );
    const duplicate = await app.callApi('POST', skillsUrl(department.id), { name: 'quy ước api' });

    expect(written).toMatchObject({ sourceKind: 'written', fileCount: 1 });
    expect(firstTemplate.name).toBe(templates[0]!.name);
    expect(secondTemplate.name).toBe(`${templates[0]!.name} (2)`);
    expect(markdown).toMatchObject({
      name: 'Đặt tên biến',
      description: 'Khi đặt tên',
      sourceKind: 'markdown',
    });
    expect(zipped).toMatchObject({ name: 'PDF', sourceKind: 'zip', fileCount: 2 });
    expect(unsafeZip.statusCode).toBe(400);
    expect(duplicate.statusCode).toBe(409);
    const detail = skillDetailSchema.parse(
      (await app.callApi('GET', `/api/skills/${zipped.id}`)).body,
    );
    expect(detail.files.map((file) => file.path)).toEqual(['SKILL.md', 'scripts/fill.py']);
    expect(detail.content).toBe('Dùng script.');
    expect((await listSkills(department.id)).map((skill) => skill.name)).toHaveLength(5);
  });

  it('edits, copies and deletes a skill', async () => {
    const skill = await createWrittenSkill('Review');
    const edited = skillDetailSchema.parse(
      (
        await app.callApi('PATCH', `/api/skills/${skill.id}`, {
          name: 'Review code',
          content: 'Đọc diff kỹ.',
        })
      ).body,
    );
    const copied = departmentSkillSchema.parse(
      (
        await app.callApi('POST', `/api/skills/${skill.id}/copy`, {
          targetDepartmentId: otherDepartment.id,
        })
      ).body,
    );
    const deleted = await app.callApi('DELETE', `/api/skills/${skill.id}`);

    expect(edited).toMatchObject({ name: 'Review code', content: 'Đọc diff kỹ.' });
    expect(copied).toMatchObject({
      departmentId: otherDepartment.id,
      name: 'Review code',
      assignedAgentIds: [],
    });
    expect(deleted.statusCode).toBe(204);
    expect(await listSkills(department.id)).toEqual([]);
    expect((await listSkills(otherDepartment.id)).map((entry) => entry.name)).toEqual([
      'Review code',
    ]);
  });

  it('assigns only skills of the agent’s department', async () => {
    const skill = await createWrittenSkill('Viết test');
    const foreign = departmentSkillSchema.parse(
      (await app.callApi('POST', skillsUrl(otherDepartment.id), { name: 'Kiểm thử' })).body,
    );

    const assigned = await app.callApi('PUT', `/api/agents/${developer.id}/skills`, {
      skillIds: [skill.id, skill.id],
    });
    const refused = await app.callApi('PUT', `/api/agents/${developer.id}/skills`, {
      skillIds: [foreign.id],
    });

    expect(assigned.statusCode).toBe(200);
    expect(departmentSkillListSchema.parse(assigned.body).map((entry) => entry.id)).toEqual([
      skill.id,
    ]);
    expect(refused.statusCode).toBe(400);
    expect((await listSkills(department.id))[0]?.assignedAgentIds).toEqual([developer.id]);
  });

  it('gives the agent exactly its skills in the worktree and the prompt, out of git', async () => {
    const assignedSkill = await createWrittenSkill('Viết test', 'Luôn viết test trước.');
    const otherSkill = await createWrittenSkill('Bí mật QA', 'Không dành cho Dev.');
    await app.callApi('PUT', `/api/agents/${developer.id}/skills`, {
      skillIds: [assignedSkill.id],
    });
    await app.callApi('PUT', `/api/agents/${tester.id}/skills`, { skillIds: [otherSkill.id] });
    let seenSkillFile: string | null = null;
    let otherSkillVisible = true;
    engine.respond = (request) => {
      const skillFile = path.join(
        request.workingDirectory,
        '.aiteam-skills',
        'viet-test',
        'SKILL.md',
      );
      seenSkillFile = existsSync(skillFile) ? readFileSync(skillFile, 'utf8') : null;
      otherSkillVisible = existsSync(
        path.join(request.workingDirectory, '.aiteam-skills', 'bi-mat-qa'),
      );
      return Promise.resolve(agentReport('done', 'xong'));
    };

    const created = await app.callApi('POST', '/api/tasks', {
      departmentId: department.id,
      title: 'API đăng nhập',
      priority: 1,
      workflowId: null,
      assigneeAgentId: developer.id,
      workingDirectory: path.join(project, 'shop'),
    });
    const task = taskDetailSchema.parse(created.body);
    await waitFor(
      async () => taskDetailSchema.parse((await app.callApi('GET', `/api/tasks/${task.id}`)).body),
      (detail) => detail.status === 'succeeded',
      'task done',
    );

    const prompt = engine.requests[0]?.prompt ?? '';
    expect(prompt).toContain('Skill được giao cho bạn');
    expect(prompt).toContain(
      'Viết test: Khi cần Viết test (hướng dẫn: .aiteam-skills/viet-test/SKILL.md)',
    );
    expect(prompt).not.toContain('Bí mật QA');
    expect(seenSkillFile).toContain('Luôn viết test trước.');
    expect(otherSkillVisible).toBe(false);
    const worktree = (
      app.database.prepare('SELECT worktree_path FROM tasks WHERE id = ?').get(task.id) as {
        worktree_path: string;
      }
    ).worktree_path;
    const tracked = execFileSync('git', ['-C', worktree, 'ls-files'], { encoding: 'utf8' });
    expect(tracked).not.toContain('.aiteam-skills');
  }, 30_000);
});
