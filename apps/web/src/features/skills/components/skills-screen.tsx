'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { AgentSummary, Department, DepartmentSkill } from '@aiteam/contracts';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { DepartmentTabs } from '../../organization/components/department-tabs';
import { ROLE_LABELS } from '../../organization/organization-labels';
import { loadAgents, loadDepartments } from '../../organization/organization-api';
import { copySkill, deleteSkill, loadDepartmentSkills, setAgentSkills } from '../skills-api';
import { AddSkillPanel } from './add-skill-panel';
import { SkillEditorPanel } from './skill-editor-panel';
import styles from './skills.module.css';

const SOURCE_LABELS: Record<DepartmentSkill['sourceKind'], string> = {
  written: 'Tự viết',
  template: 'Từ mẫu',
  markdown: 'File .md',
  zip: 'File .zip',
  github: 'GitHub',
};

/** /skills?dept= : the department's skills, and which agent may use which one. */
export function SkillsScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const departments = useApiQuery('departments', loadDepartments);
  const departmentList = departments.status === 'success' ? departments.result : [];
  const selected =
    departmentList.find((department) => department.id === searchParams.get('dept')) ??
    departmentList[0];

  if (departments.status === 'loading') {
    return <p className={styles.mutedText}>Đang tải phòng ban…</p>;
  }
  if (departments.status === 'error') {
    return <StatusNotice outcome={{ tone: 'error', error: departments.error }} />;
  }
  return (
    <div className={styles.screen}>
      <DepartmentTabs
        departments={departmentList}
        selectedDepartmentId={selected?.id}
        onSelectDepartment={(departmentId) =>
          router.replace(`/skills/?dept=${encodeURIComponent(departmentId)}`, { scroll: false })
        }
      />
      {selected === undefined ? (
        <section className={controlStyles.panel} aria-label="Chưa có phòng ban">
          <h2 className={controlStyles.panelTitle}>Chưa có phòng ban</h2>
          <p className={styles.mutedText}>
            Skill thuộc về một phòng ban. Tạo phòng ban ở màn hình Sơ đồ tổ chức trước.
          </p>
        </section>
      ) : (
        <DepartmentSkills
          key={selected.id}
          department={selected}
          otherDepartments={departmentList.filter((department) => department.id !== selected.id)}
        />
      )}
    </div>
  );
}

