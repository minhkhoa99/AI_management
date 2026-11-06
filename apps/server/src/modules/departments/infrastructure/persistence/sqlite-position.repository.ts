import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type { Position } from '../../domain/entities/position';
import type { PositionRepository } from '../../domain/repositories/position.repository';

interface PositionRow {
  id: string;
  department_id: string;
  title: string;
  reports_to_position_id: string | null;
  agent_id: string;
}

const POSITION_COLUMNS = 'id, department_id, title, reports_to_position_id, agent_id';

@Injectable()
export class SqlitePositionRepository implements PositionRepository {
  private readonly selectByDepartmentStatement: StatementSync;
  private readonly countPerDepartmentStatement: StatementSync;
  private readonly selectByIdStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly updateStatement: StatementSync;
  private readonly deleteStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.selectByDepartmentStatement = database.prepare(
      `SELECT ${POSITION_COLUMNS} FROM positions WHERE department_id = ? ORDER BY rowid`,
    );
    this.countPerDepartmentStatement = database.prepare(
      'SELECT department_id, COUNT(*) AS seat_count FROM positions GROUP BY department_id',
    );
    this.selectByIdStatement = database.prepare(
      `SELECT ${POSITION_COLUMNS} FROM positions WHERE id = ?`,
    );
    this.insertStatement = database.prepare(
      'INSERT INTO positions (id, department_id, title, reports_to_position_id, agent_id) VALUES (?, ?, ?, ?, ?)',
    );
    this.updateStatement = database.prepare(
      'UPDATE positions SET title = ?, reports_to_position_id = ? WHERE id = ?',
    );
    this.deleteStatement = database.prepare('DELETE FROM positions WHERE id = ?');
  }

  listPositionsByDepartment(departmentId: string): Position[] {
    return (this.selectByDepartmentStatement.all(departmentId) as unknown as PositionRow[]).map(
      restorePosition,
    );
  }

  countPositionsPerDepartment(): Map<string, number> {
    const rows = this.countPerDepartmentStatement.all() as unknown as Array<{
      department_id: string;
      seat_count: number;
    }>;
    return new Map(rows.map((row) => [row.department_id, Number(row.seat_count)]));
  }

  findPositionById(positionId: string): Position | undefined {
    const row = this.selectByIdStatement.get(positionId) as PositionRow | undefined;
    return row === undefined ? undefined : restorePosition(row);
  }

  insertPosition(position: Position): void {
    this.insertStatement.run(
      position.id,
      position.departmentId,
      position.title,
      position.reportsToPositionId,
      position.agentId,
    );
  }

  updatePosition(position: Position): void {
    this.updateStatement.run(position.title, position.reportsToPositionId, position.id);
  }

  deletePosition(positionId: string): void {
    this.deleteStatement.run(positionId);
  }
}

function restorePosition(row: PositionRow): Position {
  return {
    id: row.id,
    departmentId: row.department_id,
    title: row.title,
    reportsToPositionId: row.reports_to_position_id,
    agentId: row.agent_id,
  };
}
