import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './unified-diff';

const PATCH = [
  'diff --git a/src/login.ts b/src/login.ts',
  'index 1111111..2222222 100644',
  '--- a/src/login.ts',
  '+++ b/src/login.ts',
  '@@ -1,4 +1,5 @@',
  ' import { hash } from "./hash";',
  '-export function login(user) {',
  '+export function login(user: User) {',
  '+  // kiểm tra mật khẩu',
  '   return hash(user);',
  ' }',
  '\\ No newline at end of file',
  'diff --git a/README.md b/docs/README.md',
  'similarity index 90%',
  'rename from README.md',
  'rename to docs/README.md',
  'diff --git a/new.txt b/new.txt',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/new.txt',
  '@@ -0,0 +1 @@',
  '+xin chào',
  'diff --git a/logo.png b/logo.png',
  'Binary files a/logo.png and b/logo.png differ',
].join('\n');

describe('parseUnifiedDiff', () => {
  it('numbers old and new lines and counts additions and deletions', () => {
    const [login] = parseUnifiedDiff(PATCH);

    expect(login).toMatchObject({
      path: 'src/login.ts',
      change: 'modified',
      additions: 2,
      deletions: 1,
    });
    expect(login?.hunks[0]?.lines).toEqual([
      { kind: 'context', oldLine: 1, newLine: 1, text: 'import { hash } from "./hash";' },
      { kind: 'delete', oldLine: 2, newLine: null, text: 'export function login(user) {' },
      { kind: 'add', oldLine: null, newLine: 2, text: 'export function login(user: User) {' },
      { kind: 'add', oldLine: null, newLine: 3, text: '  // kiểm tra mật khẩu' },
      { kind: 'context', oldLine: 3, newLine: 4, text: '  return hash(user);' },
      { kind: 'context', oldLine: 4, newLine: 5, text: '}' },
    ]);
  });

  it('recognises renames, new files and binary files', () => {
    const [, renamed, added, binary] = parseUnifiedDiff(PATCH);

    expect(renamed).toMatchObject({
      path: 'docs/README.md',
      oldPath: 'README.md',
      change: 'renamed',
      hunks: [],
    });
    expect(added).toMatchObject({ path: 'new.txt', change: 'added', additions: 1 });
    expect(binary).toMatchObject({ path: 'logo.png', binary: true });
  });

  it('returns nothing for an empty patch', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
