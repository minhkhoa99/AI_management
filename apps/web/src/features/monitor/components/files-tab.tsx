'use client';

import { useState } from 'react';
import type { WorkspaceFileContent } from '@aiteam/contracts';
import { StatusNotice } from '../../../shared/ui/controls';
import { formatFileSize } from '../../tasks/task-labels';
import type { LiveRevisions } from './agent-workspace';
import styles from './monitor.module.css';
import {
  fileNameOf,
  groupFilesByFolder,
  useWorkspaceFile,
  useWorkspaceTree,
} from './workspace-queries';

/** "Code & thư mục": the worktree's files, and the open file reloaded live as the agent edits it. */
export function FilesTab({ taskId, revisions }: { taskId: string; revisions: LiveRevisions }) {
  const tree = useWorkspaceTree(taskId, revisions.files);
  const [chosenPath, setChosenPath] = useState<string | null>(null);
  const openPath = chosenPath ?? revisions.changedFile;
  const fileRevision =
    openPath !== null && openPath === revisions.changedFile ? revisions.files : 0;
  const file = useWorkspaceFile(taskId, openPath, fileRevision);

  if (tree.status === 'loading') return <p className={styles.mutedText}>Đang đọc thư mục…</p>;
  if (tree.status === 'error')
    return <StatusNotice outcome={{ tone: 'error', error: tree.error }} />;
  const groups = groupFilesByFolder(tree.result.files);

  return (
    <div className={styles.split}>
      <nav aria-label="Cây thư mục" className={styles.sideList}>
        {groups.length === 0 && <p className={styles.mutedText}>Thư mục chưa có file.</p>}
        {groups.map((group) => (
          <div key={group.folder}>
            <p className={styles.treeFolder}>
              {group.folder === '' ? '/' : `${group.folder}/`}
              {group.folder === tree.result.agentFolder.replace(/\/$/, '') && ' (thư mục của task)'}
            </p>
            {group.files.map((filePath) => (
              <button
                key={filePath}
                type="button"
                className={styles.treeItem}
                aria-pressed={filePath === openPath}
                title={filePath}
                onClick={() => setChosenPath(filePath)}
              >
                {filePath === revisions.changedFile && (
                  <span className={styles.liveDot} aria-label="Agent vừa sửa" />
                )}
                {fileNameOf(filePath)}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div>
        {openPath === null && <p className={styles.mutedText}>Chọn một file để xem nội dung.</p>}
        {openPath !== null && file.status === 'loading' && (
          <p className={styles.mutedText}>Đang mở file…</p>
        )}
        {file.status === 'error' && <StatusNotice outcome={{ tone: 'error', error: file.error }} />}
        {file.status === 'success' && file.result !== null && <CodeView file={file.result} />}
      </div>
    </div>
  );
}

export function CodeView({ file }: { file: WorkspaceFileContent }) {
  const lines = file.content === null ? [] : file.content.replace(/\r\n/g, '\n').split('\n');
  return (
    <div className={styles.codeBox}>
      <div className={styles.codeHeader}>
        <span>{file.path}</span>
        <span>
          {formatFileSize(file.size)}
          {file.truncated && ' · chỉ hiện phần đầu'}
        </span>
      </div>
      {file.binary ? (
        <p className={styles.mutedText} style={{ padding: 12 }}>
          File nhị phân, không hiển thị nội dung.
        </p>
      ) : (
        <table className={styles.codeTable}>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td className={styles.lineNumber}>{index + 1}</td>
                <td>{line}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
