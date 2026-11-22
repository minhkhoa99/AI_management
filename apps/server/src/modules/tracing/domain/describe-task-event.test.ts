import { describe, expect, it } from 'vitest';
import { describeTaskEvent } from './describe-task-event';

describe('describeTaskEvent', () => {
  it('describes a handoff to another department', () => {
    expect(
      describeTaskEvent({
        kind: 'handoff_sent',
        payload: { stepName: 'Review', departmentName: 'Review', childCode: 'T-13' },
      }),
    ).toBe('bàn giao bước "Review" cho phòng Review (T-13)');
  });

  it.each([
    ['passed', 'phòng Review (T-13) báo đạt'],
    ['rejected', 'phòng Review (T-13) báo không đạt'],
    ['technical', 'phòng Review (T-13) báo lỗi kỹ thuật'],
  ])('describes the %s verdict of the other department', (verdict, line) => {
    expect(
      describeTaskEvent({
        kind: 'handoff_returned',
        payload: { departmentName: 'Review', childCode: 'T-13', verdict },
      }),
    ).toBe(line);
  });

  it('names a deleted handoff child', () => {
    expect(
      describeTaskEvent({
        kind: 'handoff_returned',
        payload: { departmentName: 'Review', childCode: null, verdict: 'technical' },
      }),
    ).toBe('phòng Review (task đã xoá) báo lỗi kỹ thuật');
  });
});
