import { describe, expect, it } from 'vitest';
import { Department } from './department';

describe('Department', () => {
  it('normalises name and colour on creation', () => {
    const department = Department.createNew({ id: 'd1', name: '  Phòng Dev ', color: '#60a5fa' });

    expect(department.toState()).toEqual({
      id: 'd1',
      name: 'Phòng Dev',
      color: '#60A5FA',
      enabled: true,
      teamMode: 'orchestrator',
    });
  });

  it.each([
    ['empty name', '   ', '#000000', 'DEPARTMENT_NAME_INVALID'],
    ['too long name', 'x'.repeat(61), '#000000', 'DEPARTMENT_NAME_INVALID'],
    ['bad colour', 'Dev', 'blue', 'COLOR_INVALID'],
  ])('rejects %s', (_label, name, color, code) => {
    expect(() => Department.createNew({ id: 'd1', name, color })).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it('compares names ignoring Vietnamese case and Unicode form', () => {
    const department = Department.createNew({ id: 'd1', name: 'Phòng Dev', color: '#000000' });

    expect(department.hasSameNameAs('PHÒNG DEV')).toBe(true);
    // Same text in decomposed Unicode form (o + combining grave accent).
    expect(department.hasSameNameAs('Phòng dev')).toBe(true);
    expect(department.hasSameNameAs('Phòng Design')).toBe(false);
  });

  it('refuses new tasks while disabled', () => {
    const department = Department.createNew({ id: 'd1', name: 'Dev', color: '#000000' });
    expect(() => department.assertAcceptsNewTasks()).not.toThrow();

    department.setEnabled(false);

    expect(() => department.assertAcceptsNewTasks()).toThrow(
      expect.objectContaining({ code: 'DEPARTMENT_DISABLED' }),
    );
  });
});
