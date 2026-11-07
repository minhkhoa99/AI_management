import { Inject, Injectable } from '@nestjs/common';
import type { MoveTaskStageRequest, TaskDetail } from '@aiteam/contracts';
import { ConflictError } from '../../../../shared/errors/app-error';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { TASK_EVENT_LOG, type TaskEventLog } from '../ports/task-execution.ports';
import { GetTaskDetailUseCase, requireTaskExists } from './get-task-detail.use-case';
import { TaskProgression } from './task-progression';
import { TaskRunRegistry } from './task-run-registry';

/**
 * Kanban arrows on a workflow task nobody is working on. Back: the previous step runs again.
 * Forward: the current step is passed by hand, refused when the workflow forbids skipping.
 */
@Injectable()
export class MoveTaskStageUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    private readonly runRegistry: TaskRunRegistry,
    private readonly progression: TaskProgression,
    private readonly getTaskDetailUseCase: GetTaskDetailUseCase,
  ) {}

  moveTaskStage(taskId: string, request: MoveTaskStageRequest): TaskDetail {
    const task = requireTaskExists(this.taskRepository, taskId);
    const state = task.toState();
    if (this.runRegistry.isRunning(taskId) || !['queued', 'failed'].includes(state.status)) {
      throw new ConflictError(
        'Chỉ chuyển bước được khi task đang chờ hoặc đã thất bại (không có agent chạy, không chờ duyệt).',
        { code: 'TASK_BUSY' },
      );
    }
    const route = this.progression.resolveTaskRoute(state.workflowId);
    if (route === null) {
      throw new ConflictError('Task không theo quy trình bắt buộc nên không có bước để chuyển.', {
        code: 'TASK_HAS_NO_STEPS',
      });
    }
    const index = Math.max(
      0,
      route.steps.findIndex((step) => step.id === state.currentStepId),
    );
    if (request.direction === 'back') {
      const previous = route.steps[index - 1];
      if (previous === undefined) {
        throw new ConflictError('Task đang ở bước đầu tiên.', { code: 'NO_PREVIOUS_STEP' });
      }
      task.forgetEngineSession(null);
      task.requeue({
        stepId: previous.id,
        retriesUsed: 0,
        note: `Bạn chuyển về bước "${previous.name}".`,
      });
    } else {
      if (!route.allowsSkipping) {
        throw new ConflictError('Quy trình bật luật "Không được bỏ qua bước".', {
          code: 'WORKFLOW_NO_SKIPPING',
        });
      }
      const current = route.steps[index];
      task.requeue({ stepId: current?.id ?? null, retriesUsed: 0 });
      this.progression.applyGateResult(task, true, null);
    }
    this.eventLog.recordTaskEvent({
      taskId,
      agentId: null,
      kind: 'stage_moved',
      payload: { direction: request.direction },
    });
    this.taskRepository.updateTask(task);
    return this.getTaskDetailUseCase.getTaskDetail(taskId);
  }
}
