import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readClaudeProjectInstructions } from './claude-project-instructions';

describe('readClaudeProjectInstructions', () => {
  let repositoryRoot: string;

  beforeEach(() => {
    repositoryRoot = mkdtempSync(path.join(tmpdir(), 'aiteam-claude-md-'));
    // A worktree has a .git file pointing at the main repository.
    writeFileSync(path.join(repositoryRoot, '.git'), 'gitdir: elsewhere\n');
  });

  afterEach(() => {
    rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it('collects CLAUDE.md from the repository root down to the working folder', () => {
    const appFolder = path.join(repositoryRoot, 'apps', 'web');
    mkdirSync(appFolder, { recursive: true });
    writeFileSync(path.join(repositoryRoot, 'CLAUDE.md'), 'Quy tắc chung');
    writeFileSync(path.join(appFolder, 'CLAUDE.md'), 'Quy tắc web');

    const instructions = readClaudeProjectInstructions(appFolder) ?? '';

    expect(instructions).toContain('--- CLAUDE.md ---\nQuy tắc chung');
    expect(instructions).toContain('--- apps/web/CLAUDE.md ---\nQuy tắc web');
    expect(instructions.indexOf('Quy tắc chung')).toBeLessThan(instructions.indexOf('Quy tắc web'));
  });

  it('returns null when the project has no CLAUDE.md', () => {
    expect(readClaudeProjectInstructions(repositoryRoot)).toBeNull();
  });

  it('caps a huge file', () => {
    writeFileSync(path.join(repositoryRoot, 'CLAUDE.md'), 'x'.repeat(100_000));

    expect((readClaudeProjectInstructions(repositoryRoot) ?? '').length).toBeLessThan(20_000);
  });

  it('ignores a CLAUDE.md symlink an agent could point anywhere', (context) => {
    const outside = path.join(repositoryRoot, '..', `outside-${path.basename(repositoryRoot)}.txt`);
    writeFileSync(outside, 'bí mật');
    try {
      symlinkSync(outside, path.join(repositoryRoot, 'CLAUDE.md'));
    } catch {
      rmSync(outside, { force: true });
      context.skip(); // Windows without symlink rights.
      return;
    }
    try {
      expect(readClaudeProjectInstructions(repositoryRoot)).toBeNull();
    } finally {
      rmSync(outside, { force: true });
    }
  });
});
