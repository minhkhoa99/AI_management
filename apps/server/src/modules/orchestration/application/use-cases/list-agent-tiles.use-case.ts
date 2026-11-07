import { Inject, Injectable } from '@nestjs/common';
import {
  FINISHED_TASK_STATUSES,
  resolveTaskBoardColumn,
  type AgentRole,
  type AgentTile,
  type WorkType,
} from '@aiteam/contracts';
import { describeTaskEvent } from '../../../tracing/domain/describe-task-event';
import {
  AGENT_TILE_QUERY,
  type AgentTileQuery,
  type AgentTileRow,
} from '../ports/agent-tile.query';
import { TaskRunRegistry } from './task-run-registry';

const WORK_TYPE_BY_ROLE: Record<AgentRole, WorkType> = {
  // eslint-disable-next-line id-denylist -- role value from AGENT_ROLES (contracts)
  manager: 'plan',
  pm: 'plan',
  dev: 'code',
  qc: 'test',
  designer: 'design',
  writer: 'docs',
  analyst: 'docs',
  support: 'support',
};

/** "Agent đang làm gì": one tile per agent with its task, step and latest action. */
@Injectable()
export class ListAgentTilesUseCase {
  constructor(
    @Inject(AGENT_TILE_QUERY) private readonly tileQuery: AgentTileQuery,
    private readonly runRegistry: TaskRunRegistry,
  ) {}

  listAgentTiles(departmentId: string | undefined): AgentTile[] {
    return this.tileQuery.listAgentTileRows(departmentId).map((row) => {
      // A superior reviewing a step works on a task assigned to someone else.
      const runningTaskId = this.runRegistry.listTaskIdsRunBy(row.agentId)[0];
      const task =
        runningTaskId !== undefined && runningTaskId !== row.task?.id
          ? this.tileQuery.findTaskRow(runningTaskId)
          : row.task;
      return {
        agent: {
          id: row.agentId,
          name: row.name,
          role: row.role,
          provider: row.provider,
          available: row.available,
        },
        departmentId: row.departmentId,
        state: resolveTileState(row, runningTaskId !== undefined),
        workType: WORK_TYPE_BY_ROLE[row.role],
        task:
          task === null
            ? null
            : {
                id: task.id,
                code: `T-${task.sequenceNumber}`,
                title: task.title,
                status: task.status,
                boardColumn: resolveTaskBoardColumn(task.status, task.stepGate),
                stepName: task.stepName,
                stepNumber: task.stepPosition === null ? null : task.stepPosition + 1,
                stepCount: task.stepCount,
                workingDirectory: task.workingDirectory,
              },
        lastActivity:
          row.lastEvent === null
            ? null
            : { text: describeTaskEvent(row.lastEvent), at: row.lastEvent.createdAt },
      };
    });
  }
}

function resolveTileState(row: AgentTileRow, isRunning: boolean): AgentTile['state'] {
  if (!row.available) return 'off';
  if (isRunning || row.task?.status === 'running') return 'working';
  const isFinished =
    row.task === null || (FINISHED_TASK_STATUSES as readonly string[]).includes(row.task.status);
  return isFinished ? 'idle' : 'waiting';
}
