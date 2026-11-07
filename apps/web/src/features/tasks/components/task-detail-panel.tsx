'use client';

import { useEffect, useState } from 'react';
import type { Department, TaskDetail, TaskSummary } from '@aiteam/contracts';
import { ApiRequestError } from '../../../shared/api/api-client';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { useEventStream } from '../../../shared/api/use-event-stream';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { AgentAvatar } from '../../organization/components/agent-identity';
import { ROLE_LABELS } from '../../organization/organization-labels';
import { GATE_PRESENTATION } from '../../workflows/workflow-labels';
import {
  BOARD_COLUMN_PRESENTATION,
  formatFileSize,
  PRIORITY_PRESENTATION,
  STATUS_NOTES,
} from '../task-labels';
import {
  autoDelegateTask,
  delegateTask,
  loadPendingApprovals,
  loadTaskDetail,
  loadTaskEvents,
  retryTask,
} from '../tasks-api';
import { ApprovalActions } from './approval-actions';
import { CompletionGoalBox } from './completion-goal-box';
import styles from './tasks.module.css';

interface TaskDetailPanelProps {
  taskId: string;
  departments: readonly Department[];
  onEdit: () => void;
  onDelete: (task: TaskSummary) => void;
  onClose: () => void;
}

/** "Chi tiết task": goal, steps, delegation, approval, log. Refreshes while agents work. */
export function TaskDetailPanel({
  taskId,
  departments,
  onEdit,
  onDelete,
  onClose,
}: TaskDetailPanelProps) {
  const task = useApiQuery(`task:${taskId}`, () => loadTaskDetail(taskId));
  const [logRevision, setLogRevision] = useState(0);
  // One stream for the whole panel: status changes reload the detail, new lines the log.
  useEventStream(`/api/stream/tasks/${encodeURIComponent(taskId)}`, (updates) => {
    if (updates.some((update) => update.type !== 'task.event')) task.reload();
    if (updates.some((update) => update.type === 'task.event')) {
      setLogRevision((revision) => revision + 1);
    }
  });

  if (task.status === 'loading') {
    return <p className={styles.mutedText}>Đang tải task…</p>;
  }
  if (task.status === 'error') {
    // Just deleted: the panel closes on the next navigation, nothing to report.
    if (task.error instanceof ApiRequestError && task.error.httpStatus === 404) return null;
    return <StatusNotice outcome={{ tone: 'error', error: task.error }} />;
  }

  const detail = task.result;
  const priority = PRIORITY_PRESENTATION[detail.priority];
  const department = departments.find((candidate) => candidate.id === detail.departmentId);
  const statusNote = detail.statusNote ?? STATUS_NOTES[detail.status];

  return (
    <section aria-label="Chi tiết task" className={controlStyles.panel}>
      <div className={styles.detailLayout}>
        <div className={styles.formStack}>
          <span className={styles.detailHeader}>
            <span className={styles.code}>{detail.code}</span>
            <span
              className={styles.chip}
              style={{ background: priority.background, color: priority.foreground }}
            >
              {priority.label}
            </span>
            <span className={styles.chip} style={{ background: '#1C2438', color: '#C5D0E3' }}>
              {BOARD_COLUMN_PRESENTATION[detail.boardColumn].label}
            </span>
          </span>
          <h2 className={styles.detailTitle}>{detail.title}</h2>
          {statusNote !== undefined && (
            <span role="status" className={styles.statusNote}>
              {statusNote}
            </span>
          )}
          {detail.description !== '' && <p className={styles.detailText}>{detail.description}</p>}
          <span className={styles.mutedText}>
            {department?.name ?? 'Phòng đã xoá'} ·{' '}
            {detail.workflow === null
              ? 'không theo quy trình'
              : `quy trình “${detail.workflow.name}”`}
          </span>
          {detail.workflowSteps.length > 0 && <StepProgress detail={detail} />}
          <div className={styles.facts}>
            <div className={styles.fact}>
              <span className={styles.factLabel}>Thư mục làm việc</span>
              <span className={styles.monoValue}>
                {detail.workingDirectory ?? 'Nền tảng tạo thư mục riêng khi task bắt đầu'}
              </span>
            </div>
            <div className={styles.fact}>
              <span className={styles.factLabel}>Tài liệu QA</span>
              {detail.attachments.length === 0 ? (
                <span className={styles.factValue}>Không có</span>
              ) : (
                detail.attachments.map((attachment) => (
                  <span key={attachment.id} className={styles.factValue}>
                    {attachment.fileName} · {formatFileSize(attachment.size)}
                    {attachment.detectedCases ? ` · ${attachment.detectedCases} kịch bản` : ''}
                  </span>
                ))
              )}
            </div>
            {detail.testCommand !== null && (
              <div className={styles.fact}>
                <span className={styles.factLabel}>Lệnh kiểm thử</span>
                <span className={styles.monoValue}>{detail.testCommand}</span>
              </div>
            )}
          </div>
          {detail.pendingApprovalId !== null && (
            <PendingApproval approvalId={detail.pendingApprovalId} />
          )}
          <DelegationControls detail={detail} />
          <TaskActions detail={detail} onEdit={onEdit} onDelete={onDelete} onClose={onClose} />
        </div>

        <div className={styles.formStack}>
          <CompletionGoalBox goal={detail.completionGoal} showItems />
          <DelegationChain detail={detail} />
          <TaskLog taskId={detail.id} revision={logRevision} />
        </div>
      </div>
    </section>
  );
}

