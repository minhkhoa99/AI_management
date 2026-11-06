import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import type { TeamMode } from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import { Department } from '../../domain/entities/department';
import type { DepartmentRepository } from '../../domain/repositories/department.repository';

interface DepartmentRow {
  id: string;
  name: string;
  color: string;
  enabled: number;
  team_mode: TeamMode;
}

const DEPARTMENT_COLUMNS = 'id, name, color, enabled, team_mode';

@Injectable()
export class SqliteDepartmentRepository implements DepartmentRepository {
  private readonly selectAllStatement: StatementSync;
  private readonly selectByIdStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly updateStatement: StatementSync;
  private readonly deleteStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.selectAllStatement = database.prepare(
      `SELECT ${DEPARTMENT_COLUMNS} FROM departments ORDER BY created_at, rowid`,
    );
    this.selectByIdStatement = database.prepare(
      `SELECT ${DEPARTMENT_COLUMNS} FROM departments WHERE id = ?`,
    );
    this.insertStatement = database.prepare(
      'INSERT INTO departments (id, name, color, enabled, team_mode) VALUES (?, ?, ?, ?, ?)',
    );
    this.updateStatement = database.prepare(
      'UPDATE departments SET name = ?, color = ?, enabled = ?, team_mode = ? WHERE id = ?',
    );
    this.deleteStatement = database.prepare('DELETE FROM departments WHERE id = ?');
  }

  listDepartments(): Department[] {
    return (this.selectAllStatement.all() as unknown as DepartmentRow[]).map(restoreDepartment);
  }

  findDepartmentById(departmentId: string): Department | undefined {
    const row = this.selectByIdStatement.get(departmentId) as DepartmentRow | undefined;
    return row === undefined ? undefined : restoreDepartment(row);
  }

  insertDepartment(department: Department): void {
    const state = department.toState();
    this.insertStatement.run(
      state.id,
      state.name,
      state.color,
      Number(state.enabled),
      state.teamMode,
    );
  }

  updateDepartment(department: Department): void {
    const state = department.toState();
    this.updateStatement.run(
      state.name,
      state.color,
      Number(state.enabled),
      state.teamMode,
      state.id,
    );
  }

  deleteDepartment(departmentId: string): void {
    this.deleteStatement.run(departmentId);
  }
}

function restoreDepartment(row: DepartmentRow): Department {
  return Department.restore({
    id: row.id,
    name: row.name,
    color: row.color,
    enabled: row.enabled === 1,
    teamMode: row.team_mode,
  });
}
