import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../domain/entities/task';
import type { WorkflowStepState } from '../../domain/entities/workflow';
import { StepReviewLauncher } from './step-review-launcher';

describe('StepReviewLauncher', () => {
  it('asks the user instead of starting a review when the task has no worktree', () => {
    const task = {
      toState: () => ({ worktreePath: null, departmentId: 'dept-1' }),
    } as unknown as Task;
    const step = { id: 'step-1', name: 'Thực hiện' } as unknown as WorkflowStepState;
    const taskRepository = { updateTask: vi.fn() };
    const approvalRequests = { requestApproval: vi.fn() };
    const staffDirectory = { listDepartmentStaff: vi.fn(), readEngineSnapshot: vi.fn() };
    const runPreparer = { prepareAgentRun: vi.fn() };
    const sessionSupervisor = { startSupervisedSession: vi.fn() };
    const launcher = new StepReviewLauncher(
      taskRepository as never,
      {} as never,
      staffDirectory as never,
      runPreparer as never,
      {} as never,
      {} as never,
      sessionSupervisor as never,
      {} as never,
      {} as never,
      approvalRequests as never,
      {} as never,
      {} as never,
      {} as never,
    );

    launcher.startStepReview(task, step, { agentId: 'worker-1', name: 'An' }, 'Xong việc', '/work');

    expect(approvalRequests.requestApproval).toHaveBeenCalledTimes(1);
    expect(approvalRequests.requestApproval).toHaveBeenCalledWith(
      task,
      expect.objectContaining({
        kind: 'step_gate',
        summary: 'Bước "Thực hiện": không tìm thấy thư mục làm việc, chờ bạn duyệt',
        step: { id: 'step-1', name: 'Thực hiện' },
        agent: { id: 'worker-1', name: 'An' },
      }),
    );
    expect(taskRepository.updateTask).toHaveBeenCalledWith(task);
    expect(runPreparer.prepareAgentRun).not.toHaveBeenCalled();
    expect(sessionSupervisor.startSupervisedSession).not.toHaveBeenCalled();
  });
});
