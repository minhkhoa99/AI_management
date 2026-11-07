import { Inject, Injectable } from '@nestjs/common';
import type { TaskSummary } from '@aiteam/contracts';
import { AGENT_TILE_QUERY, type AgentTileQuery } from '../ports/agent-tile.query';
import { TASK_BOARD_QUERY, type TaskBoardQuery } from '../ports/task-board.query';

/** Monitor "Kế hoạch" tab of a manager: the tasks it handed down and where they are. */
@Injectable()
export class ListDelegatedTasksUseCase {
  constructor(
    @Inject(AGENT_TILE_QUERY) private readonly tileQuery: AgentTileQuery,
    @Inject(TASK_BOARD_QUERY) private readonly taskBoardQuery: TaskBoardQuery,
  ) {}

  listDelegatedTasks(agentId: string): TaskSummary[] {
    return this.tileQuery
      .listDelegatedTaskIds(agentId)
      .flatMap((taskId) => this.taskBoardQuery.findTaskSummary(taskId) ?? []);
  }
}
