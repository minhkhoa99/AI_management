import { Inject, Injectable } from '@nestjs/common';
import type { AgentEngineEvent } from '@aiteam/contracts';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { TASK_EVENT_LOG, type TaskEventLog } from '../ports/task-execution.ports';

const TEXT_LIMIT = 2_000;

/** Writes an agent session's events to the task log; remembers the engine session id. */
@Injectable()
export class SessionEventRecorder {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
  ) {}

  recordSessionEvent(
    taskId: string,
    agentId: string,
    event: AgentEngineEvent,
    options: { keepSessionRef: boolean },
  ): void {
    switch (event.kind) {
      case 'text_delta':
        return; // Streaming fragments; the complete message follows.
      case 'session_started':
        if (options.keepSessionRef && event.sessionRef !== null) {
          const task = this.taskRepository.findTaskById(taskId);
          if (task !== undefined) {
            task.recordSessionRef(event.sessionRef);
            this.taskRepository.updateTask(task);
          }
        }
        this.eventLog.recordTaskEvent({
          taskId,
          agentId,
          kind: 'session_started',
          payload: { model: event.model },
        });
        return;
      case 'message':
        this.eventLog.recordTaskEvent({
          taskId,
          agentId,
          kind: 'message',
          payload: { text: clip(event.text) },
        });
        return;
      case 'command':
        this.eventLog.recordTaskEvent({
          taskId,
          agentId,
          kind: 'command',
          payload: {
            command: clip(event.command),
            exitCode: event.exitCode,
            output: clip(event.output),
          },
        });
        return;
      default:
        this.eventLog.recordTaskEvent({ taskId, agentId, kind: event.kind, payload: { ...event } });
    }
  }
}

function clip(text: string): string {
  return text.length <= TEXT_LIMIT ? text : `${text.slice(0, TEXT_LIMIT)}…`;
}
