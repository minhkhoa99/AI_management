'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { AgentTile, TaskDetail } from '@aiteam/contracts';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { useEventStream } from '../../../shared/api/use-event-stream';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { AgentAvatar } from '../../organization/components/agent-identity';
import { loadDepartments } from '../../organization/organization-api';
import { loadTaskDetail } from '../../tasks/tasks-api';
import { ROLE_LABELS } from '../../organization/organization-labels';
import { loadAgentTiles } from '../monitor-api';
import { AgentWorkspace, type WorkspaceTab } from './agent-workspace';
import styles from './monitor.module.css';

const ALL_DEPARTMENTS = 'all';

export const TILE_STATE_PRESENTATION: Record<
  AgentTile['state'],
  { label: string; color: string; background: string }
> = {
  working: { label: 'Đang làm', color: '#86EFAC', background: '#0F2A22' },
  waiting: { label: 'Đang chờ', color: '#FDBA8C', background: '#3A2010' },
  idle: { label: 'Rảnh', color: '#C5D0E3', background: '#1C2438' },
  off: { label: 'Đã tắt', color: '#9AA8C1', background: '#151C2E' },
};

/** /monitor?dept=&agent=&tab= : what every agent is doing, and one agent's workspace. */
export function MonitorScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const departmentFilter = searchParams.get('dept') ?? ALL_DEPARTMENTS;
  const departmentId = departmentFilter === ALL_DEPARTMENTS ? undefined : departmentFilter;
  const departments = useApiQuery('departments', loadDepartments);
  const tiles = useApiQuery(`monitor-tiles:${departmentFilter}`, () =>
    loadAgentTiles(departmentId),
  );
  // ?task= pins one task (link from the task detail), even when the agent now works on another.
  const pinnedTaskId = searchParams.get('task');
  const pinnedTask = useApiQuery(`monitor-pinned-task:${pinnedTaskId ?? ''}`, () =>
    pinnedTaskId === null ? Promise.resolve(null) : loadTaskDetail(pinnedTaskId),
  );
  // A department stream also carries log lines (latest action on each tile).
  useEventStream(
    departmentId === undefined
      ? '/api/stream/workspace'
      : `/api/stream/departments/${encodeURIComponent(departmentId)}`,
    () => tiles.reload(),
  );

  const navigate = (changes: {
    dept?: string;
    agent?: string | null;
    tab?: WorkspaceTab | null;
    task?: null;
  }) => {
    const query = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === undefined || value === ALL_DEPARTMENTS) query.delete(key);
      else query.set(key, value);
    }
    const text = query.toString();
    router.replace(text === '' ? '/monitor/' : `/monitor/?${text}`, { scroll: false });
  };

  if (tiles.status === 'loading' || departments.status === 'loading') {
    return <p className={styles.mutedText}>Đang tải agent…</p>;
  }
  if (tiles.status === 'error') {
    return <StatusNotice outcome={{ tone: 'error', error: tiles.error }} />;
  }
  const departmentList = departments.status === 'success' ? departments.result : [];
  const tileList = tiles.result;
  const selectedAgentId =
    searchParams.get('agent') ?? tileList.find((tile) => tile.state === 'working')?.agent.id;
  const agentTile = tileList.find((tile) => tile.agent.id === selectedAgentId);
  const selectedTile =
    agentTile !== undefined && pinnedTask.status === 'success' && pinnedTask.result !== null
      ? pinTaskOnTile(agentTile, pinnedTask.result)
      : agentTile;
  const counts = (state: AgentTile['state']) =>
    tileList.filter((tile) => tile.state === state).length;

  return (
    <div className={styles.screen}>
      <div className={styles.toolbar}>
        <div role="group" aria-label="Lọc theo phòng" className={styles.pills}>
          {[{ id: ALL_DEPARTMENTS, name: 'Tất cả phòng' }, ...departmentList].map((option) => (
            <button
              key={option.id}
              type="button"
              className={controlStyles.pillButton}
              aria-pressed={departmentFilter === option.id}
              onClick={() => navigate({ dept: option.id, agent: null, task: null })}
            >
              {option.name}
            </button>
          ))}
        </div>
        <div className={styles.counters} aria-label="Số agent theo trạng thái">
          {(Object.keys(TILE_STATE_PRESENTATION) as Array<AgentTile['state']>).map((state) => (
            <span key={state} className={styles.counter}>
              <span
                aria-hidden="true"
                className={styles.counterDot}
                style={{ background: TILE_STATE_PRESENTATION[state].color }}
              />
              {TILE_STATE_PRESENTATION[state].label} <strong>{counts(state)}</strong>
            </span>
          ))}
        </div>
      </div>

      {tileList.length === 0 ? (
        <section className={controlStyles.panel} aria-label="Chưa có agent">
          <h2 className={controlStyles.panelTitle}>Chưa có agent</h2>
          <p className={styles.mutedText}>Thêm thành viên cho phòng ở màn hình Sơ đồ tổ chức.</p>
        </section>
      ) : (
        <section aria-label="Agent đang làm gì" className={styles.tiles}>
          {tileList.map((tile) => (
            <AgentTileButton
              key={tile.agent.id}
              tile={tile}
              selected={tile.agent.id === selectedTile?.agent.id}
              departmentName={
                departmentList.find((department) => department.id === tile.departmentId)?.name ?? ''
              }
              onSelect={() => navigate({ agent: tile.agent.id, tab: null, task: null })}
            />
          ))}
        </section>
      )}

      {selectedTile !== undefined && (
        <AgentWorkspace
          key={`${selectedTile.agent.id}:${selectedTile.task?.id ?? 'none'}`}
          tile={selectedTile}
          requestedTab={searchParams.get('tab')}
          onSelectTab={(tab) => navigate({ tab })}
        />
      )}
    </div>
  );
}

