import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitTaskWorkspace } from './git-task-workspace';

/** The agent's worktree is untrusted: these cover what an agent could plant there. */
// These tests spawn real git (slow on Windows), so they get more than the default 5 s under load.
describe('GitTaskWorkspace with agent-planted files', { timeout: 30_000 }, () => {
  let rootDirectory: string;
  let repositoryDirectory: string;
  let workspace: GitTaskWorkspace;

  beforeEach(() => {
    rootDirectory = mkdtempSync(path.join(tmpdir(), 'aiteam-git-workspace-'));
    repositoryDirectory = path.join(rootDirectory, 'project');
    mkdirSync(repositoryDirectory);
    // No newlines: git may convert them to CRLF on checkout (core.autocrlf on Windows).
    writeFileSync(path.join(repositoryDirectory, 'a.txt'), 'a');
    writeFileSync(path.join(repositoryDirectory, '[ab].txt'), 'literal');
    workspace = new GitTaskWorkspace({
      version: 'test',
      startedAtEpochMs: 0,
      sessionToken: 'unused',
      listenPort: 0,
      secretKeyFilePath: path.join(rootDirectory, 'secret.key'),
      dataDirectory: path.join(rootDirectory, 'data'),
    });
  });

  afterEach(() => {
    rmSync(rootDirectory, { recursive: true, force: true });
  });

  async function prepare(qaDocuments: Array<{ fileName: string; contentPath: string }> = []) {
    return workspace.prepareTaskWorkspace({
      taskId: 'task-1',
      workingDirectory: repositoryDirectory,
      worktreePath: null,
      qaDocuments,
    });
  }

  it('never runs repository hooks when saving a checkpoint', async () => {
    const { worktreePath } = await prepare();
    const marker = path.join(rootDirectory, 'hook-ran.txt');
    const hookPath = path.join(repositoryDirectory, '.git', 'hooks', 'post-commit');
    writeFileSync(hookPath, `#!/bin/sh\necho ran > "${marker.split(path.sep).join('/')}"\n`);
    chmodSync(hookPath, 0o755);
    writeFileSync(path.join(worktreePath, 'b.txt'), 'b\n');

    expect(await workspace.saveCheckpoint(worktreePath, 'mốc')).not.toBeNull();
    expect(existsSync(marker)).toBe(false);
  });

  it('refuses to open something that is not a regular file', async () => {
    const { worktreePath } = await prepare();
    mkdirSync(path.join(worktreePath, 'docs.md'));

    await expect(workspace.readWorkspaceFile(worktreePath, 'docs.md')).rejects.toMatchObject({
      code: 'WORKSPACE_FILE_NOT_REGULAR',
    });
  });

  it('reverts only the file named, even when the name looks like a glob', async () => {
    const { worktreePath } = await prepare();
    writeFileSync(path.join(worktreePath, 'a.txt'), 'changed a');
    writeFileSync(path.join(worktreePath, '[ab].txt'), 'changed literal');

    await workspace.revertWorkspaceFile(worktreePath, null, '[ab].txt');

    expect(readFileSync(path.join(worktreePath, '[ab].txt'), 'utf8')).toBe('literal');
    expect(readFileSync(path.join(worktreePath, 'a.txt'), 'utf8')).toBe('changed a');
  });

  it('does not copy QA documents through a link the agent put in place of .aiteam-qa', async () => {
    const { worktreePath } = await prepare();
    const outside = path.join(rootDirectory, 'outside');
    mkdirSync(outside);
    // A junction needs no admin rights on Windows; elsewhere the type is ignored (symlink).
    symlinkSync(outside, path.join(worktreePath, '.aiteam-qa'), 'junction');
    const document = path.join(rootDirectory, 'spec.md');
    writeFileSync(document, '# Spec\n');

    const prepared = await workspace.prepareTaskWorkspace({
      taskId: 'task-1',
      workingDirectory: repositoryDirectory,
      worktreePath,
      qaDocuments: [{ fileName: 'spec.md', contentPath: document }],
    });

    expect(existsSync(path.join(outside, 'spec.md'))).toBe(false);
    expect(readFileSync(path.join(worktreePath, '.aiteam-qa', 'spec.md'), 'utf8')).toBe('# Spec\n');
    expect(prepared.qaDocumentPaths).toEqual(['.aiteam-qa/spec.md']);
  });

  it('keeps engine-managed folders out of checkpoints at any depth', async () => {
    const { worktreePath } = await prepare();
    mkdirSync(path.join(worktreePath, 'sub', '_agent', 'plugins', 'p'), { recursive: true });
    mkdirSync(path.join(worktreePath, '.agents'));
    writeFileSync(path.join(worktreePath, '.agents', 'hooks.json'), '{}');
    writeFileSync(path.join(worktreePath, 'sub', '_agent', 'plugins', 'p', 'hooks.json'), '{}');
    mkdirSync(path.join(worktreePath, '.Gemini'));
    writeFileSync(path.join(worktreePath, '.Gemini', 'x'), '{}');
    // A rule the agent wrote must not bring the folders back.
    writeFileSync(path.join(worktreePath, '.gitignore'), '!.agents/\n!_agent/\n');
    writeFileSync(path.join(worktreePath, 'normal.txt'), 'n');

    expect(await workspace.saveCheckpoint(worktreePath, 'mốc')).not.toBeNull();

    const tracked = execFileSync('git', ['-C', worktreePath, 'ls-files'], { encoding: 'utf8' });
    expect(tracked).toContain('normal.txt');
    expect(tracked).not.toContain('hooks.json');
    expect(tracked.toLowerCase()).not.toContain('.gemini');
    // Nothing leaks into the exclude file shared with the user's own checkout.
    const exclude = path.join(repositoryDirectory, '.git', 'info', 'exclude');
    const excludeText = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    for (const name of ['.agents', '.agent', '_agents', '_agent', '.gemini']) {
      expect(excludeText).not.toContain(name);
    }
  });

  it('keeps bare files named like managed folders out of checkpoints, and normal names in', async () => {
    const { worktreePath } = await prepare();
    writeFileSync(path.join(worktreePath, '.gemini'), 'file');
    mkdirSync(path.join(worktreePath, 'sub'));
    writeFileSync(path.join(worktreePath, 'sub', '_agent'), 'file');
    writeFileSync(path.join(worktreePath, 'my.agents.txt'), 'n');
    mkdirSync(path.join(worktreePath, 'agents'));
    writeFileSync(path.join(worktreePath, 'agents', 'a.md'), 'n');

    expect(await workspace.saveCheckpoint(worktreePath, 'mốc')).not.toBeNull();

    const tracked = execFileSync('git', ['-C', worktreePath, 'ls-files'], { encoding: 'utf8' })
      .split(String.fromCharCode(10))
      .filter((line) => line !== '');
    expect(tracked).toEqual(expect.arrayContaining(['my.agents.txt', 'agents/a.md']));
    expect(tracked).not.toContain('.gemini');
    expect(tracked).not.toContain('sub/_agent');
  });

  it('lists the new engine-managed paths that checkpoints leave out (capped at 20)', async () => {
    const { worktreePath } = await prepare();
    expect(await workspace.listUncommittedEngineManagedPaths(worktreePath)).toEqual({
      paths: [],
      total: 0,
    });
    mkdirSync(path.join(worktreePath, '.agents', 'skills', 'foo'), { recursive: true });
    writeFileSync(path.join(worktreePath, '.agents', 'skills', 'foo', 'SKILL.md'), 's');
    mkdirSync(path.join(worktreePath, 'sub'));
    writeFileSync(path.join(worktreePath, 'sub', '_agent'), 'file');
    writeFileSync(path.join(worktreePath, '.gemini'), 'file');
    writeFileSync(path.join(worktreePath, 'my.agents.txt'), 'n');

    expect(await workspace.listUncommittedEngineManagedPaths(worktreePath)).toEqual({
      paths: ['.agents/skills/foo/SKILL.md', '.gemini', 'sub/_agent'],
      total: 3,
    });

    mkdirSync(path.join(worktreePath, '_agents'));
    for (let index = 0; index < 30; index += 1) {
      writeFileSync(path.join(worktreePath, '_agents', `f${index}.md`), 'x');
    }
    const capped = await workspace.listUncommittedEngineManagedPaths(worktreePath);
    expect(capped.paths).toHaveLength(20);
    expect(capped.total).toBe(33);
  });

  it('still excludes managed folders when the environment forces literal pathspecs', async () => {
    const { worktreePath } = await prepare();
    mkdirSync(path.join(worktreePath, '.agents'));
    writeFileSync(path.join(worktreePath, '.agents', 'hooks.json'), '{}');
    writeFileSync(path.join(worktreePath, 'normal.txt'), 'n');
    const previous = process.env.GIT_LITERAL_PATHSPECS;
    process.env.GIT_LITERAL_PATHSPECS = '1';
    try {
      expect(await workspace.saveCheckpoint(worktreePath, 'mốc')).not.toBeNull();
    } finally {
      if (previous === undefined) delete process.env.GIT_LITERAL_PATHSPECS;
      else process.env.GIT_LITERAL_PATHSPECS = previous;
    }

    const tracked = execFileSync('git', ['-C', worktreePath, 'ls-files'], { encoding: 'utf8' });
    expect(tracked).toContain('normal.txt');
    expect(tracked).not.toContain('hooks.json');
  });

  it('keeps checkpointing files the project already tracks under managed names', async () => {
    mkdirSync(path.join(repositoryDirectory, '.gemini'));
    writeFileSync(path.join(repositoryDirectory, '.gemini', 'settings.json'), 'old');
    mkdirSync(path.join(repositoryDirectory, '.agents', 'skills'), { recursive: true });
    writeFileSync(path.join(repositoryDirectory, '.agents', 'skills', 'x.md'), 'x');
    const { worktreePath } = await prepare();
    writeFileSync(path.join(worktreePath, '.gemini', 'settings.json'), 'new');
    rmSync(path.join(worktreePath, '.agents', 'skills', 'x.md'));
    writeFileSync(path.join(worktreePath, '.agents', 'hooks.json'), '{}');
    writeFileSync(path.join(worktreePath, 'normal.txt'), 'n');

    expect(await workspace.saveCheckpoint(worktreePath, 'mốc')).not.toBeNull();

    const changed = execFileSync(
      'git',
      ['-C', worktreePath, 'show', '--name-status', '--format=', 'HEAD'],
      { encoding: 'utf8' },
    );
    expect(changed).toMatch(/M\s+\.gemini\/settings\.json/);
    expect(changed).toMatch(/D\s+\.agents\/skills\/x\.md/);
    expect(changed).toContain('normal.txt');
    expect(changed).not.toContain('hooks.json');
  });

  describe('in a repository without tracked files (task without a chosen folder)', () => {
    function prepareWithoutFolder() {
      return workspace.prepareTaskWorkspace({
        taskId: 'task-empty',
        workingDirectory: null,
        worktreePath: null,
        qaDocuments: [],
      });
    }

    function listTracked(worktreePath: string): string {
      return execFileSync('git', ['-C', worktreePath, 'ls-files'], { encoding: 'utf8' });
    }

    it('checkpoints a file the agent created', async () => {
      const { worktreePath } = await prepareWithoutFolder();
      writeFileSync(path.join(worktreePath, 'hello.txt'), 'hi');

      expect(await workspace.saveCheckpoint(worktreePath, 'mốc')).not.toBeNull();
      expect(listTracked(worktreePath)).toContain('hello.txt');
    });

    it('commits nothing when only an engine-managed folder was created', async () => {
      const { worktreePath } = await prepareWithoutFolder();
      mkdirSync(path.join(worktreePath, '.agents'));
      writeFileSync(path.join(worktreePath, '.agents', 'hooks.json'), '{}');

      expect(await workspace.saveCheckpoint(worktreePath, 'mốc')).toBeNull();
      expect(listTracked(worktreePath)).not.toContain('hooks.json');
    });

    it('returns null when nothing changed', async () => {
      const { worktreePath } = await prepareWithoutFolder();

      expect(await workspace.saveCheckpoint(worktreePath, 'mốc')).toBeNull();
    });
  });
  describe('code tree and knowledge folder', () => {
    function git(args: string[]): string {
      return execFileSync(
        'git',
        ['-C', repositoryDirectory, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
        { encoding: 'utf8' },
      ).trim();
    }

    /** A repository whose HEAD also holds a symlink and a submodule entry (on every OS). */
    function commitSourceTree(): void {
      mkdirSync(path.join(repositoryDirectory, 'src'));
      writeFileSync(path.join(repositoryDirectory, 'src', 'a.ts'), "import { b } from './b';");
      writeFileSync(path.join(repositoryDirectory, 'src', 'b.ts'), 'export const b = 1;');
      writeFileSync(path.join(repositoryDirectory, 'package.json'), '{"name":"p"}');
      writeFileSync(path.join(repositoryDirectory, 'notes.md'), '# notes');
      writeFileSync(path.join(repositoryDirectory, 'big.ts'), 'x'.repeat(256 * 1024 + 1));
      git(['init', '-q']);
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'first']);
      const head = git(['rev-parse', 'HEAD']);
      const linkSha = execFileSync(
        'git',
        ['-C', repositoryDirectory, 'hash-object', '-w', '--stdin'],
        { input: 'src/a.ts', encoding: 'utf8' },
      ).trim();
      git(['update-index', '--add', '--cacheinfo', `120000,${linkSha},link.ts`]);
      git(['update-index', '--add', '--cacheinfo', `160000,${head},vendor/sub`]);
      git(['commit', '-q', '-m', 'links']);
    }

    it('lists only small regular source files and reads their text', async () => {
      commitSourceTree();
      const { worktreePath } = await prepare();

      const tree = await workspace.readCodeTree(worktreePath, new Map());

      expect(tree.map((entry) => entry.path)).toEqual(['package.json', 'src/a.ts', 'src/b.ts']);
      expect(tree.find((entry) => entry.path === 'src/a.ts')?.text).toBe(
        "import { b } from './b';",
      );
      expect(tree.every((entry) => /^[0-9a-f]{40,64}$/.test(entry.blobSha))).toBe(true);
    });

    it('does not read blobs it already knows', async () => {
      commitSourceTree();
      const { worktreePath } = await prepare();
      const first = await workspace.readCodeTree(worktreePath, new Map());

      const second = await workspace.readCodeTree(
        worktreePath,
        new Map(first.map((entry) => [entry.path, entry.blobSha])),
      );

      expect(second.map((entry) => entry.path)).toEqual(first.map((entry) => entry.path));
      expect(second.every((entry) => entry.text === null)).toBe(true);
    });

    it('gives a binary source file empty text', async () => {
      writeFileSync(path.join(repositoryDirectory, 'bin.js'), Buffer.from([0x61, 0, 0x62]));
      const { worktreePath } = await prepare();

      expect(await workspace.readCodeTree(worktreePath, new Map())).toEqual([
        expect.objectContaining({ path: 'bin.js', text: '' }),
      ]);
    });

    it('rejects instead of crashing when git exits before reading every blob sha', async () => {
      // Regression: without a stdin error listener the EPIPE/EOF was an uncaughtException.
      const readGitBlobs = (
        workspace as unknown as {
          readGitBlobs(directory: string, shas: string[]): Promise<Map<string, Buffer>>;
        }
      ).readGitBlobs.bind(workspace);
      const shas = Array.from({ length: 5000 }, (_, index) => index.toString(16).padStart(40, '0'));

      await expect(readGitBlobs(path.join(rootDirectory, 'missing'), shas)).rejects.toMatchObject({
        code: 'GIT_COMMAND_FAILED',
      });
    });

    it('writes the knowledge folder out of git and removes a planted junction', async () => {
      const { worktreePath } = await prepare();
      const outside = path.join(rootDirectory, 'outside');
      mkdirSync(outside);
      symlinkSync(outside, path.join(worktreePath, '.aiteam-knowledge'), 'junction');

      expect(
        await workspace.replaceKnowledgeFolder(worktreePath, worktreePath, {
          lessonsMarkdown: 'L',
          codeMapMarkdown: 'C',
        }),
      ).toBe('.aiteam-knowledge');

      expect(existsSync(path.join(outside, 'lessons.md'))).toBe(false);
      const folder = path.join(worktreePath, '.aiteam-knowledge');
      expect(readFileSync(path.join(folder, 'lessons.md'), 'utf8')).toBe('L');
      expect(readFileSync(path.join(folder, 'code-map.md'), 'utf8')).toBe('C');
      expect(await workspace.saveCheckpoint(worktreePath, 'm')).toBeNull();
    });

    it('removes the folder when there is no knowledge', async () => {
      const { worktreePath } = await prepare();
      await workspace.replaceKnowledgeFolder(worktreePath, worktreePath, {
        lessonsMarkdown: 'L',
        codeMapMarkdown: 'C',
      });

      expect(await workspace.replaceKnowledgeFolder(worktreePath, worktreePath, null)).toBeNull();
      expect(existsSync(path.join(worktreePath, '.aiteam-knowledge'))).toBe(false);
    });

    it('gives a forked task the parent repository root', async () => {
      const parent = await workspace.prepareTaskWorkspace({
        taskId: 'task-1',
        workingDirectory: null,
        worktreePath: null,
        qaDocuments: [],
      });
      const child = await workspace.prepareTaskWorkspace({
        taskId: 'task-2',
        workingDirectory: null,
        worktreePath: null,
        qaDocuments: [],
        forkFromTaskId: 'task-1',
      });

      expect(child.repositoryRoot).toBe(parent.repositoryRoot);
      expect(parent.repositoryRoot).toBe(
        path.join(rootDirectory, 'data', 'task-folders', 'task-1'),
      );
    });
  });
});
