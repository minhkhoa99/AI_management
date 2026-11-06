import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/app-error';
import type { Position } from './entities/position';

export interface OrgChartBranch<Payload> {
  position: Position;
  payload: Payload;
  children: OrgChartBranch<Payload>[];
}

/**
 * Reporting structure of one department. Single place for the hierarchy rules:
 * - exactly one head (a seat without a manager); every other seat reports to a seat of the
 *   same department,
 * - no reporting cycles,
 * - a seat with subordinates cannot be removed,
 * - work is delegated to direct subordinates only.
 */
export class OrgChart {
  private readonly positionsById: ReadonlyMap<string, Position>;

  constructor(
    readonly departmentId: string,
    positions: readonly Position[],
  ) {
    this.positionsById = new Map(positions.map((position) => [position.id, position]));
  }

  findHead(): Position | undefined {
    return [...this.positionsById.values()].find(
      (position) => position.reportsToPositionId === null,
    );
  }

  requirePosition(positionId: string): Position {
    const position = this.positionsById.get(positionId);
    if (position === undefined) {
      throw new NotFoundError('Không tìm thấy thành viên trong phòng này.', {
        code: 'POSITION_NOT_FOUND',
      });
    }
    return position;
  }

  /** Rules for where a new member may be attached. */
  assertCanAttachNewMember(reportsToPositionId: string | null): void {
    const head = this.findHead();
    if (reportsToPositionId === null) {
      if (head !== undefined) {
        throw new ConflictError(
          'Phòng đã có trưởng phòng. Chọn người mà thành viên mới báo cáo cho.',
          {
            code: 'DEPARTMENT_HEAD_EXISTS',
          },
        );
      }
      return;
    }
    this.assertManagerBelongsToDepartment(reportsToPositionId);
  }

  assertCanChangeReportingLine(positionId: string, newManagerPositionId: string): void {
    this.requirePosition(positionId);
    this.assertManagerBelongsToDepartment(newManagerPositionId);
    if (
      newManagerPositionId === positionId ||
      this.listDescendantIds(positionId).has(newManagerPositionId)
    ) {
      throw new ConflictError('Không thể báo cáo cho chính mình hoặc cho cấp dưới của mình.', {
        code: 'REPORTING_CYCLE',
      });
    }
  }

  assertCanRemoveMember(positionId: string): void {
    this.requirePosition(positionId);
    const subordinateCount = this.listDirectSubordinates(positionId).length;
    if (subordinateCount > 0) {
      throw new ConflictError(
        `Thành viên này còn ${subordinateCount} cấp dưới. Chuyển họ sang người khác trước khi xoá.`,
        { code: 'MEMBER_HAS_SUBORDINATES' },
      );
    }
  }

  /** Delegation rule: a manager may hand work only to someone reporting directly to them. */
  isDirectSubordinate(managerPositionId: string, candidatePositionId: string): boolean {
    return this.positionsById.get(candidatePositionId)?.reportsToPositionId === managerPositionId;
  }

  listDirectSubordinates(positionId: string): Position[] {
    return [...this.positionsById.values()].filter(
      (position) => position.reportsToPositionId === positionId,
    );
  }

  /** Every seat below `positionId`, at any depth. */
  listDescendantIds(positionId: string): Set<string> {
    const descendantIds = new Set<string>();
    const pendingIds = [positionId];
    while (pendingIds.length > 0) {
      const currentId = pendingIds.pop() as string;
      for (const subordinate of this.listDirectSubordinates(currentId)) {
        if (!descendantIds.has(subordinate.id)) {
          descendantIds.add(subordinate.id);
          pendingIds.push(subordinate.id);
        }
      }
    }
    return descendantIds;
  }

  /** Tree from the head down; siblings keep the order given by `compareSiblings`. */
  buildTree<Payload>(
    attachPayload: (position: Position) => Payload,
    compareSiblings: (left: Payload, right: Payload) => number,
  ): OrgChartBranch<Payload> | null {
    const head = this.findHead();
    if (head === undefined) {
      return null;
    }
    const buildBranch = (position: Position): OrgChartBranch<Payload> => ({
      position,
      payload: attachPayload(position),
      children: this.listDirectSubordinates(position.id)
        .map(buildBranch)
        .sort((left, right) => compareSiblings(left.payload, right.payload)),
    });
    return buildBranch(head);
  }

  private assertManagerBelongsToDepartment(managerPositionId: string): void {
    if (!this.positionsById.has(managerPositionId)) {
      throw new ValidationError('Người được báo cáo phải là thành viên của cùng phòng.', {
        code: 'MANAGER_NOT_IN_DEPARTMENT',
      });
    }
  }
}
