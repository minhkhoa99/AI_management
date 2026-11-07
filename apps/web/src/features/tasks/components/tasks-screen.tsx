'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { Department, TaskSummary } from '@aiteam/contracts';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { useReloadWhile } from '../../../shared/api/use-polling';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { StrokeIcon } from '../../../shared/ui/stroke-icon';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { loadDepartments } from '../../organization/organization-api';
import { isTaskActive } from '../task-labels';
import { deleteTask, loadTasks, moveTaskStage } from '../tasks-api';
import { TaskBoard } from './task-board';
import { TaskDetailPanel } from './task-detail-panel';
import { TaskFormPanel } from './task-form-panel';
import styles from './tasks.module.css';

const PLUS_ICON = 'M12 5v14M5 12h14';
const ALL_DEPARTMENTS = 'all';
const BOARD_REFRESH_MS = 3_000;

interface TasksRoute {
  departmentFilter: string;
  taskId: string | null;
  creating: boolean;
}

function buildTasksHref(route: TasksRoute): string {
  const query = new URLSearchParams();
  if (route.departmentFilter !== ALL_DEPARTMENTS) query.set('dept', route.departmentFilter);
  if (route.taskId !== null) query.set('task', route.taskId);
  if (route.creating) query.set('new', '1');
  const text = query.toString();
  return text === '' ? '/tasks/' : `/tasks/?${text}`;
}

