'use client';

import type { Department, TaskSummary } from '@aiteam/contracts';
import { ApiRequestError } from '../../../shared/api/api-client';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { AgentAvatar } from '../../organization/components/agent-identity';
import { ROLE_LABELS } from '../../organization/organization-labels';
import {
  BOARD_COLUMN_PRESENTATION,
  formatFileSize,
  PRIORITY_PRESENTATION,
  STATUS_NOTES,
} from '../task-labels';
import { loadTaskDetail } from '../tasks-api';
import { CompletionGoalBox } from './completion-goal-box';
import styles from './tasks.module.css';

interface TaskDetailPanelProps {
  taskId: string;
  departments: readonly Department[];
  onEdit: () => void;
  onDelete: (task: TaskSummary) => void;
  onClose: () => void;
}

/** "Chi tiết task": what to do, where, the completion goal and the reporting chain. */
export function TaskDetailPanel({
  taskId,
  departments,
  onEdit,
  onDelete,
  onClose,
}: TaskDetailPanelProps) {
  const task = useApiQuery(`task:${taskId}`, () => loadTaskDetail(taskId));

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
  const statusNote = STATUS_NOTES[detail.status];

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
            {statusNote !== undefined && <span className={styles.statusNote}>{statusNote}</span>}
          </span>
          <h2 className={styles.detailTitle}>{detail.title}</h2>
          {detail.description !== '' && <p className={styles.detailText}>{detail.description}</p>}
          <span className={styles.mutedText}>
            {department?.name ?? 'Phòng đã xoá'} ·{' '}
            {detail.workflow === null
              ? 'không theo quy trình'
              : `quy trình “${detail.workflow.name}”`}
            {detail.currentStep !== null && ` · đang ở bước “${detail.currentStep.name}”`}
          </span>
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
          <div className={controlStyles.buttonRow}>
            <button type="button" className={controlStyles.secondaryButton} onClick={onEdit}>
              Sửa task
            </button>
            <button
              type="button"
              className={controlStyles.dangerButton}
              onClick={() => onDelete(detail)}
            >
              Xoá task
            </button>
            <button type="button" className={controlStyles.secondaryButton} onClick={onClose}>
              Đóng
            </button>
          </div>
        </div>

        <div className={styles.formStack}>
          <CompletionGoalBox goal={detail.completionGoal} showItems />
          <div className={styles.fact}>
            <span className={styles.factLabel}>Chuỗi giao việc</span>
            {detail.assigneeChain.length === 0 ? (
              <span className={styles.factValue}>Chưa có người nhận</span>
            ) : (
              <ol className={styles.chain}>
                {detail.assigneeChain.map((agent, index) => (
                  <li key={agent.id} className={styles.chainNode}>
                    {index > 0 && (
                      <span aria-hidden="true" className={styles.chainArrow}>
                        →
                      </span>
                    )}
                    <AgentAvatar
                      name={agent.name}
                      provider={agent.provider}
                      available={agent.available}
                      size={24}
                    />
                    {agent.name} · {ROLE_LABELS[agent.role]}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
