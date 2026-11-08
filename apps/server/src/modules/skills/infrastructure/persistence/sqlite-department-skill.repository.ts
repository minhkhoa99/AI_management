import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import type { SkillSourceKind } from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import type {
  DepartmentSkillRecord,
  DepartmentSkillRepository,
} from '../../domain/repositories/department-skill.repository';

interface SkillRow {
  id: string;
  department_id: string;
  name: string;
  description: string;
  source_kind: SkillSourceKind;
  source_url: string | null;
  file_count: number;
  total_bytes: number;
  updated_at: string;
}

const SKILL_COLUMNS = `s.id, s.department_id, s.name, s.description, s.source_kind, s.source_url,
  s.file_count, s.total_bytes, s.updated_at`;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

@Injectable()
export class SqliteDepartmentSkillRepository implements DepartmentSkillRepository {
  private readonly findStatement: StatementSync;
  private readonly listStatement: StatementSync;
  private readonly nameTakenStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly updateStatement: StatementSync;
  private readonly deleteStatement: StatementSync;
  private readonly assignmentsStatement: StatementSync;
  private readonly agentSkillsStatement: StatementSync;
  private readonly clearAgentStatement: StatementSync;
  private readonly assignStatement: StatementSync;
  private readonly agentDepartmentStatement: StatementSync;
  private readonly departmentStatement: StatementSync;

  constructor(
    @Inject(SQLITE_DATABASE) database: DatabaseSync,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
  ) {
    this.findStatement = database.prepare(
      `SELECT ${SKILL_COLUMNS} FROM department_skills s WHERE s.id = ?`,
    );
    this.listStatement = database.prepare(
      `SELECT ${SKILL_COLUMNS} FROM department_skills s WHERE s.department_id = ?
        ORDER BY s.created_at, s.rowid`,
    );
    this.nameTakenStatement = database.prepare(
      `SELECT 1 FROM department_skills
        WHERE department_id = ? AND lower(name) = lower(?) AND id <> ? LIMIT 1`,
    );
    this.insertStatement = database.prepare(
      `INSERT INTO department_skills
         (id, department_id, name, description, source_kind, source_url, file_count, total_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.updateStatement = database.prepare(
      `UPDATE department_skills SET name = ?, description = ?, source_kind = ?, source_url = ?,
         file_count = ?, total_bytes = ?, updated_at = ${NOW}
       WHERE id = ?`,
    );
    this.deleteStatement = database.prepare('DELETE FROM department_skills WHERE id = ?');
    this.assignmentsStatement = database.prepare(
      `SELECT a.skill_id, a.agent_id FROM agent_skills a
         JOIN department_skills s ON s.id = a.skill_id
        WHERE s.department_id = ? ORDER BY a.agent_id`,
    );
    this.agentSkillsStatement = database.prepare(
      `SELECT ${SKILL_COLUMNS} FROM department_skills s
         JOIN agent_skills a ON a.skill_id = s.id
        WHERE a.agent_id = ? ORDER BY s.created_at, s.rowid`,
    );
    this.clearAgentStatement = database.prepare('DELETE FROM agent_skills WHERE agent_id = ?');
    this.assignStatement = database.prepare(
      'INSERT OR IGNORE INTO agent_skills (agent_id, skill_id) VALUES (?, ?)',
    );
    this.agentDepartmentStatement = database.prepare(
      'SELECT department_id FROM positions WHERE agent_id = ?',
    );
    this.departmentStatement = database.prepare('SELECT 1 FROM departments WHERE id = ?');
  }

  findSkillById(skillId: string): DepartmentSkillRecord | undefined {
    const row = this.findStatement.get(skillId) as SkillRow | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  listDepartmentSkills(departmentId: string): DepartmentSkillRecord[] {
    return (this.listStatement.all(departmentId) as unknown as SkillRow[]).map(toRecord);
  }

  isSkillNameTaken(departmentId: string, name: string, exceptSkillId: string | null): boolean {
    return this.nameTakenStatement.get(departmentId, name, exceptSkillId ?? '') !== undefined;
  }

  insertSkill(skill: Omit<DepartmentSkillRecord, 'updatedAt'>): void {
    this.insertStatement.run(
      skill.id,
      skill.departmentId,
      skill.name,
      skill.description,
      skill.sourceKind,
      skill.sourceUrl,
      skill.fileCount,
      skill.totalBytes,
    );
  }

  updateSkill(skill: Omit<DepartmentSkillRecord, 'updatedAt'>): void {
    this.updateStatement.run(
      skill.name,
      skill.description,
      skill.sourceKind,
      skill.sourceUrl,
      skill.fileCount,
      skill.totalBytes,
      skill.id,
    );
  }

  deleteSkill(skillId: string): void {
    this.deleteStatement.run(skillId);
  }

  listAssignedAgentIds(departmentId: string): Map<string, string[]> {
    const assignments = new Map<string, string[]>();
    for (const row of this.assignmentsStatement.all(departmentId) as unknown as Array<{
      skill_id: string;
      agent_id: string;
    }>) {
      assignments.set(row.skill_id, [...(assignments.get(row.skill_id) ?? []), row.agent_id]);
    }
    return assignments;
  }

  listAgentSkills(agentId: string): DepartmentSkillRecord[] {
    return (this.agentSkillsStatement.all(agentId) as unknown as SkillRow[]).map(toRecord);
  }

  replaceAgentSkills(agentId: string, skillIds: readonly string[]): void {
    this.transactionRunner.runInTransaction(() => {
      this.clearAgentStatement.run(agentId);
      for (const skillId of skillIds) this.assignStatement.run(agentId, skillId);
    });
  }

  findAgentDepartmentId(agentId: string): string | undefined {
    const row = this.agentDepartmentStatement.get(agentId) as { department_id: string } | undefined;
    return row?.department_id;
  }

  departmentExists(departmentId: string): boolean {
    return this.departmentStatement.get(departmentId) !== undefined;
  }
}

function toRecord(row: SkillRow): DepartmentSkillRecord {
  return {
    id: row.id,
    departmentId: row.department_id,
    name: row.name,
    description: row.description,
    sourceKind: row.source_kind,
    sourceUrl: row.source_url,
    fileCount: Number(row.file_count),
    totalBytes: Number(row.total_bytes),
    updatedAt: row.updated_at,
  };
}
