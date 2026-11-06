import type { Position } from '../entities/position';

export const POSITION_REPOSITORY = Symbol('POSITION_REPOSITORY');

export interface PositionRepository {
  listPositionsByDepartment(departmentId: string): Position[];
  /** Number of seats per department id (departments without seats are absent). */
  countPositionsPerDepartment(): Map<string, number>;
  findPositionById(positionId: string): Position | undefined;
  insertPosition(position: Position): void;
  updatePosition(position: Position): void;
  deletePosition(positionId: string): void;
}
