'use client';

import { Fragment, useState } from 'react';
import type { Checkpoint, DiffFile, DiffLine, LineComment, WorkspaceDiff } from '@aiteam/contracts';
import { LINE_COMMENT_MAX_LENGTH } from '@aiteam/contracts';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import {
  addLineComment,
  loadCheckpointDiff,
  loadCheckpoints,
  loadLineComments,
  loadTaskDiff,
  revertWorkspaceFile,
  submitCodeReview,
} from '../monitor-api';
import styles from './monitor.module.css';
import { useReloadOnRevision } from './workspace-queries';

const ALL_CHANGES = 'all';
type DiffLayout = 'unified' | 'split';

const CHANGE_LABELS: Record<DiffFile['change'], string> = {
  added: 'mới',
  deleted: 'đã xoá',
  modified: 'sửa',
  renamed: 'đổi tên',
};

const COMMENT_STATUS_LABELS: Record<LineComment['status'], string> = {
  open: 'Chưa gửi',
  sent: 'Đã gửi agent',
  resolved: 'Đã xử lý',
};

const NO_DIFF: WorkspaceDiff = { checkpointId: null, files: [] };

/** "Thay đổi": diff per checkpoint (or since the start), line comments and the code review. */
export function DiffTab({ taskId, revision }: { taskId: string; revision: number }) {
  const checkpoints = useApiQuery(`checkpoints:${taskId}`, () => loadCheckpoints(taskId));
  useReloadOnRevision(revision, checkpoints.reload);
  const [scope, setScope] = useState<string | null>(null);
  const [layout, setLayout] = useState<DiffLayout>('unified');
  const [chosenFile, setChosenFile] = useState<string | null>(null);

  const checkpointList = checkpoints.status === 'success' ? checkpoints.result : [];
  const selectedCheckpoint: Checkpoint | null =
    scope === ALL_CHANGES
      ? null
      : (checkpointList.find((item) => item.id === scope) ?? checkpointList[0] ?? null);
  const diffKey = scope === ALL_CHANGES ? ALL_CHANGES : (selectedCheckpoint?.id ?? 'none');
  const diff = useApiQuery(`diff:${taskId}:${diffKey}`, () => {
    if (scope === ALL_CHANGES) return loadTaskDiff(taskId);
    return selectedCheckpoint === null
      ? Promise.resolve(NO_DIFF)
      : loadCheckpointDiff(selectedCheckpoint.id);
  });
  useReloadOnRevision(revision, diff.reload);
  const comments = useApiQuery(`line-comments:${selectedCheckpoint?.id ?? 'none'}`, () =>
    selectedCheckpoint === null ? Promise.resolve([]) : loadLineComments(selectedCheckpoint.id),
  );

  if (checkpoints.status === 'loading')
    return <p className={styles.mutedText}>Đang tải các mốc…</p>;
  if (checkpoints.status === 'error') {
    return <StatusNotice outcome={{ tone: 'error', error: checkpoints.error }} />;
  }
  if (checkpointList.length === 0) {
    return (
      <p className={styles.mutedText}>
        Agent chưa lưu mốc nào. Mốc được tạo sau mỗi lượt có sửa file.
      </p>
    );
  }

  const files = diff.status === 'success' ? diff.result.files : [];
  const openFile = files.find((file) => file.path === chosenFile) ?? files[0];
  const commentList = comments.status === 'success' ? comments.result : [];

  return (
    <div>
      <div className={styles.diffToolbar}>
        <label className={controlStyles.field}>
          Xem thay đổi của
          <select
            className={controlStyles.fieldInput}
            value={scope === ALL_CHANGES ? ALL_CHANGES : (selectedCheckpoint?.id ?? '')}
            onChange={(event) => {
              setScope(event.target.value);
              setChosenFile(null);
            }}
          >
            {checkpointList.map((checkpoint, index) => (
              <option key={checkpoint.id} value={checkpoint.id}>
                {index === 0 ? 'Mốc mới nhất' : `Mốc ${checkpointList.length - index}`} ·{' '}
                {checkpoint.sha.slice(0, 7)}
                {checkpoint.stepName === null ? '' : ` · ${checkpoint.stepName}`}
                {checkpoint.openCommentCount > 0
                  ? ` · ${checkpoint.openCommentCount} góp ý chưa gửi`
                  : ''}
              </option>
            ))}
            <option value={ALL_CHANGES}>Tất cả thay đổi từ đầu task</option>
          </select>
        </label>
        <div role="group" aria-label="Kiểu hiển thị" className={controlStyles.buttonRow}>
          {(['unified', 'split'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={controlStyles.pillButton}
              aria-pressed={layout === candidate}
              onClick={() => setLayout(candidate)}
            >
              {candidate === 'unified' ? 'Gộp' : 'Hai cột'}
            </button>
          ))}
        </div>
      </div>
      {selectedCheckpoint !== null && (
        <p className={styles.mutedText} style={{ marginBottom: 12 }}>
          {selectedCheckpoint.message}
          {selectedCheckpoint.agentName === null ? '' : ` · ${selectedCheckpoint.agentName}`} ·{' '}
          {new Date(selectedCheckpoint.createdAt).toLocaleString('vi-VN')}
        </p>
      )}

      {diff.status === 'loading' && <p className={styles.mutedText}>Đang so sánh…</p>}
      {diff.status === 'error' && <StatusNotice outcome={{ tone: 'error', error: diff.error }} />}
      {diff.status === 'success' && files.length === 0 && (
        <p className={styles.mutedText}>Không có file nào thay đổi.</p>
      )}
      {openFile !== undefined && (
        <div className={styles.split}>
          <nav aria-label="File thay đổi" className={styles.sideList}>
            {files.map((file) => (
              <button
                key={file.path}
                type="button"
                className={styles.listButton}
                aria-pressed={file.path === openFile.path}
                onClick={() => setChosenFile(file.path)}
              >
                <span className={styles.monoText} style={{ color: 'inherit' }}>
                  {file.path}
                </span>
                <span className={styles.diffStat}>
                  {CHANGE_LABELS[file.change]} ·{' '}
                  <span className={styles.addCount}>+{file.additions}</span>{' '}
                  <span className={styles.deleteCount}>−{file.deletions}</span>
                </span>
              </button>
            ))}
          </nav>
          <DiffFileView
            key={`${diffKey}:${openFile.path}`}
            taskId={taskId}
            file={openFile}
            layout={layout}
            checkpointId={selectedCheckpoint?.id ?? null}
            comments={commentList.filter((comment) => comment.filePath === openFile.path)}
          />
        </div>
      )}
      {selectedCheckpoint !== null && (
        <ReviewBar
          taskId={taskId}
          checkpoint={selectedCheckpoint}
          openCommentCount={commentList.filter((comment) => comment.status === 'open').length}
        />
      )}
    </div>
  );
}

