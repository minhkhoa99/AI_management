import type { OrgTreeNode } from '@aiteam/contracts';
import type { z } from 'zod';

/** Members in tree order (head first, then depth-first). */
export function listTreeMembers(root: OrgTreeNode | null): OrgTreeNode[] {
  if (root === null) {
    return [];
  }
  return [root, ...root.children.flatMap(listTreeMembers)];
}

/** Seats below `positionId`: never valid as its new manager (would create a cycle). */
export function collectDescendantPositionIds(
  root: OrgTreeNode | null,
  positionId: string,
): Set<string> {
  const start = listTreeMembers(root).find((member) => member.positionId === positionId);
  return new Set(
    (start?.children ?? []).flatMap(listTreeMembers).map((member) => member.positionId),
  );
}

/** First validation message per top-level field, for inline form errors. */
export function collectFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const fieldName = String(issue.path[0] ?? 'form');
    fieldErrors[fieldName] ??= issue.message;
  }
  return fieldErrors;
}
