'use client';

import { useEffect } from 'react';
import type { WorkspaceFileContent } from '@aiteam/contracts';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { loadWorkspaceFile, loadWorkspaceTree } from '../monitor-api';

/** Re-runs `reload` each time `revision` moves past zero (a live event said the data changed). */
export function useReloadOnRevision(revision: number, reload: () => void): void {
  useEffect(() => {
    if (revision > 0) reload();
  }, [revision, reload]);
}

export function useWorkspaceTree(taskId: string, revision: number) {
  const tree = useApiQuery(`workspace-tree:${taskId}`, () => loadWorkspaceTree(taskId));
  useReloadOnRevision(revision, tree.reload);
  return tree;
}

/** The open file; reloaded only when a live event touched that same file (or a checkpoint landed). */
export function useWorkspaceFile(taskId: string, filePath: string | null, revision: number) {
  const file = useApiQuery<WorkspaceFileContent | null>(
    `workspace-file:${taskId}:${filePath ?? ''}`,
    () => (filePath === null ? Promise.resolve(null) : loadWorkspaceFile(taskId, filePath)),
  );
  useReloadOnRevision(revision, file.reload);
  return file;
}

/** Folder → files, folders sorted, root first. */
export function groupFilesByFolder(
  files: readonly string[],
): Array<{ folder: string; files: string[] }> {
  const groups = new Map<string, string[]>();
  for (const filePath of files) {
    const slash = filePath.lastIndexOf('/');
    const folder = slash === -1 ? '' : filePath.slice(0, slash);
    const list = groups.get(folder) ?? [];
    list.push(filePath);
    groups.set(folder, list);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([folder, list]) => ({ folder, files: list.sort() }));
}

export function fileNameOf(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf('/') + 1);
}
