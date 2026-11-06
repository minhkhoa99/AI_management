'use client';

import { type FormEvent, useState } from 'react';
import {
  createWorkflowRequestSchema,
  updateWorkflowRequestSchema,
  type Workflow,
  type WorkflowSource,
  type WorkflowTemplate,
  workflowTemplateIdSchema,
} from '@aiteam/contracts';
import { controlStyles, InlinePanel, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { createWorkflow, updateWorkflow } from '../workflows-api';
import styles from './workflows.module.css';

interface WorkflowFormPanelProps {
  departmentId: string;
  departmentName: string;
  /** Present when renaming; absent when creating. */
  editedWorkflow?: Workflow | undefined;
  /** Offered as "Sao chép …" when creating. */
  copyableWorkflow?: Workflow | undefined;
  templates: readonly WorkflowTemplate[];
  onSaved: (saved: Workflow) => void;
  onCancel: () => void;
}

const BLANK_SOURCE = 'blank';
const COPY_SOURCE = 'copy';

function toWorkflowSource(choice: string, copyableWorkflowId: string | undefined): WorkflowSource {
  if (choice === COPY_SOURCE && copyableWorkflowId !== undefined) {
    return { kind: 'copy', workflowId: copyableWorkflowId };
  }
  const templateId = workflowTemplateIdSchema.safeParse(choice);
  return templateId.success ? { kind: 'template', templateId: templateId.data } : { kind: 'blank' };
}

/** Create (blank / template / copy) or rename a workflow. */
export function WorkflowFormPanel({
  departmentId,
  departmentName,
  editedWorkflow,
  copyableWorkflow,
  templates,
  onSaved,
  onCancel,
}: WorkflowFormPanelProps) {
  const [name, setName] = useState(editedWorkflow?.name ?? '');
  const [description, setDescription] = useState(editedWorkflow?.description ?? '');
  const [sourceChoice, setSourceChoice] = useState(BLANK_SOURCE);
  const [nameError, setNameError] = useState<string | null>(null);
  const { outcome, isPending, performAction } = useActionOutcome();
  const isCreating = editedWorkflow === undefined;

  const reportInvalidName = (message: string | undefined) =>
    setNameError(message ?? 'Nhập tên cho quy trình.');

  const submitWorkflow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let saveWorkflow: () => Promise<Workflow>;
    if (editedWorkflow === undefined) {
      const parsed = createWorkflowRequestSchema.safeParse({
        name,
        description,
        source: toWorkflowSource(sourceChoice, copyableWorkflow?.id),
      });
      if (!parsed.success) return reportInvalidName(parsed.error.issues[0]?.message);
      saveWorkflow = () => createWorkflow(departmentId, parsed.data);
    } else {
      const parsed = updateWorkflowRequestSchema.safeParse({ name, description });
      if (!parsed.success) return reportInvalidName(parsed.error.issues[0]?.message);
      saveWorkflow = () => updateWorkflow(editedWorkflow.id, parsed.data);
    }
    setNameError(null);
    const saved = await performAction(saveWorkflow, () => null);
    if (saved !== undefined) {
      onSaved(saved);
    }
  };

  return (
    <InlinePanel
      title={isCreating ? `Tạo quy trình mới cho ${departmentName}` : 'Cập nhật quy trình'}
      emphasised
    >
      <form onSubmit={(event) => void submitWorkflow(event)} className={styles.formStack}>
        <label className={controlStyles.field}>
          Tên quy trình
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Sửa lỗi khẩn"
            className={
              nameError === null
                ? controlStyles.fieldInput
                : `${controlStyles.fieldInput} ${controlStyles.fieldInputInvalid}`
            }
            aria-invalid={nameError !== null}
          />
        </label>
        {nameError !== null && (
          <span role="alert" className={controlStyles.fieldError}>
            {nameError}
          </span>
        )}
        <label className={controlStyles.field}>
          Mô tả ngắn
          <input
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Dùng khi nào, cho loại task nào"
            className={controlStyles.fieldInput}
          />
        </label>
        {isCreating && (
          <label className={controlStyles.field}>
            Bắt đầu từ
            <select
              value={sourceChoice}
              onChange={(event) => setSourceChoice(event.target.value)}
              className={controlStyles.fieldInput}
            >
              <option value={BLANK_SOURCE}>Trống (2 bước)</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  Mẫu: {template.label}
                </option>
              ))}
              {copyableWorkflow !== undefined && (
                <option value={COPY_SOURCE}>Sao chép “{copyableWorkflow.name}”</option>
              )}
            </select>
          </label>
        )}
        <StatusNotice outcome={outcome} />
        <div className={controlStyles.buttonRow}>
          <button type="submit" className={controlStyles.primaryButton} disabled={isPending}>
            {isCreating ? 'Tạo quy trình' : 'Cập nhật'}
          </button>
          <button type="button" className={controlStyles.secondaryButton} onClick={onCancel}>
            Huỷ
          </button>
        </div>
      </form>
    </InlinePanel>
  );
}