/** /tasks?dept=&task=&new=1 : kanban board, task form, task detail and deletion. */
export function TasksScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const departments = useApiQuery('departments', loadDepartments);
  const tasks = useApiQuery('tasks', () => loadTasks());
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<TaskSummary | null>(null);
  const boardAction = useActionOutcome();
  const anyTaskActive =
    tasks.status === 'success' && tasks.result.some((task) => isTaskActive(task.status));
  useReloadWhile(anyTaskActive, tasks.reload, BOARD_REFRESH_MS);

  const route: TasksRoute = {
    departmentFilter: searchParams.get('dept') ?? ALL_DEPARTMENTS,
    taskId: searchParams.get('task'),
    creating: searchParams.get('new') === '1',
  };
  const navigate = (changes: Partial<TasksRoute>) =>
    router.replace(buildTasksHref({ ...route, ...changes }), { scroll: false });

  if (departments.status === 'loading' || tasks.status === 'loading') {
    return <p className={styles.mutedText}>Đang tải task…</p>;
  }
  if (departments.status === 'error') {
    return <StatusNotice outcome={{ tone: 'error', error: departments.error }} />;
  }
  if (tasks.status === 'error') {
    return <StatusNotice outcome={{ tone: 'error', error: tasks.error }} />;
  }

  const departmentList = departments.result;
  const searchText = (searchParams.get('q') ?? '').toLocaleLowerCase('vi');
  const visibleTasks = tasks.result.filter(
    (task) =>
      (route.departmentFilter === ALL_DEPARTMENTS ||
        task.departmentId === route.departmentFilter) &&
      (searchText === '' ||
        [task.title, task.code, task.assignee?.name ?? ''].some((text) =>
          text.toLocaleLowerCase('vi').includes(searchText),
        )),
  );
  const preferredDepartment = departmentList.find(
    (department) => department.id === route.departmentFilter,
  );

  return (
    <div className={styles.screen}>
      <div className={styles.toolbar}>
        <div role="group" aria-label="Lọc task theo phòng" className={styles.filterPills}>
          {[{ id: ALL_DEPARTMENTS, name: 'Tất cả phòng' }, ...departmentList].map((option) => (
            <button
              key={option.id}
              type="button"
              className={controlStyles.pillButton}
              aria-pressed={route.departmentFilter === option.id}
              onClick={() => navigate({ departmentFilter: option.id })}
            >
              {option.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={controlStyles.primaryButton}
          disabled={departmentList.length === 0}
          onClick={() => {
            setEditingTaskId(null);
            navigate({ creating: true, taskId: null });
          }}
        >
          <StrokeIcon path={PLUS_ICON} size={16} strokeWidth={2.2} /> Tạo task
        </button>
      </div>

      {departmentList.length === 0 && (
        <section className={controlStyles.panel} aria-label="Chưa có phòng ban">
          <h2 className={controlStyles.panelTitle}>Chưa có phòng ban</h2>
          <p className={styles.mutedText}>
            Task thuộc về một phòng ban. Tạo phòng ban và thêm trưởng phòng ở màn hình Sơ đồ tổ chức
            trước.
          </p>
        </section>
      )}

      {(route.creating || editingTaskId !== null) && departmentList.length > 0 && (
        <TaskFormPanel
          key={editingTaskId ?? 'new'}
          departments={departmentList}
          preferredDepartment={preferredDepartment ?? firstEnabled(departmentList)}
          editedTaskId={editingTaskId}
          onSaved={(saved) => {
            setEditingTaskId(null);
            navigate({ creating: false, taskId: saved.id });
          }}
          onCancel={() => {
            setEditingTaskId(null);
            navigate({ creating: false });
          }}
        />
      )}

      {pendingDeletion !== null && (
        <DeleteTaskConfirmation
          task={pendingDeletion}
          onDone={(deletedTaskId) => {
            setPendingDeletion(null);
            if (deletedTaskId === route.taskId) navigate({ taskId: null });
          }}
          onCancel={() => setPendingDeletion(null)}
        />
      )}

      {route.taskId !== null && (
        <TaskDetailPanel
          key={route.taskId}
          taskId={route.taskId}
          departments={departmentList}
          onEdit={() => {
            setEditingTaskId(route.taskId);
            navigate({ creating: false });
          }}
          onDelete={(task) => setPendingDeletion(task)}
          onClose={() => navigate({ taskId: null })}
        />
      )}

      <StatusNotice outcome={boardAction.outcome} />
      <TaskBoard
        tasks={visibleTasks}
        departments={departmentList}
        selectedTaskId={route.taskId}
        onOpenTask={(taskId) => navigate({ taskId, creating: false })}
        onEditTask={(taskId) => {
          setEditingTaskId(taskId);
          navigate({ creating: false });
        }}
        onDeleteTask={(task) => setPendingDeletion(task)}
        onMoveTask={(task, direction) =>
          void boardAction.performAction(
            () => moveTaskStage(task.id, direction),
            () => null,
          )
        }
      />
    </div>
  );
}

function firstEnabled(departments: readonly Department[]): Department | undefined {
  return departments.find((department) => department.enabled) ?? departments[0];
}

function DeleteTaskConfirmation({
  task,
  onDone,
  onCancel,
}: {
  task: TaskSummary;
  onDone: (deletedTaskId: string) => void;
  onCancel: () => void;
}) {
  const { outcome, isPending, performAction } = useActionOutcome();
  const assigneeName = task.assignee?.name ?? 'agent phụ trách';
  const stopsAgent = task.status !== 'queued' && task.boardColumn !== 'done';
  return (
    <section role="alertdialog" aria-label="Xác nhận xoá task" className={styles.confirmBox}>
      <h2 className={controlStyles.panelTitle}>
        Xoá task {task.code}: {task.title}?
      </h2>
      <p className={styles.mutedText}>
        {!stopsAgent
          ? 'Task chưa chạy hoặc đã kết thúc nên được xoá ngay, cùng tài liệu QA của nó.'
          : `Nền tảng gửi tín hiệu huỷ tới ${assigneeName}. Agent dừng lệnh đang chạy, giữ nhánh làm việc rồi task mới bị xoá.`}
      </p>
      <StatusNotice outcome={outcome} />
      <div className={controlStyles.buttonRow}>
        <button
          type="button"
          className={controlStyles.dangerButton}
          disabled={isPending}
          onClick={() =>
            void performAction(
              () => deleteTask(task.id),
              (deletion) => {
                onDone(deletion.taskId);
                return null;
              },
            )
          }
        >
          {stopsAgent ? 'Xoá và gửi tín hiệu huỷ' : 'Xoá task'}
        </button>
        <button type="button" className={controlStyles.secondaryButton} onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </section>
  );
}