function StepProgress({ detail }: { detail: TaskDetail }) {
  const currentIndex = detail.workflowSteps.findIndex((step) => step.id === detail.currentStep?.id);
  return (
    <ol className={styles.stepProgress} aria-label="Tiến độ theo quy trình">
      {detail.workflowSteps.map((step, index) => {
        const progress =
          detail.status === 'succeeded' || index < currentIndex
            ? styles.stepDone
            : index === currentIndex
              ? styles.stepCurrent
              : '';
        return (
          <li
            key={step.id}
            className={`${styles.stepProgressItem} ${progress ?? ''}`}
            title={GATE_PRESENTATION[step.gate].label}
            aria-current={index === currentIndex ? 'step' : undefined}
          >
            {index + 1}. {step.name}
          </li>
        );
      })}
    </ol>
  );
}

function PendingApproval({ approvalId }: { approvalId: string }) {
  const approvals = useApiQuery('approvals:pending', loadPendingApprovals);
  const approval =
    approvals.status === 'success'
      ? approvals.result.find((candidate) => candidate.id === approvalId)
      : undefined;
  return approval === undefined ? null : <ApprovalActions approval={approval} />;
}

function DelegationControls({ detail }: { detail: TaskDetail }) {
  const [targetId, setTargetId] = useState('');
  const { outcome, isPending, performAction } = useActionOutcome();
  const assigneeName = detail.assignee?.name ?? 'Người nhận';
  if (!['queued', 'waiting_approval', 'failed'].includes(detail.status)) return null;
  if (detail.delegationTargets.length === 0) {
    return (
      <p className={styles.hint}>
        {assigneeName} không có cấp dưới đang bật nên tự thực hiện task này.
      </p>
    );
  }
  const chosenId = targetId === '' ? (detail.delegationTargets[0]?.id ?? '') : targetId;
  return (
    <div className={styles.subPanel}>
      <span className={styles.subPanelTitle}>{assigneeName} giao xuống cấp dưới</span>
      <div className={styles.directoryRow}>
        <label className={`${controlStyles.field} ${styles.directoryField}`}>
          Chọn cấp dưới
          <select
            value={chosenId}
            onChange={(event) => setTargetId(event.target.value)}
            className={controlStyles.fieldInput}
          >
            {detail.delegationTargets.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {ROLE_LABELS[agent.role]} – {agent.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={controlStyles.primaryButton}
          disabled={isPending}
          onClick={() =>
            void performAction(
              () => delegateTask(detail.id, chosenId),
              () => null,
            )
          }
        >
          Giao
        </button>
        <button
          type="button"
          className={controlStyles.secondaryButton}
          disabled={isPending}
          onClick={() =>
            void performAction(
              () => autoDelegateTask(detail.id),
              () => null,
            )
          }
        >
          Để {assigneeName} tự giao
        </button>
      </div>
      <StatusNotice outcome={outcome} />
    </div>
  );
}

function TaskActions({
  detail,
  onEdit,
  onDelete,
  onClose,
}: {
  detail: TaskDetail;
  onEdit: () => void;
  onDelete: (task: TaskSummary) => void;
  onClose: () => void;
}) {
  const { outcome, isPending, performAction } = useActionOutcome();
  return (
    <>
      <StatusNotice outcome={outcome} />
      <div className={controlStyles.buttonRow}>
        {detail.status === 'failed' && (
          <button
            type="button"
            className={controlStyles.primaryButton}
            disabled={isPending}
            onClick={() =>
              void performAction(
                () => retryTask(detail.id),
                () => 'Đã cho chạy lại.',
              )
            }
          >
            Chạy lại
          </button>
        )}
        <button type="button" className={controlStyles.secondaryButton} onClick={onEdit}>
          Sửa task
        </button>
        <button
          type="button"
          className={controlStyles.dangerButton}
          disabled={detail.status === 'cancelling'}
          onClick={() => onDelete(detail)}
        >
          Xoá task
        </button>
        <button type="button" className={controlStyles.secondaryButton} onClick={onClose}>
          Đóng
        </button>
      </div>
    </>
  );
}

/** Who handed the task to whom; before any handover, the reporting line to the assignee. */
function DelegationChain({ detail }: { detail: TaskDetail }) {
  const names =
    detail.delegations.length === 0
      ? detail.assigneeChain.map((agent) => agent.name)
      : [
          detail.delegations[0]?.fromAgentName ?? '—',
          ...detail.delegations.map((delegation) => delegation.toAgentName ?? '—'),
        ];
  const knownAgents = new Map(
    [...detail.assigneeChain, ...detail.delegationTargets].map((agent) => [agent.name, agent]),
  );
  if (detail.assignee !== null) knownAgents.set(detail.assignee.name, detail.assignee);
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>Chuỗi giao việc</span>
      {names.length === 0 ? (
        <span className={styles.factValue}>Chưa có người nhận</span>
      ) : (
        <ol className={styles.chain}>
          {names.map((name, index) => {
            const agent = knownAgents.get(name);
            return (
              <li key={`${name}-${index}`} className={styles.chainNode}>
                {index > 0 && (
                  <span aria-hidden="true" className={styles.chainArrow}>
                    →
                  </span>
                )}
                {agent !== undefined && (
                  <AgentAvatar
                    name={agent.name}
                    provider={agent.provider}
                    available={agent.available}
                    size={24}
                  />
                )}
                {name}
                {agent === undefined ? '' : ` · ${ROLE_LABELS[agent.role]}`}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function TaskLog({ taskId, revision }: { taskId: string; revision: number }) {
  const events = useApiQuery(`task-events:${taskId}`, () => loadTaskEvents(taskId));
  const reloadEvents = events.reload;
  useEffect(() => {
    if (revision > 0) reloadEvents();
  }, [revision, reloadEvents]);
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>Nhật ký task</span>
      {events.status === 'error' && (
        <StatusNotice outcome={{ tone: 'error', error: events.error }} />
      )}
      {events.status === 'success' && events.result.length === 0 && (
        <span className={styles.factValue}>Chưa có hoạt động.</span>
      )}
      {events.status === 'success' && events.result.length > 0 && (
        <ol className={styles.taskLog}>
          {events.result.map((event) => (
            <li key={event.id} className={styles.taskLogItem}>
              <span>
                {event.agentName !== null && (
                  <span className={styles.taskLogAgent}>{event.agentName} </span>
                )}
                {event.text}
              </span>
              <time className={styles.taskLogTime} dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleTimeString('vi')}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
