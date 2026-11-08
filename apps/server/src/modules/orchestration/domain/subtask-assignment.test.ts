import { describe, expect, it } from 'vitest';
import type { SubtaskRequest } from './agent-report';
import { assignSubtasks } from './subtask-assignment';

const request = (title: string, assignee: string | null = null): SubtaskRequest => ({
  title,
  description: '',
  assignee,
});

const team = [
  { agentId: 'dev', name: 'Dev backend', role: 'dev' as const },
  { agentId: 'qc', name: 'QC Minh', role: 'qc' as const },
];

describe('assignSubtasks', () => {
  it('gives a subtask to the subordinate named, ignoring case and spaces', () => {
    const [assignment] = assignSubtasks([request('Test', '  qc minh ')], team, new Map());

    expect(assignment?.agentId).toBe('qc');
  });

  it('spreads unnamed subtasks, least busy first, and ignores unknown names', () => {
    const assignments = assignSubtasks(
      [request('A'), request('B', 'Người lạ'), request('C')],
      team,
      new Map([['dev', 1]]),
    );

    expect(assignments.map((assignment) => assignment.agentId)).toEqual(['qc', 'dev', 'qc']);
  });

  it('assigns nothing without subordinates', () => {
    expect(assignSubtasks([request('A')], [], new Map())).toEqual([]);
  });
});
