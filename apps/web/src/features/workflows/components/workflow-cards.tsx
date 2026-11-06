'use client';

import { useState } from 'react';
import type { Workflow } from '@aiteam/contracts';
import { StrokeIcon } from '../../../shared/ui/stroke-icon';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { deleteWorkflow, duplicateWorkflow, setDefaultWorkflow } from '../workflows-api';
import styles from './workflows.module.css';

const PLUS_ICON = 'M12 5v14M5 12h14';

interface WorkflowCardsProps {
  workflows: readonly Workflow[];
  selectedWorkflowId: string | undefined;
  unsavedWorkflowIds: readonly string[];
  onSelectWorkflow: (workflowId: string) => void;
  onEditWorkflow: (workflowId: string) => void;
  onCreateWorkflow: () => void;
  onWorkflowCreated: (created: Workflow) => void;
  onWorkflowDeleted: (workflowId: string) => void;
}

function describeUsage(workflow: Workflow): string {
  const usage =
    workflow.taskCount === 0 ? 'chưa có task nào' : `đang dùng cho ${workflow.taskCount} task`;
  return `${workflow.steps.length} bước · ${usage}`;
}

/** "Danh sách quy trình": one card per workflow with its actions. */
export function WorkflowCards({
  workflows,
  selectedWorkflowId,
  unsavedWorkflowIds,
  onSelectWorkflow,
  onEditWorkflow,
  onCreateWorkflow,
  onWorkflowCreated,
  onWorkflowDeleted,
}: WorkflowCardsProps) {
  const { outcome, isPending, performAction } = useActionOutcome();
  const [pendingDeletion, setPendingDeletion] = useState<Workflow | null>(null);

  const confirmDeletion = async (workflow: Workflow) => {
    const deleted = await performAction(
      () => deleteWorkflow(workflow.id).then(() => true),
      () => `Đã xoá quy trình ${workflow.name}.`,
    );
    if (deleted === true) {
      setPendingDeletion(null);
      onWorkflowDeleted(workflow.id);
    }
  };

  return (
    <>
      <section aria-label="Danh sách quy trình" className={styles.cardGrid}>
        {workflows.map((workflow) => {
          const selected = workflow.id === selectedWorkflowId;
          return (
            <div
              key={workflow.id}
              className={selected ? `${styles.card} ${styles.cardSelected}` : styles.card}
            >
              <button
                type="button"
                className={styles.cardPick}
                aria-pressed={selected}
                aria-label={`Xem các bước của ${workflow.name}`}
                onClick={() => onSelectWorkflow(workflow.id)}
              >
                <span className={styles.cardTitleRow}>
                  <span className={styles.cardName}>{workflow.name}</span>
                  {workflow.isDefault && (
                    <span className={`${styles.chip} ${styles.chipDefault}`}>Mặc định</span>
                  )}
                  {!workflow.enforce && (
                    <span className={`${styles.chip} ${styles.chipLoose}`}>Không bắt buộc</span>
                  )}
                  {unsavedWorkflowIds.includes(workflow.id) && (
                    <span className={`${styles.chip} ${styles.chipUnsaved}`}>Chưa lưu</span>
                  )}
                </span>
                {workflow.description !== '' && (
                  <span className={styles.cardDescription}>{workflow.description}</span>
                )}
                <span className={styles.cardMeta}>{describeUsage(workflow)}</span>
              </button>
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.cardAction}
                  aria-label={`Sửa tên và mô tả ${workflow.name}`}
                  onClick={() => onEditWorkflow(workflow.id)}
                >
                  Sửa
                </button>
                <button
                  type="button"
                  className={styles.cardAction}
                  aria-label={`Nhân bản ${workflow.name}`}
                  disabled={isPending}
                  onClick={() =>
                    void performAction(
                      () => duplicateWorkflow(workflow.id),
                      (copy) => {
                        onWorkflowCreated(copy);
                        return `Đã tạo ${copy.name}.`;
                      },
                    )
                  }
                >
                  Nhân bản
                </button>
                {!workflow.isDefault && (
                  <button
                    type="button"
                    className={styles.cardAction}
                    disabled={isPending}
                    onClick={() =>
                      void performAction(
                        () => setDefaultWorkflow(workflow.departmentId, workflow.id),
                        () => `${workflow.name} là quy trình mặc định của phòng.`,
                      )
                    }
                  >
                    Đặt mặc định
                  </button>
                )}
                <button
                  type="button"
                  className={styles.cardDeleteAction}
                  aria-label={`Xoá ${workflow.name}`}
                  onClick={() => setPendingDeletion(workflow)}
                >
                  Xoá
                </button>
              </div>
            </div>
          );
        })}
        <button type="button" className={styles.newWorkflowCard} onClick={onCreateWorkflow}>
          <StrokeIcon path={PLUS_ICON} size={18} strokeWidth={2} />
          Tạo quy trình mới
        </button>
      </section>

      {pendingDeletion !== null && (
        <section
          role="alertdialog"
          aria-label="Xác nhận xoá quy trình"
          className={styles.confirmBox}
        >
          <h2 className={controlStyles.panelTitle}>Xoá quy trình {pendingDeletion.name}?</h2>
          <p className={styles.mutedText}>
            {workflows.length <= 1
              ? 'Đây là quy trình cuối cùng của phòng nên không xoá được.'
              : 'Task đã xong của quy trình này chuyển sang quy trình mặc định. Không xoá được khi còn task chưa xong dùng nó.'}
          </p>
          <div className={controlStyles.buttonRow}>
            {workflows.length > 1 && (
              <button
                type="button"
                className={controlStyles.dangerButton}
                disabled={isPending}
                onClick={() => void confirmDeletion(pendingDeletion)}
              >
                Xoá quy trình
              </button>
            )}
            <button
              type="button"
              className={controlStyles.secondaryButton}
              onClick={() => setPendingDeletion(null)}
            >
              {workflows.length <= 1 ? 'Đóng' : 'Huỷ'}
            </button>
          </div>
        </section>
      )}
      <StatusNotice outcome={outcome} />
    </>
  );
}
