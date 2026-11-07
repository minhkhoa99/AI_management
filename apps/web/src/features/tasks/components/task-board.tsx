import { TASK_BOARD_COLUMNS, type Department, type TaskSummary } from '@aiteam/contracts';
import { StrokeIcon } from '../../../shared/ui/stroke-icon';
import { AgentAvatar } from '../../organization/components/agent-identity';
import { ROLE_LABELS } from '../../organization/organization-labels';
import {
  BOARD_COLUMN_PRESENTATION,
  PRIORITY_PRESENTATION,
  shortenDirectory,
  STATUS_NOTES,
} from '../task-labels';
import styles from './tasks.module.css';

const EDIT_ICON = 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 6.5l3 3';
const LEFT_ICON = 'M15 6l-6 6 6 6';
const RIGHT_ICON = 'M9 6l6 6-6 6';
const DELETE_ICON = 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3';

interface TaskBoardProps {
  tasks: readonly TaskSummary[];
  departments: readonly Department[];
  selectedTaskId: string | null;
  onOpenTask: (taskId: string) => void;
  onEditTask: (taskId: string) => void;
  onDeleteTask: (task: TaskSummary) => void;
  onMoveTask: (task: TaskSummary, direction: 'back' | 'forward') => void;
}

/** Kanban: "Cần làm", "Đang làm", "QC đang kiểm", "Hoàn thành". */
export function TaskBoard({
  tasks,
  departments,
  selectedTaskId,
  onOpenTask,
  onEditTask,
  onDeleteTask,
  onMoveTask,
}: TaskBoardProps) {
  const departmentById = new Map(departments.map((department) => [department.id, department]));
  return (
    <section aria-label="Bảng task" className={styles.board}>
      {TASK_BOARD_COLUMNS.map((column) => {
        const presentation = BOARD_COLUMN_PRESENTATION[column];
        const columnTasks = tasks.filter((task) => task.boardColumn === column);
        return (
          <div key={column} className={styles.column}>
            <div className={styles.columnHeader}>
              <span className={styles.columnLabel}>
                <span
                  aria-hidden="true"
                  className={styles.columnDot}
                  style={{ background: presentation.color }}
                />
                {presentation.label}
              </span>
              <span className={styles.columnCount}>{columnTasks.length}</span>
            </div>
            {columnTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                department={departmentById.get(task.departmentId)}
                selected={task.id === selectedTaskId}
                onOpen={() => onOpenTask(task.id)}
                onEdit={() => onEditTask(task.id)}
                onDelete={() => onDeleteTask(task)}
                onMove={(direction) => onMoveTask(task, direction)}
              />
            ))}
            {columnTasks.length === 0 && (
              <p className={styles.emptyColumn}>Không có task ở giai đoạn này.</p>
            )}
          </div>
        );
      })}
    </section>
  );
}

function TaskCard({
  task,
  department,
  selected,
  onOpen,
  onEdit,
  onDelete,
  onMove,
}: {
  task: TaskSummary;
  department: Department | undefined;
  selected: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (direction: 'back' | 'forward') => void;
}) {
  const priority = PRIORITY_PRESENTATION[task.priority];
  const statusNote = task.statusNote ?? STATUS_NOTES[task.status];
  // Arrows move a workflow task between steps while nobody works on it (server checks rules).
  const movable =
    task.currentStep !== null && (task.status === 'queued' || task.status === 'failed');
  return (
    <article className={selected ? `${styles.card} ${styles.cardSelected}` : styles.card}>
      <div className={styles.cardTitleRow}>
        <button
          type="button"
          className={styles.cardTitle}
          aria-label={`Mở chi tiết ${task.code}: ${task.title}`}
          onClick={onOpen}
        >
          {task.title}
        </button>
        <span
          className={styles.chip}
          style={{ background: priority.background, color: priority.foreground }}
        >
          {priority.label}
        </span>
      </div>
      <div className={styles.cardMeta}>
        <span
          aria-hidden="true"
          className={styles.departmentDot}
          style={{ background: department?.color ?? '#5B6782' }}
        />
        {department?.name ?? 'Phòng đã xoá'} · {task.code}
        {task.currentStep !== null && ` · ${task.currentStep.name}`}
      </div>
      <div className={styles.cardChips}>
        {task.workingDirectory !== null && (
          <span className={styles.directoryChip} title={task.workingDirectory}>
            {shortenDirectory(task.workingDirectory)}
          </span>
        )}
        {task.attachmentCount > 0 ? (
          <span className={`${styles.goalChip} ${styles.goalChipQa}`}>
            QA · {task.attachmentCount} file
          </span>
        ) : (
          <span className={`${styles.goalChip} ${styles.goalChipDescription}`}>
            Đích: mô tả + tiêu chí
          </span>
        )}
      </div>
      {statusNote !== undefined && (
        <span role="status" className={styles.statusNote}>
          {statusNote}
        </span>
      )}
      <div className={styles.cardFooter}>
        <span className={styles.assignee}>
          {task.assignee === null ? (
            'Chưa có người nhận'
          ) : (
            <>
              <AgentAvatar
                name={task.assignee.name}
                provider={task.assignee.provider}
                available={task.assignee.available}
                size={24}
              />
              {task.assignee.name} · {ROLE_LABELS[task.assignee.role]}
            </>
          )}
        </span>
        <span className={styles.cardActions}>
          {movable && (
            <>
              <button
                type="button"
                className={styles.iconAction}
                aria-label={`Đưa ${task.code} về bước trước`}
                onClick={() => onMove('back')}
              >
                <StrokeIcon path={LEFT_ICON} size={15} />
              </button>
              <button
                type="button"
                className={styles.iconAction}
                aria-label={`Cho ${task.code} qua bước hiện tại`}
                onClick={() => onMove('forward')}
              >
                <StrokeIcon path={RIGHT_ICON} size={15} />
              </button>
            </>
          )}
          <button
            type="button"
            className={styles.iconAction}
            aria-label={`Sửa ${task.code}`}
            onClick={onEdit}
          >
            <StrokeIcon path={EDIT_ICON} size={15} />
          </button>
          <button
            type="button"
            className={`${styles.iconAction} ${styles.iconActionDanger}`}
            aria-label={`Xoá ${task.code}`}
            onClick={onDelete}
          >
            <StrokeIcon path={DELETE_ICON} size={15} />
          </button>
        </span>
      </div>
    </article>
  );
}
