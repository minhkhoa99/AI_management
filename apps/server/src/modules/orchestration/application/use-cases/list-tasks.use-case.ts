import { Inject, Injectable } from '@nestjs/common';
import type { TaskListQuery, TaskSummary } from '@aiteam/contracts';
import { TASK_BOARD_QUERY, type TaskBoardQuery } from '../ports/task-board.query';

@Injectable()
export class ListTasksUseCase {
  constructor(@Inject(TASK_BOARD_QUERY) private readonly taskBoardQuery: TaskBoardQuery) {}

  listTasks(query: TaskListQuery): TaskSummary[] {
    return this.taskBoardQuery.listTaskSummaries(query);
  }
}
