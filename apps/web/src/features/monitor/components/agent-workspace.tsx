'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AgentTile, TaskEvent } from '@aiteam/contracts';
import { useEventStream } from '../../../shared/api/use-event-stream';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { AgentAvatar } from '../../organization/components/agent-identity';
import { ROLE_LABELS } from '../../organization/organization-labels';
import { pauseTask, resumeTask } from '../monitor-api';
import { DiffTab } from './diff-tab';
import { DocsTab } from './docs-tab';
import { FilesTab } from './files-tab';
import { PreviewTab } from './preview-tab';
import { ActivityTab, PlanTab, TerminalTab } from './log-tabs';
import styles from './monitor.module.css';

export const WORKSPACE_TABS = [
  'code',
  'diff',
  'preview',
  'terminal',
  'activity',
  'docs',
  'plan',
] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

const TAB_LABELS: Record<WorkspaceTab, string> = {
  code: 'Code & thư mục',
  diff: 'Thay đổi',
  preview: 'Giao diện',
  terminal: 'Terminal',
  activity: 'Hoạt động',
  docs: 'Tài liệu',
  plan: 'Kế hoạch',
};

const DEFAULT_TAB: Record<AgentTile['workType'], WorkspaceTab> = {
  code: 'code',
  design: 'preview',
  test: 'terminal',
  docs: 'docs',
  plan: 'plan',
  support: 'activity',
};

/** Revision counters: each live event kind refreshes only what it changes. */
export interface LiveRevisions {
  files: number;
  checkpoints: number;
  commands: number;
  activity: number;
  changedFile: string | null;
}

/** "Không gian làm việc của agent": header with pause/resume and the tabs. */
export function AgentWorkspace({
  tile,
  requestedTab,
  onSelectTab,
}: {
  tile: AgentTile;
  requestedTab: string | null;
  onSelectTab: (tab: WorkspaceTab) => void;
}) {
  const task = tile.task;
  const leadsOthers = tile.agent.role === 'manager' || tile.agent.role === 'pm';
  const tabs = WORKSPACE_TABS.filter((tab) => tab !== 'plan' || leadsOthers);
  const tab =
    tabs.find((candidate) => candidate === requestedTab) ??
    (tabs.includes(DEFAULT_TAB[tile.workType]) ? DEFAULT_TAB[tile.workType] : 'code');
  const [revisions, setRevisions] = useState<LiveRevisions>({
    files: 0,
    checkpoints: 0,
    commands: 0,
    activity: 0,
    changedFile: null,
  });
  const { outcome, isPending, performAction } = useActionOutcome();

  useEventStream(
    task === null ? null : `/api/stream/tasks/${encodeURIComponent(task.id)}`,
    (updates) => {
      const events = updates.flatMap((update) => (update.event === null ? [] : [update.event]));
      const has = (kind: TaskEvent['kind']) => events.some((event) => event.kind === kind);
      setRevisions((previous) => ({
        files: previous.files + (has('file_change') || has('checkpoint') ? 1 : 0),
        checkpoints: previous.checkpoints + (has('checkpoint') ? 1 : 0),
        commands: previous.commands + (has('command') ? 1 : 0),
        activity: previous.activity + (events.length > 0 ? 1 : 0),
        changedFile:
          events.findLast((event) => event.filePath !== null)?.filePath ?? previous.changedFile,
      }));
    },
  );

  const canPause = task !== null && (task.status === 'running' || task.status === 'queued');
  const canResume = task?.status === 'paused';

  return (
    <section aria-label="Không gian làm việc của agent" className={styles.workspace}>
      <div className={styles.workspaceHeader}>
        <AgentAvatar
          name={tile.agent.name}
          provider={tile.agent.provider}
          available={tile.agent.available}
        />
        <div className={styles.workspaceTitle}>
          <h2 className={styles.workspaceName}>{tile.agent.name}</h2>
          <span className={styles.tileMeta}>
            {ROLE_LABELS[tile.agent.role]}
            {task === null ? ' · chưa có task' : ` · ${task.code} · ${task.title}`}
          </span>
          {task !== null && task.workingDirectory !== null && (
            <span className={styles.monoText}>{task.workingDirectory}</span>
          )}
        </div>
        <div className={controlStyles.buttonRow}>
          {canPause && (
            <button
              type="button"
              className={controlStyles.secondaryButton}
              disabled={isPending}
              onClick={() =>
                void performAction(
                  () => pauseTask(task.id),
                  () => 'Đã gửi yêu cầu tạm dừng.',
                )
              }
            >
              Tạm dừng
            </button>
          )}
          {canResume && (
            <button
              type="button"
              className={controlStyles.primaryButton}
              disabled={isPending}
              onClick={() =>
                void performAction(
                  () => resumeTask(task.id),
                  () => 'Task tiếp tục.',
                )
              }
            >
              Tiếp tục
            </button>
          )}
          {task !== null && (
            <Link
              href={`/tasks/?task=${encodeURIComponent(task.id)}`}
              className={controlStyles.secondaryButton}
            >
              Mở task
            </Link>
          )}
        </div>
        <StatusNotice outcome={outcome} />
      </div>
      <div role="tablist" aria-label="Xem công việc của agent" className={styles.tabs}>
        {tabs.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={candidate === tab}
            className={styles.tab}
            onClick={() => onSelectTab(candidate)}
          >
            {TAB_LABELS[candidate]}
          </button>
        ))}
      </div>
      <div className={styles.tabBody} role="tabpanel">
        {tab === 'activity' && (
          <ActivityTab agentId={tile.agent.id} revision={revisions.activity} />
        )}
        {tab === 'plan' && <PlanTab agentId={tile.agent.id} revision={revisions.activity} />}
        {tab !== 'activity' && tab !== 'plan' && task === null && (
          <p className={styles.mutedText}>Agent chưa có task nên chưa có thư mục làm việc.</p>
        )}
        {task !== null && tab === 'code' && <FilesTab taskId={task.id} revisions={revisions} />}
        {task !== null && tab === 'diff' && (
          <DiffTab taskId={task.id} revision={revisions.checkpoints} />
        )}
        {task !== null && tab === 'terminal' && (
          <TerminalTab taskId={task.id} revision={revisions.commands} />
        )}
        {task !== null && tab === 'preview' && <PreviewTab taskId={task.id} />}
        {task !== null && tab === 'docs' && <DocsTab taskId={task.id} revisions={revisions} />}
      </div>
    </section>
  );
}
