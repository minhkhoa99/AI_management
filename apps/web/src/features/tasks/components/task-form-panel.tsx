'use client';

import { type ChangeEvent, type FormEvent, useState } from 'react';
import {
  buildCompletionGoal,
  countQaTestCases,
  createTaskRequestSchema,
  type DirectoryValidation,
  isCountableQaDocument,
  QA_DOCUMENT_EXTENSIONS,
  QA_DOCUMENT_MAX_BYTES,
  qaDocumentNameSchema,
  TASK_PRIORITIES,
  type Department,
  type TaskDetail,
  type TaskPriority,
  updateTaskRequestSchema,
} from '@aiteam/contracts';
import { useApiQuery, invalidateApiQueries } from '../../../shared/api/use-api-query';
import { controlStyles, InlinePanel, StatusNotice } from '../../../shared/ui/controls';
import { StrokeIcon } from '../../../shared/ui/stroke-icon';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { loadAgents } from '../../organization/organization-api';
import { ROLE_LABELS } from '../../organization/organization-labels';
import { loadWorkflows } from '../../workflows/workflows-api';
import { formatFileSize, PRIORITY_PRESENTATION, shortenDirectory } from '../task-labels';
import {
  createTask,
  loadRecentDirectories,
  loadTaskDetail,
  pickLocalDirectory,
  removeQaDocument,
  updateTask,
  uploadQaDocument,
  validateWorkingDirectory,
} from '../tasks-api';
import { CompletionGoalBox } from './completion-goal-box';
import styles from './tasks.module.css';

const FOLDER_ICON = 'M3 6h6l2 2h10v11H3z';
const UPLOAD_ICON = 'M12 16V5M7 10l5-5 5 5M5 19h14';
const REMOVE_ICON = 'M6 6l12 12M18 6L6 18';
const DEFAULT_WORKFLOW = 'default';
const NO_WORKFLOW = 'none';

interface TaskFormPanelProps {
  departments: readonly Department[];
  preferredDepartment: Department | undefined;
  /** null: create a task. */
  editedTaskId: string | null;
  onSaved: (saved: TaskDetail) => void;
  onCancel: () => void;
}

/** Loads the task when editing, then shows the form with its values. */
export function TaskFormPanel(props: TaskFormPanelProps) {
  if (props.editedTaskId === null) {
    return <TaskForm {...props} editedTask={null} />;
  }
  return <EditedTaskForm {...props} editedTaskId={props.editedTaskId} />;
}

function EditedTaskForm(props: TaskFormPanelProps & { editedTaskId: string }) {
  const editedTaskId = props.editedTaskId;
  const task = useApiQuery(`task:${editedTaskId}`, () => loadTaskDetail(editedTaskId));
  if (task.status === 'loading') {
    return <p className={styles.mutedText}>Đang tải task…</p>;
  }
  if (task.status === 'error') {
    return <StatusNotice outcome={{ tone: 'error', error: task.error }} />;
  }
  return <TaskForm {...props} editedTask={task.result} />;
}

interface QueuedQaFile {
  key: string;
  file: File;
  detectedCases: number | null;
}

