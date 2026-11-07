'use client';

import { useState } from 'react';
import { StatusNotice } from '../../../shared/ui/controls';
import type { LiveRevisions } from './agent-workspace';
import { MarkdownView } from './markdown-view';
import styles from './monitor.module.css';
import { useWorkspaceFile, useWorkspaceTree } from './workspace-queries';

const isMarkdown = (filePath: string) => /\.(md|markdown)$/i.test(filePath);

/** "Tài liệu": Markdown files of the worktree, rendered without any HTML from the agent. */
export function DocsTab({ taskId, revisions }: { taskId: string; revisions: LiveRevisions }) {
  const tree = useWorkspaceTree(taskId, revisions.files);
  const [chosenPath, setChosenPath] = useState<string | null>(null);
  const documents = tree.status === 'success' ? tree.result.files.filter(isMarkdown) : [];
  const openPath = chosenPath ?? documents[0] ?? null;
  const fileRevision =
    openPath !== null && openPath === revisions.changedFile ? revisions.files : 0;
  const file = useWorkspaceFile(taskId, openPath, fileRevision);

  if (tree.status === 'loading') return <p className={styles.mutedText}>Đang tìm tài liệu…</p>;
  if (tree.status === 'error')
    return <StatusNotice outcome={{ tone: 'error', error: tree.error }} />;
  if (documents.length === 0) {
    return (
      <p className={styles.mutedText}>Chưa có file Markdown (.md) nào trong thư mục làm việc.</p>
    );
  }

  return (
    <div className={styles.split}>
      <nav aria-label="Tài liệu" className={styles.sideList}>
        {documents.map((filePath) => (
          <button
            key={filePath}
            type="button"
            className={styles.treeItem}
            aria-pressed={filePath === openPath}
            onClick={() => setChosenPath(filePath)}
          >
            {filePath}
          </button>
        ))}
      </nav>
      <div className={styles.codeBox} style={{ padding: 16 }}>
        {file.status === 'loading' && <p className={styles.mutedText}>Đang mở tài liệu…</p>}
        {file.status === 'error' && <StatusNotice outcome={{ tone: 'error', error: file.error }} />}
        {file.status === 'success' && file.result !== null && (
          <MarkdownView source={file.result.content ?? ''} />
        )}
      </div>
    </div>
  );
}