function DepartmentSkills({
  department,
  otherDepartments,
}: {
  department: Department;
  otherDepartments: readonly Department[];
}) {
  const skills = useApiQuery(`skills:${department.id}`, () => loadDepartmentSkills(department.id));
  const agents = useApiQuery(`agents:${department.id}`, () => loadAgents(department.id));
  const [adding, setAdding] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const { outcome, isPending, performAction } = useActionOutcome();

  if (skills.status === 'loading' || agents.status === 'loading') {
    return <p className={styles.mutedText}>Đang tải skill…</p>;
  }
  if (skills.status === 'error')
    return <StatusNotice outcome={{ tone: 'error', error: skills.error }} />;
  if (agents.status === 'error')
    return <StatusNotice outcome={{ tone: 'error', error: agents.error }} />;
  const skillList = skills.result;

  return (
    <>
      <section className={controlStyles.panel} aria-label={`Skill của ${department.name}`}>
        <div className={styles.headerRow}>
          <div>
            <h2 className={controlStyles.panelTitle}>Skill của {department.name}</h2>
            <p className={styles.mutedText}>
              Agent chỉ dùng những skill được gán cho mình. Skill được chép vào thư mục làm việc của
              agent (.aiteam-skills/) ở mỗi lượt.
            </p>
          </div>
          <button
            type="button"
            className={controlStyles.primaryButton}
            onClick={() => setAdding((current) => !current)}
          >
            {adding ? 'Đóng' : 'Thêm skill'}
          </button>
        </div>
        <StatusNotice outcome={outcome} />
        {skillList.length === 0 ? (
          <p className={styles.mutedText}>Phòng chưa có skill nào.</p>
        ) : (
          <ul className={styles.skillList}>
            {skillList.map((skill) => (
              <li key={skill.id} className={styles.skillCard}>
                <div className={styles.skillHeader}>
                  <span className={styles.skillName}>{skill.name}</span>
                  <span className={styles.sourceBadge}>{SOURCE_LABELS[skill.sourceKind]}</span>
                </div>
                <p className={styles.skillDescription}>
                  {skill.description === '' ? 'Chưa có mô tả.' : skill.description}
                </p>
                <span className={styles.mutedText}>
                  {skill.fileCount} file · {formatBytes(skill.totalBytes)} ·{' '}
                  {skill.assignedAgentIds.length} agent dùng
                  {skill.sourceUrl !== null && (
                    <>
                      {' · '}
                      <span className={styles.sourceUrl}>{skill.sourceUrl}</span>
                    </>
                  )}
                </span>
                <div className={controlStyles.buttonRow}>
                  <button
                    type="button"
                    className={controlStyles.secondaryButton}
                    onClick={() => setEditingSkillId(skill.id)}
                  >
                    Xem / sửa
                  </button>
                  {otherDepartments.length > 0 && (
                    <select
                      aria-label={`Sao chép ${skill.name} sang phòng khác`}
                      className={controlStyles.fieldInput}
                      value=""
                      disabled={isPending}
                      onChange={(event) => {
                        const targetId = event.target.value;
                        const target = otherDepartments.find((entry) => entry.id === targetId);
                        if (target === undefined) return;
                        void performAction(
                          () => copySkill(skill.id, target.id),
                          () => `Đã sao chép "${skill.name}" sang ${target.name}.`,
                        );
                      }}
                    >
                      <option value="">Sao chép sang…</option>
                      {otherDepartments.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className={controlStyles.dangerButton}
                    disabled={isPending}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Xoá skill "${skill.name}"? Agent đang dùng sẽ mất skill này.`,
                        )
                      )
                        return;
                      void performAction(
                        () => deleteSkill(skill.id),
                        () => `Đã xoá "${skill.name}".`,
                      );
                    }}
                  >
                    Xoá
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {adding && <AddSkillPanel departmentId={department.id} onAdded={() => setAdding(false)} />}
      {editingSkillId !== null && (
        <SkillEditorPanel
          key={editingSkillId}
          skillId={editingSkillId}
          onClose={() => setEditingSkillId(null)}
        />
      )}
      <AssignmentTable agents={agents.result} skills={skillList} />
    </>
  );
}

/** Rows: agents of the department; columns: skills. Each tick saves at once. */
function AssignmentTable({
  agents,
  skills,
}: {
  agents: readonly AgentSummary[];
  skills: readonly DepartmentSkill[];
}) {
  const { outcome, isPending, performAction } = useActionOutcome();
  if (skills.length === 0 || agents.length === 0) return null;
  const skillIdsOf = (agentId: string) =>
    skills.filter((skill) => skill.assignedAgentIds.includes(agentId)).map((skill) => skill.id);

  return (
    <section className={controlStyles.panel} aria-label="Gán skill cho agent">
      <h2 className={controlStyles.panelTitle}>Gán skill cho agent</h2>
      <StatusNotice outcome={outcome} />
      <div className={styles.tableScroll}>
        <table className={styles.assignmentTable}>
          <thead>
            <tr>
              <th scope="col">Agent</th>
              {skills.map((skill) => (
                <th key={skill.id} scope="col">
                  {skill.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id}>
                <th scope="row">
                  {agent.name}
                  <span className={styles.mutedText}> · {ROLE_LABELS[agent.role]}</span>
                </th>
                {skills.map((skill) => {
                  const assigned = skill.assignedAgentIds.includes(agent.id);
                  return (
                    <td key={skill.id}>
                      <input
                        type="checkbox"
                        aria-label={`${agent.name} dùng skill ${skill.name}`}
                        checked={assigned}
                        disabled={isPending}
                        onChange={() => {
                          const current = skillIdsOf(agent.id);
                          const next = assigned
                            ? current.filter((skillId) => skillId !== skill.id)
                            : [...current, skill.id];
                          void performAction(
                            () => setAgentSkills(agent.id, next),
                            () => null,
                          );
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toLocaleString('vi', { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('vi', { maximumFractionDigits: 1 })} MB`;
}
