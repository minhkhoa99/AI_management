'use client';

import Link from 'next/link';
import { TASK_EVENT_LIST_MAX } from '@aiteam/contracts';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { StatusNotice } from '../../../shared/ui/controls';
import { BOARD_COLUMN_PRESENTATION, STATUS_NOTES } from '../../tasks/task-labels';
import { loadTaskEvents } from '../../tasks/tasks-api';
import { loadAgentEvents, loadDelegatedTasks } from '../monitor-api';
import styles from './monitor.module.css';
import { useReloadOnRevision } from './workspace-queries';

const formatTime = (isoTime: string) =>
  new Date(isoTime).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** "Terminal": commands the agent ran in its worktree, with their output, oldest first. */
export function TerminalTab({ taskId, revision }: { taskId: string; revision: number }) {
  const events = useApiQuery(`task-terminal:${taskId}`, () =>
    loadTaskEvents(taskId, TASK_EVENT_LIST_MAX),
  );
  useReloadOnRevision(revision, events.reload);
  if (events.status === 'loading') return <p className={styles.mutedText}>Đang tải terminal…</p>;
  if (events.status === 'error')
    return <StatusNotice outcome={{ tone: 'error', error: events.error }} />;
  const commands = events.result.filter((event) => event.kind === 'command').reverse();
  if (commands.length === 0) return <p className={styles.mutedText}>Agent chưa chạy lệnh nào.</p>;
  return (
    <pre className={styles.terminal} aria-label="Lệnh agent đã chạy">
      {commands.map((event) => (
        <span key={event.id}>
          <span className={styles.terminalCommand}>
            [{formatTime(event.createdAt)}] {event.text}
          </span>
          {'\n'}
          {event.detail !== null && event.detail !== '' && (
            <span className={styles.terminalOutput}>
              {event.detail}
              {'\n'}
            </span>
          )}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

/** "Hoạt động": everything this agent did lately, across its tasks, newest first. */
export function ActivityTab({ agentId, revision }: { agentId: string; revision: number }) {
  const events = useApiQuery(`agent-events:${agentId}`, () => loadAgentEvents(agentId));
  useReloadOnRevision(revision, events.reload);
  if (events.status === 'loading') return <p className={styles.mutedText}>Đang tải hoạt động…</p>;
  if (events.status === 'error')
    return <StatusNotice outcome={{ tone: 'error', error: events.error }} />;
  if (events.result.length === 0)
    return <p className={styles.mutedText}>Agent chưa có hoạt động nào.</p>;
  return (
    <ul className={styles.eventList} aria-label="Hoạt động của agent">
      {events.result.map((event) => (
        <li key={event.id} className={styles.eventItem}>
          <span>{event.text}</span>
          <time className={styles.tileMeta} dateTime={event.createdAt}>
            {formatTime(event.createdAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}

/** "Kế hoạch": tasks a manager or PM handed down, and where each one is now. */
export function PlanTab({ agentId, revision }: { agentId: string; revision: number }) {
  const tasks = useApiQuery(`delegated-tasks:${agentId}`, () => loadDelegatedTasks(agentId));
  useReloadOnRevision(revision, tasks.reload);
  if (tasks.status === 'loading') return <p className={styles.mutedText}>Đang tải kế hoạch…</p>;
  if (tasks.status === 'error')
    return <StatusNotice outcome={{ tone: 'error', error: tasks.error }} />;
  if (tasks.result.length === 0)
    return <p className={styles.mutedText}>Chưa giao việc cho cấp dưới.</p>;
  return (
    <ul className={styles.eventList} aria-label="Việc đã giao">
      {tasks.result.map((task) => {
        const column = BOARD_COLUMN_PRESENTATION[task.boardColumn];
        return (
          <li key={task.id} className={styles.eventItem}>
            <Link href={`/tasks/?task=${encodeURIComponent(task.id)}`}>
              {task.code} · {task.title}
            </Link>
            <span className={styles.tileMeta} style={{ color: column.color }}>
              {STATUS_NOTES[task.status] ?? column.label}
              {task.assignee !== null && ` · ${task.assignee.name}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
