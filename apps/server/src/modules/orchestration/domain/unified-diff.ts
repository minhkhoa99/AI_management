import type { DiffFile, DiffLine } from '@aiteam/contracts';

/** Lines kept per file: past this the diff is cut and marked truncated. */
export const MAX_DIFF_LINES_PER_FILE = 2_000;

/**
 * Parses `git diff` / `git show --patch` output (with --find-renames) into files, hunks and
 * numbered lines. Unknown lines are ignored; the text of a line is kept verbatim (plain text).
 */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffFile['hunks'][number] | null = null;
  let oldLine = 0;
  let newLine = 0;
  let lineCount = 0;

  const startFile = (headerPath: string) => {
    file = {
      path: headerPath,
      oldPath: null,
      change: 'modified',
      binary: false,
      additions: 0,
      deletions: 0,
      hunks: [],
      truncated: false,
    };
    files.push(file);
    hunk = null;
    lineCount = 0;
  };

  for (const rawLine of patch.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith('diff --git ')) {
      startFile(parseDiffHeaderPath(line));
      continue;
    }
    const current = file as DiffFile | null;
    if (current === null) continue;

    if (hunk === null) {
      if (line.startsWith('new file mode')) current.change = 'added';
      else if (line.startsWith('deleted file mode')) current.change = 'deleted';
      else if (line.startsWith('rename from ')) {
        current.change = 'renamed';
        current.oldPath = line.slice('rename from '.length);
      } else if (line.startsWith('rename to ')) current.path = line.slice('rename to '.length);
      else if (line.startsWith('Binary files ')) current.binary = true;
      else if (line.startsWith('+++ ') && line !== '+++ /dev/null') {
        current.path = stripPrefix(line.slice(4));
      }
    }

    const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkHeader !== null) {
      oldLine = Number(hunkHeader[1]);
      newLine = Number(hunkHeader[2]);
      hunk = { header: line, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    const activeHunk = hunk as DiffFile['hunks'][number] | null;
    if (activeHunk === null || line.startsWith('\\')) continue;

    let parsed: DiffLine | null = null;
    if (line.startsWith('+')) {
      parsed = { kind: 'add', oldLine: null, newLine, text: line.slice(1) };
      newLine += 1;
      current.additions += 1;
    } else if (line.startsWith('-')) {
      parsed = { kind: 'delete', oldLine, newLine: null, text: line.slice(1) };
      oldLine += 1;
      current.deletions += 1;
    } else if (line.startsWith(' ')) {
      parsed = { kind: 'context', oldLine, newLine, text: line.slice(1) };
      oldLine += 1;
      newLine += 1;
    }
    if (parsed === null) continue;
    if (lineCount >= MAX_DIFF_LINES_PER_FILE) {
      current.truncated = true;
      continue;
    }
    activeHunk.lines.push(parsed);
    lineCount += 1;
  }
  return files;
}

function parseDiffHeaderPath(line: string): string {
  // "diff --git a/src/app.ts b/src/app.ts": the b/ side is the current path.
  const marker = line.lastIndexOf(' b/');
  return marker === -1 ? line.slice('diff --git '.length) : line.slice(marker + 3);
}

function stripPrefix(pathWithPrefix: string): string {
  return pathWithPrefix.startsWith('b/') ? pathWithPrefix.slice(2) : pathWithPrefix;
}
