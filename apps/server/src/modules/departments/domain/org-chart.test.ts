import { describe, expect, it } from 'vitest';
import type { Position } from './entities/position';
import { OrgChart } from './org-chart';

// Dev department from the design: Manager → PM → (Dev backend, Dev frontend, QC)
function seat(id: string, reportsToPositionId: string | null): Position {
  return { id, departmentId: 'dev', title: id, reportsToPositionId, agentId: `agent-${id}` };
}

const devDepartmentSeats = [
  seat('manager', null),
  seat('pm', 'manager'),
  seat('backend', 'pm'),
  seat('frontend', 'pm'),
  seat('qc', 'pm'),
];

function createDevChart(): OrgChart {
  return new OrgChart('dev', devDepartmentSeats);
}

describe('OrgChart', () => {
  describe('attaching a new member', () => {
    it('makes the first member the head', () => {
      expect(() => new OrgChart('dev', []).assertCanAttachNewMember(null)).not.toThrow();
    });

    it('rejects a second head', () => {
      expect(() => createDevChart().assertCanAttachNewMember(null)).toThrow(
        expect.objectContaining({ code: 'DEPARTMENT_HEAD_EXISTS' }),
      );
    });

    it('requires the manager to be in the same department', () => {
      expect(() => createDevChart().assertCanAttachNewMember('seat-of-marketing')).toThrow(
        expect.objectContaining({ code: 'MANAGER_NOT_IN_DEPARTMENT' }),
      );
      expect(() => createDevChart().assertCanAttachNewMember('pm')).not.toThrow();
    });
  });

  describe('changing a reporting line', () => {
    it('allows moving a member under a non-descendant', () => {
      expect(() => createDevChart().assertCanChangeReportingLine('qc', 'manager')).not.toThrow();
      expect(() => createDevChart().assertCanChangeReportingLine('qc', 'backend')).not.toThrow();
    });

    it.each([
      ['itself', 'pm', 'pm'],
      ['a direct subordinate', 'pm', 'backend'],
      ['a deeper descendant', 'manager', 'qc'],
      ['moving the head anywhere', 'manager', 'pm'],
    ])('rejects reporting to %s', (_label, positionId, newManagerId) => {
      expect(() => createDevChart().assertCanChangeReportingLine(positionId, newManagerId)).toThrow(
        expect.objectContaining({ code: 'REPORTING_CYCLE' }),
      );
    });

    it('rejects unknown seats', () => {
      expect(() => createDevChart().assertCanChangeReportingLine('ghost', 'pm')).toThrow(
        expect.objectContaining({ code: 'POSITION_NOT_FOUND' }),
      );
      expect(() => createDevChart().assertCanChangeReportingLine('qc', 'ghost')).toThrow(
        expect.objectContaining({ code: 'MANAGER_NOT_IN_DEPARTMENT' }),
      );
    });
  });

  describe('removing a member', () => {
    it('blocks removal while the member has subordinates', () => {
      expect(() => createDevChart().assertCanRemoveMember('pm')).toThrow(
        expect.objectContaining({ code: 'MEMBER_HAS_SUBORDINATES' }),
      );
    });

    it('allows removing a leaf, and the head once alone', () => {
      expect(() => createDevChart().assertCanRemoveMember('qc')).not.toThrow();
      expect(() =>
        new OrgChart('dev', [seat('manager', null)]).assertCanRemoveMember('manager'),
      ).not.toThrow();
    });
  });

  describe('delegation rule', () => {
    it('only accepts direct subordinates', () => {
      const chart = createDevChart();

      expect(chart.isDirectSubordinate('pm', 'backend')).toBe(true);
      expect(chart.isDirectSubordinate('manager', 'pm')).toBe(true);
      expect(chart.isDirectSubordinate('manager', 'backend')).toBe(false);
      expect(chart.isDirectSubordinate('backend', 'pm')).toBe(false);
      expect(chart.isDirectSubordinate('backend', 'frontend')).toBe(false);
    });
  });

  describe('buildTree', () => {
    it('returns null for an empty department', () => {
      expect(
        new OrgChart('dev', []).buildTree(
          (position) => position.id,
          () => 0,
        ),
      ).toBeNull();
    });

    it('nests seats under their managers with sorted siblings', () => {
      const tree = createDevChart().buildTree(
        (position) => position.id,
        (left, right) => left.localeCompare(right),
      );

      expect(tree?.payload).toBe('manager');
      expect(tree?.children.map((child) => child.payload)).toEqual(['pm']);
      expect(tree?.children[0]?.children.map((child) => child.payload)).toEqual([
        'backend',
        'frontend',
        'qc',
      ]);
    });
  });
});