function TaskForm({
  departments,
  preferredDepartment,
  editedTask,
  onSaved,
  onCancel,
}: TaskFormPanelProps & { editedTask: TaskDetail | null }) {
  const [savedTask, setSavedTask] = useState<TaskDetail | null>(editedTask);
  const [departmentId, setDepartmentId] = useState(
    editedTask?.departmentId ?? preferredDepartment?.id ?? departments[0]?.id ?? '',
  );
  const [title, setTitle] = useState(editedTask?.title ?? '');
  const [description, setDescription] = useState(editedTask?.description ?? '');
  const [criteria, setCriteria] = useState(editedTask?.criteria ?? '');
  const [priority, setPriority] = useState<TaskPriority>(editedTask?.priority ?? 2);
  const [assigneeAgentId, setAssigneeAgentId] = useState(editedTask?.assignee?.id ?? '');
  const [workflowChoice, setWorkflowChoice] = useState(
    editedTask === null ? DEFAULT_WORKFLOW : (editedTask.workflow?.id ?? NO_WORKFLOW),
  );
  const [workingDirectory, setWorkingDirectory] = useState(editedTask?.workingDirectory ?? '');
  const [testCommand, setTestCommand] = useState(editedTask?.testCommand ?? '');
  const [previewCommand, setPreviewCommand] = useState(editedTask?.previewCommand ?? '');
  const [queuedFiles, setQueuedFiles] = useState<QueuedQaFile[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const [directoryCheck, setDirectoryCheck] = useState<DirectoryValidation | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { outcome, isPending, performAction } = useActionOutcome();

  const agents = useApiQuery(`agents:${departmentId}`, () => loadAgents(departmentId));
  const workflows = useApiQuery(`workflows:${departmentId}`, () => loadWorkflows(departmentId));
  const recentDirectories = useApiQuery('recent-dirs', loadRecentDirectories);
  const agentList = agents.status === 'success' ? agents.result : [];
  const workflowList = workflows.status === 'success' ? workflows.result : [];
  const isCreating = savedTask === null;
  const hasStarted = editedTask !== null && editedTask.status !== 'queued';

  const keptAttachments = (savedTask?.attachments ?? []).filter(
    (attachment) => !removedAttachmentIds.includes(attachment.id),
  );
  const goal = buildCompletionGoal({
    description,
    criteria,
    qaDocuments: [
      ...keptAttachments,
      ...queuedFiles.map((queued) => ({
        fileName: queued.file.name,
        detectedCases: queued.detectedCases,
      })),
    ],
  });

  const checkDirectory = (directoryPath: string) => {
    if (directoryPath.trim() === '') {
      setDirectoryCheck(null);
      return;
    }
    void validateWorkingDirectory(directoryPath).then(setDirectoryCheck, (error: unknown) =>
      setFormError(error instanceof Error ? error.message : 'Không kiểm tra được thư mục.'),
    );
  };

  const pickDirectory = () =>
    void performAction(pickLocalDirectory, (pick) => {
      if (pick.path !== null) {
        setWorkingDirectory(pick.path);
        checkDirectory(pick.path);
      }
      return null;
    });

  const addQaFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    const accepted: QueuedQaFile[] = [];
    for (const file of files) {
      if (!qaDocumentNameSchema.safeParse(file.name).success) {
        setFormError(`${file.name}: chỉ nhận ${QA_DOCUMENT_EXTENSIONS.join(', ')}.`);
        continue;
      }
      if (file.size === 0 || file.size > QA_DOCUMENT_MAX_BYTES) {
        setFormError(`${file.name}: file trống hoặc lớn hơn 10 MB.`);
        continue;
      }
      const detectedCases = isCountableQaDocument(file.name)
        ? countQaTestCases(await file.text(), file.name)
        : null;
      accepted.push({ key: `${file.name}:${file.lastModified}`, file, detectedCases });
    }
    setQueuedFiles((previous) => [
      ...previous.filter(
        (queued) => !accepted.some((added) => added.file.name === queued.file.name),
      ),
      ...accepted,
    ]);
  };

  const saveTaskFields = async (): Promise<TaskDetail> => {
    const workflowId =
      workflowChoice === DEFAULT_WORKFLOW
        ? undefined
        : workflowChoice === NO_WORKFLOW
          ? null
          : workflowChoice;
    if (savedTask === null) {
      const parsed = createTaskRequestSchema.safeParse({
        departmentId,
        title,
        description,
        criteria,
        priority,
        ...(assigneeAgentId === '' ? {} : { assigneeAgentId }),
        ...(workflowId === undefined ? {} : { workflowId }),
        workingDirectory,
        testCommand,
        previewCommand,
      });
      if (!parsed.success)
        throw new Error(parsed.error.issues[0]?.message ?? 'Dữ liệu chưa hợp lệ.');
      return createTask(parsed.data);
    }
    const parsed = updateTaskRequestSchema.safeParse({
      title,
      description,
      criteria,
      priority,
      testCommand,
      previewCommand,
      ...(assigneeAgentId === '' ? {} : { assigneeAgentId }),
      ...(hasStarted
        ? {}
        : {
            workflowId: workflowId === undefined ? null : workflowId,
            workingDirectory,
          }),
    });
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Dữ liệu chưa hợp lệ.');
    return updateTask(savedTask.id, parsed.data);
  };

  const submitTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (title.trim() === '') {
      setFormError('Nhập tiêu đề task.');
      return;
    }
    const saved = await performAction(
      async () => {
        // Saved first, so a failing upload never creates the task twice on retry.
        const task = await saveTaskFields();
        setSavedTask(task);
        for (const attachmentId of removedAttachmentIds) {
          await removeQaDocument(task.id, attachmentId);
        }
        setRemovedAttachmentIds([]);
        for (const queued of queuedFiles) {
          await uploadQaDocument(task.id, queued.file);
          setQueuedFiles((previous) => previous.filter((other) => other.key !== queued.key));
        }
        invalidateApiQueries();
        return task;
      },
      () => null,
    );
    if (saved !== undefined) {
      onSaved(saved);
    }
  };

  return (
    <InlinePanel title={isCreating ? 'Tạo task mới' : `Sửa task ${savedTask.code}`} emphasised>
      <form onSubmit={(event) => void submitTask(event)} className={styles.formStack}>
        <label className={controlStyles.field}>
          Tiêu đề
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Xây API đăng nhập bằng Google"
            className={controlStyles.fieldInput}
          />
        </label>
        <label className={controlStyles.field}>
          Mô tả
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            placeholder="Agent cần làm gì, bối cảnh, ràng buộc"
            className={styles.textArea}
          />
        </label>
        <label className={controlStyles.field}>
          Tiêu chí hoàn thành, mỗi dòng một tiêu chí
          <textarea
            value={criteria}
            onChange={(event) => setCriteria(event.target.value)}
            rows={3}
            placeholder="Sai mật khẩu trả lỗi 401"
            className={styles.textArea}
          />
        </label>

        <div className={styles.subPanel}>
          <span className={styles.subPanelTitle}>Thư mục làm việc trên máy</span>
          <div className={styles.directoryRow}>
            <label className={`${controlStyles.field} ${styles.directoryField}`}>
              Đường dẫn thư mục
              <input
                type="text"
                value={workingDirectory}
                disabled={hasStarted}
                onChange={(event) => {
                  setWorkingDirectory(event.target.value);
                  setDirectoryCheck(null);
                }}
                onBlur={() => checkDirectory(workingDirectory)}
                placeholder="Bỏ trống: nền tảng tạo thư mục riêng cho task"
                className={`${controlStyles.fieldInput} ${styles.monoInput}`}
              />
            </label>
            <button
              type="button"
              className={controlStyles.secondaryButton}
              disabled={hasStarted || isPending}
              onClick={pickDirectory}
            >
              <StrokeIcon path={FOLDER_ICON} size={16} /> Chọn thư mục
            </button>
          </div>
          {recentDirectories.status === 'success' &&
            recentDirectories.result.length > 0 &&
            !hasStarted && (
              <div className={styles.recentRow}>
                Gần đây:
                {recentDirectories.result.map((directoryPath) => (
                  <button
                    key={directoryPath}
                    type="button"
                    className={styles.recentPill}
                    title={directoryPath}
                    aria-pressed={directoryPath === workingDirectory}
                    onClick={() => {
                      setWorkingDirectory(directoryPath);
                      checkDirectory(directoryPath);
                    }}
                  >
                    {shortenDirectory(directoryPath)}
                  </button>
                ))}
              </div>
            )}
          {directoryCheck !== null &&
            (directoryCheck.problem === null ? (
              <span role="status" className={styles.directoryOk}>
                Dùng được: {directoryCheck.path}
                {directoryCheck.isGitRepository
                  ? ' · git repo'
                  : ' · chưa phải git repo, nền tảng sẽ git init và tạo commit ban đầu khi task bắt đầu'}
              </span>
            ) : (
              <span role="alert" className={styles.directoryProblem}>
                {directoryCheck.problem}
              </span>
            ))}
          <p className={styles.hint}>
            Agent chỉ đọc và ghi trong thư mục này. Claude Code, Codex và Antigravity chạy trên một
            git worktree riêng (nhánh agent/&lt;task&gt;) để không đụng vào code bạn đang sửa. Chỉ
            dùng được thư mục bạn đã chọn bằng nút Chọn thư mục, hoặc thư mục con của nó.
          </p>
        </div>

        <div className={styles.subPanel}>
          <span className={styles.subPanelTitle}>Tài liệu QA (không bắt buộc)</span>
          {keptAttachments.map((attachment) => (
            <div key={attachment.id} className={styles.fileRow}>
              <span className={styles.fileText}>
                <span className={styles.fileName}>{attachment.fileName}</span>
                <span className={styles.fileMeta}>
                  {formatFileSize(attachment.size)} · {describeCases(attachment.detectedCases)}
                </span>
              </span>
              <button
                type="button"
                className={styles.iconAction}
                aria-label={`Bỏ ${attachment.fileName}`}
                onClick={() => setRemovedAttachmentIds((previous) => [...previous, attachment.id])}
              >
                <StrokeIcon path={REMOVE_ICON} size={14} strokeWidth={2.2} />
              </button>
            </div>
          ))}
          {queuedFiles.map((queued) => (
            <div key={queued.key} className={styles.fileRow}>
              <span className={styles.fileText}>
                <span className={styles.fileName}>{queued.file.name}</span>
                <span className={styles.fileMeta}>
                  {formatFileSize(queued.file.size)} · {describeCases(queued.detectedCases)} · tải
                  lên khi lưu
                </span>
              </span>
              <button
                type="button"
                className={styles.iconAction}
                aria-label={`Bỏ ${queued.file.name}`}
                onClick={() =>
                  setQueuedFiles((previous) => previous.filter((other) => other.key !== queued.key))
                }
              >
                <StrokeIcon path={REMOVE_ICON} size={14} strokeWidth={2.2} />
              </button>
            </div>
          ))}
          <label className={styles.uploadButton}>
            <StrokeIcon path={UPLOAD_ICON} size={16} strokeWidth={2} />
            Tải tài liệu QA lên
            <input
              type="file"
              multiple
              accept={QA_DOCUMENT_EXTENSIONS.join(',')}
              onChange={(event) => void addQaFiles(event)}
              className={styles.hiddenFileInput}
              aria-label="Tải tài liệu QA lên"
            />
          </label>
          <p className={styles.hint}>
            Hỗ trợ {QA_DOCUMENT_EXTENSIONS.join(', ')} (tối đa 10 MB mỗi file). Với file văn bản, hệ
            thống đếm sẵn số kịch bản kiểm thử.
          </p>
        </div>

        <CompletionGoalBox goal={goal} showItems={false} />

        <div className={styles.formGrid}>
          {isCreating && (
            <label className={controlStyles.field}>
              Phòng ban
              <select
                value={departmentId}
                onChange={(event) => {
                  setDepartmentId(event.target.value);
                  setAssigneeAgentId('');
                  setWorkflowChoice(DEFAULT_WORKFLOW);
                }}
                className={controlStyles.fieldInput}
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                    {department.enabled ? '' : ' (đang tắt)'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={controlStyles.field}>
            Giao cho
            <select
              value={assigneeAgentId}
              onChange={(event) => setAssigneeAgentId(event.target.value)}
              className={controlStyles.fieldInput}
            >
              {isCreating && <option value="">Trưởng phòng (mặc định)</option>}
              {agentList.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {ROLE_LABELS[agent.role]} – {agent.name}
                  {agent.enabled && agent.department.enabled ? '' : ' (đang tắt)'}
                </option>
              ))}
            </select>
          </label>
          <label className={controlStyles.field}>
            Quy trình
            <select
              value={workflowChoice}
              disabled={hasStarted}
              onChange={(event) => setWorkflowChoice(event.target.value)}
              className={controlStyles.fieldInput}
            >
              {isCreating && <option value={DEFAULT_WORKFLOW}>Quy trình mặc định của phòng</option>}
              {workflowList.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                  {workflow.isDefault ? ' (mặc định)' : ''}
                </option>
              ))}
              <option value={NO_WORKFLOW}>Không theo quy trình</option>
            </select>
          </label>
          <label className={controlStyles.field}>
            Ưu tiên
            <select
              value={priority}
              onChange={(event) => {
                const chosen = TASK_PRIORITIES.find(
                  (candidate) => String(candidate) === event.target.value,
                );
                if (chosen !== undefined) setPriority(chosen);
              }}
              className={controlStyles.fieldInput}
            >
              {TASK_PRIORITIES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {PRIORITY_PRESENTATION[candidate].label}
                </option>
              ))}
            </select>
          </label>
          <label className={controlStyles.field}>
            Lệnh kiểm thử (cho bước “Test tự động phải pass”)
            <input
              type="text"
              value={testCommand}
              onChange={(event) => setTestCommand(event.target.value)}
              placeholder="npm test"
              className={`${controlStyles.fieldInput} ${styles.monoInput}`}
            />
          </label>
          <label className={controlStyles.field}>
            Lệnh chạy giao diện (cho tab “Giao diện”, có {'{port}'})
            <input
              type="text"
              value={previewCommand}
              onChange={(event) => setPreviewCommand(event.target.value)}
              placeholder="npm run dev -- --port {port} --host 127.0.0.1"
              className={`${controlStyles.fieldInput} ${styles.monoInput}`}
            />
          </label>
        </div>
        <p className={styles.hint}>
          Nên giao cho trưởng phòng. Trưởng phòng chia task xuống cấp dưới theo quy trình đã chọn.
        </p>

        {formError !== null && (
          <span role="alert" className={controlStyles.fieldError}>
            {formError}
          </span>
        )}
        <StatusNotice outcome={outcome} />
        <div className={controlStyles.buttonRow}>
          <button type="submit" className={controlStyles.primaryButton} disabled={isPending}>
            {isCreating ? 'Tạo và giao task' : 'Cập nhật task'}
          </button>
          <button type="button" className={controlStyles.secondaryButton} onClick={onCancel}>
            Huỷ
          </button>
        </div>
      </form>
    </InlinePanel>
  );
}

function describeCases(detectedCases: number | null): string {
  if (detectedCases === null) return 'AI đọc nội dung khi nhận task';
  return detectedCases > 0 ? `${detectedCases} kịch bản kiểm thử` : 'không thấy kịch bản';
}
