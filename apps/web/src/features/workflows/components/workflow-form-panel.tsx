'use client';

import { type ChangeEvent, type FormEvent, useState } from 'react';
import {
  createWorkflowRequestSchema,
  updateWorkflowRequestSchema,
  type Workflow,
  type WorkflowExportDocument,
  workflowExportDocumentSchema,
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
const IMPORT_SOURCE = 'import';
const IMPORT_MAX_BYTES = 256 * 1024;

function toWorkflowSource(
  choice: string,
  copyableWorkflowId: string | undefined,
  importedDocument: WorkflowExportDocument | null,
): WorkflowSource {
  if (choice === COPY_SOURCE && copyableWorkflowId !== undefined) {
    return { kind: 'copy', workflowId: copyableWorkflowId };
  }
  if (choice === IMPORT_SOURCE && importedDocument !== null) {
    return { kind: 'import', document: importedDocument };
  }
  const templateId = workflowTemplateIdSchema.safeParse(choice);
  return templateId.success ? { kind: 'template', templateId: templateId.data } : { kind: 'blank' };
}

/** Reads an exported workflow file; null with a message when it is not one. */
function readWorkflowExport(
  text: string,
): { document: WorkflowExportDocument; problem: null } | { document: null; problem: string } {
  if (text.length > IMPORT_MAX_BYTES) {
    return { document: null, problem: 'Tệp quá lớn (tối đa 256 KB).' };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { document: null, problem: 'Không đọc được JSON.' };
  }
  const parsed = workflowExportDocumentSchema.safeParse(json);
  return parsed.success
    ? { document: parsed.data, problem: null }
    : { document: null, problem: 'Không phải tệp quy trình aiteam hợp lệ.' };
}

/** Create (blank / template / copy / imported JSON) or rename a workflow. */
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
  const [importText, setImportText] = useState('');
  const [importedDocument, setImportedDocument] = useState<WorkflowExportDocument | null>(null);
  const [importProblem, setImportProblem] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const { outcome, isPending, performAction } = useActionOutcome();
  const isCreating = editedWorkflow === undefined;

  const reportInvalidName = (message: string | undefined) =>
    setNameError(message ?? 'Nhập tên cho quy trình.');

  const refuseImport = (problem: string | null) => {
    setImportedDocument(null);
    setImportProblem(problem);
  };

  const acceptImportText = (text: string) => {
    setImportText(text);
    if (text.trim() === '') return refuseImport(null);
    const { document: imported, problem } = readWorkflowExport(text);
    setImportedDocument(imported);
    setImportProblem(problem);
    if (imported !== null) {
      setName((current) => (current.trim() === '' ? imported.name : current));
      setDescription((current) => (current.trim() === '' ? imported.description : current));
    }
  };

  const acceptImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    if (file.size > IMPORT_MAX_BYTES) return refuseImport('Tệp quá lớn (tối đa 256 KB).');
    void file.text().then(acceptImportText, () => refuseImport('Không đọc được tệp.'));
  };

  const submitWorkflow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let saveWorkflow: () => Promise<Workflow>;
    if (editedWorkflow === undefined) {
      if (sourceChoice === IMPORT_SOURCE && importedDocument === null) {
        setImportProblem(importProblem ?? 'Chọn tệp hoặc dán JSON của quy trình.');
        return;
      }
      const parsed = createWorkflowRequestSchema.safeParse({
        name,
        description,
        source: toWorkflowSource(sourceChoice, copyableWorkflow?.id, importedDocument),
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
              <option value={IMPORT_SOURCE}>Nhập từ JSON</option>
            </select>
          </label>
        )}
        {isCreating && sourceChoice === IMPORT_SOURCE && (
          <>
            <label className={controlStyles.field}>
              Tệp quy trình (.aiteam-workflow.json, tối đa 256 KB)
              <input
                type="file"
                accept=".json,application/json"
                onChange={acceptImportFile}
                className={controlStyles.fieldInput}
              />
            </label>
            <label className={controlStyles.field}>
              Hoặc dán nội dung JSON
              <textarea
                value={importText}
                rows={6}
                onChange={(event) => acceptImportText(event.target.value)}
                className={styles.textInput}
                aria-invalid={importProblem !== null}
              />
            </label>
            {importProblem !== null && (
              <span role="alert" className={controlStyles.fieldError}>
                {importProblem}
              </span>
            )}
            {importedDocument !== null && (
              <span role="status" className={styles.mutedText}>
                Đã đọc “{importedDocument.name}”: {importedDocument.steps.length} bước.
              </span>
            )}
          </>
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