interface SideBySideRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/** Pairs each run of deleted lines with the added lines that follow it, row by row. */
function pairDiffLines(lines: readonly DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let deleted: DiffLine[] = [];
  let added: DiffLine[] = [];
  const flushRun = () => {
    for (let index = 0; index < Math.max(deleted.length, added.length); index += 1) {
      rows.push({ left: deleted[index] ?? null, right: added[index] ?? null });
    }
    deleted = [];
    added = [];
  };
  for (const line of lines) {
    if (line.kind === 'delete') deleted.push(line);
    else if (line.kind === 'add') added.push(line);
    else {
      flushRun();
      rows.push({ left: line, right: line });
    }
  }
  flushRun();
  return rows;
}

const lineClassName = (line: DiffLine | null) =>
  line?.kind === 'add' ? styles.lineAdd : line?.kind === 'delete' ? styles.lineDelete : undefined;

function DiffFileView({
  taskId,
  file,
  layout,
  checkpointId,
  comments,
}: {
  taskId: string;
  file: DiffFile;
  layout: DiffLayout;
  checkpointId: string | null;
  comments: LineComment[];
}) {
  const [draftLine, setDraftLine] = useState<number | null>(null);
  const revert = useActionOutcome();
  const columnCount = layout === 'unified' ? 4 : 5;

  /** The "+" that opens a comment on a line of the new version (only on a checkpoint's diff). */
  const commentButton = (line: DiffLine | null) =>
    checkpointId !== null && line !== null && line.newLine !== null ? (
      <button
        type="button"
        className={styles.commentButton}
        aria-label={`Góp ý dòng ${line.newLine}`}
        onClick={() => setDraftLine(line.newLine)}
      >
        +
      </button>
    ) : null;

  /** Comments (and the open draft) shown under the new-version line they are about. */
  const commentRows = (newLine: number | null) => {
    if (newLine === null) return null;
    const lineComments = comments.filter((comment) => comment.line === newLine);
    return (
      <>
        {lineComments.map((comment) => (
          <tr key={comment.id} className={styles.commentRow}>
            <td colSpan={columnCount}>
              <strong>Dòng {comment.line}</strong> · {COMMENT_STATUS_LABELS[comment.status]}
              <br />
              {comment.body}
            </td>
          </tr>
        ))}
        {draftLine === newLine && checkpointId !== null && (
          <tr className={styles.commentRow}>
            <td colSpan={columnCount}>
              <LineCommentDraft
                checkpointId={checkpointId}
                filePath={file.path}
                line={newLine}
                onClose={() => setDraftLine(null)}
              />
            </td>
          </tr>
        )}
      </>
    );
  };

  return (
    <div className={styles.codeBox}>
      <div className={styles.codeHeader}>
        <span>
          {file.oldPath !== null && file.oldPath !== file.path ? `${file.oldPath} → ` : ''}
          {file.path}
        </span>
        <button
          type="button"
          className={controlStyles.secondaryButton}
          style={{ minHeight: 28, padding: '0 10px', fontSize: 12 }}
          disabled={revert.isPending}
          onClick={() => {
            if (
              !window.confirm(
                `Đưa ${file.path} về như lúc task bắt đầu? Thay đổi của agent trên file này sẽ mất.`,
              )
            ) {
              return;
            }
            void revert.performAction(
              () => revertWorkspaceFile(taskId, file.path),
              () => `Đã hoàn tác ${file.path} và lưu mốc mới.`,
            );
          }}
        >
          Hoàn tác file
        </button>
      </div>
      <StatusNotice outcome={revert.outcome} />
      {file.binary && (
        <p className={styles.mutedText} style={{ padding: 12 }}>
          File nhị phân, không hiển thị khác biệt.
        </p>
      )}
      <table className={styles.codeTable}>
        <tbody>
          {file.hunks.map((hunk, hunkIndex) => (
            <Fragment key={hunkIndex}>
              <tr className={styles.hunkHeader}>
                <td colSpan={columnCount}>{hunk.header}</td>
              </tr>
              {layout === 'unified'
                ? hunk.lines.map((line, lineIndex) => (
                    <Fragment key={lineIndex}>
                      <tr className={lineClassName(line)}>
                        <td className={styles.lineNumber}>{commentButton(line)}</td>
                        <td className={styles.lineNumber}>{line.oldLine ?? ''}</td>
                        <td className={styles.lineNumber}>{line.newLine ?? ''}</td>
                        <td>
                          {line.kind === 'add' ? '+' : line.kind === 'delete' ? '-' : ' '}
                          {line.text}
                        </td>
                      </tr>
                      {line.kind !== 'delete' && commentRows(line.newLine)}
                    </Fragment>
                  ))
                : pairDiffLines(hunk.lines).map((row, rowIndex) => (
                    <Fragment key={rowIndex}>
                      <tr>
                        <td className={`${styles.lineNumber} ${lineClassName(row.left) ?? ''}`}>
                          {row.left?.oldLine ?? ''}
                        </td>
                        <td className={lineClassName(row.left)}>{row.left?.text ?? ''}</td>
                        <td className={styles.lineNumber}>{commentButton(row.right)}</td>
                        <td className={`${styles.lineNumber} ${lineClassName(row.right) ?? ''}`}>
                          {row.right?.newLine ?? ''}
                        </td>
                        <td className={lineClassName(row.right)}>{row.right?.text ?? ''}</td>
                      </tr>
                      {commentRows(row.right?.newLine ?? null)}
                    </Fragment>
                  ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      {file.truncated && (
        <p className={styles.mutedText} style={{ padding: 12 }}>
          Diff quá dài nên bị cắt. Mở file ở tab Code &amp; thư mục để xem đầy đủ.
        </p>
      )}
    </div>
  );
}

function LineCommentDraft({
  checkpointId,
  filePath,
  line,
  onClose,
}: {
  checkpointId: string;
  filePath: string;
  line: number;
  onClose: () => void;
}) {
  const [body, setBody] = useState('');
  const { outcome, isPending, performAction } = useActionOutcome();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void performAction(
          () => addLineComment(checkpointId, { filePath, line, body }),
          () => null,
        ).then((saved) => {
          if (saved !== undefined) onClose();
        });
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <label className={controlStyles.field}>
        Góp ý cho dòng {line}
        <textarea
          className={controlStyles.fieldInput}
          style={{ padding: 8, minHeight: 72 }}
          value={body}
          maxLength={LINE_COMMENT_MAX_LENGTH}
          // The draft row appears where the user clicked; typing can start right away.
          autoFocus
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <div className={controlStyles.buttonRow}>
        <button
          type="submit"
          className={controlStyles.primaryButton}
          disabled={isPending || body.trim() === ''}
        >
          Lưu góp ý
        </button>
        <button type="button" className={controlStyles.secondaryButton} onClick={onClose}>
          Huỷ
        </button>
      </div>
      <StatusNotice outcome={outcome} />
    </form>
  );
}

function ReviewBar({
  taskId,
  checkpoint,
  openCommentCount,
}: {
  taskId: string;
  checkpoint: Checkpoint;
  openCommentCount: number;
}) {
  const [note, setNote] = useState('');
  const { outcome, isPending, performAction } = useActionOutcome();
  const submit = (decision: 'approve' | 'request_changes') =>
    void performAction(
      () => submitCodeReview(taskId, { decision, checkpointId: checkpoint.id, note }),
      () => {
        setNote('');
        return decision === 'approve'
          ? 'Đã duyệt thay đổi.'
          : 'Đã gửi góp ý. Agent làm mốc này sẽ sửa và lưu mốc mới.';
      },
    );
  return (
    <section aria-label="Duyệt code" className={styles.reviewBar}>
      <span className={styles.diffStat}>
        Duyệt mốc {checkpoint.sha.slice(0, 7)} · {openCommentCount} góp ý theo dòng chưa gửi
      </span>
      <label className={controlStyles.field}>
        Nhận xét chung (không bắt buộc)
        <textarea
          className={controlStyles.fieldInput}
          style={{ padding: 8, minHeight: 60 }}
          value={note}
          maxLength={LINE_COMMENT_MAX_LENGTH}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className={controlStyles.buttonRow}>
        <button
          type="button"
          className={controlStyles.primaryButton}
          disabled={isPending}
          onClick={() => submit('approve')}
        >
          Duyệt thay đổi
        </button>
        <button
          type="button"
          className={controlStyles.dangerButton}
          disabled={isPending || (openCommentCount === 0 && note.trim() === '')}
          onClick={() => submit('request_changes')}
        >
          Yêu cầu sửa
        </button>
      </div>
      <StatusNotice outcome={outcome} />
    </section>
  );
}