function AgentTileButton({
  tile,
  selected,
  departmentName,
  onSelect,
}: {
  tile: AgentTile;
  selected: boolean;
  departmentName: string;
  onSelect: () => void;
}) {
  const state = TILE_STATE_PRESENTATION[tile.state];
  const progress =
    tile.task?.stepNumber !== null && tile.task !== null && tile.task.stepCount > 0
      ? Math.round(((tile.task.stepNumber ?? 0) / tile.task.stepCount) * 100)
      : null;
  return (
    <button
      type="button"
      className={styles.tile}
      aria-pressed={selected}
      aria-label={`${tile.agent.name}, ${state.label}${tile.task === null ? '' : `, ${tile.task.code}`}`}
      onClick={onSelect}
    >
      <span className={styles.tileHeader}>
        <AgentAvatar
          name={tile.agent.name}
          provider={tile.agent.provider}
          available={tile.agent.available}
          size={32}
        />
        <span className={styles.tileName}>
          <span className={styles.tileTitle}>{tile.agent.name}</span>
          <span className={styles.tileMeta}>
            {ROLE_LABELS[tile.agent.role]} · {departmentName}
          </span>
        </span>
        <span
          className={styles.stateChip}
          style={{ background: state.background, color: state.color }}
        >
          {state.label}
        </span>
      </span>
      <span className={styles.tileTask}>
        {tile.task === null ? 'Chưa có task' : `${tile.task.code} · ${tile.task.title}`}
      </span>
      {tile.lastActivity !== null && (
        <span className={styles.tileNow}>{tile.lastActivity.text}</span>
      )}
      {progress !== null && tile.task !== null && (
        <span className={styles.tileMeta}>
          <span className={styles.progressTrack} aria-hidden="true" style={{ display: 'block' }}>
            <span
              className={styles.progressFill}
              style={{ display: 'block', width: `${progress}%` }}
            />
          </span>
          Bước {tile.task.stepNumber}/{tile.task.stepCount}: {tile.task.stepName}
        </span>
      )}
    </button>
  );
}

/** The tile of an agent, showing the given task instead of the one it works on now. */
function pinTaskOnTile(tile: AgentTile, task: TaskDetail): AgentTile {
  if (tile.task?.id === task.id) return tile;
  const stepIndex = task.workflowSteps.findIndex((step) => step.id === task.currentStep?.id);
  return {
    ...tile,
    task: {
      id: task.id,
      code: task.code,
      title: task.title,
      status: task.status,
      boardColumn: task.boardColumn,
      stepName: task.currentStep?.name ?? null,
      stepNumber: stepIndex === -1 ? null : stepIndex + 1,
      stepCount: task.workflowSteps.length,
      workingDirectory: task.workingDirectory,
    },
  };
}
