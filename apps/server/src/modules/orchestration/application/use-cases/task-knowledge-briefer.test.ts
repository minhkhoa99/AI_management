import { describe, expect, it, vi } from 'vitest';
import type { AgentProvider } from '@aiteam/contracts';
import { TaskKnowledgeBriefer } from './task-knowledge-briefer';

const WORKSPACE = {
  worktreePath: '/wt',
  agentDirectory: '/wt/shop',
  qaDocumentPaths: [],
  skillManifestPaths: new Map<string, string>(),
  baseSha: null,
  repositoryRoot: '/repo',
};

const BRIEFING = {
  promptSection: 'Bản đồ code liên quan:\n- src/a.ts | export: login',
  lessonsMarkdown: '# lessons\n',
  codeMapMarkdown: '# map\n',
};

function buildBriefer(options: {
  readCodeTree?: () => Promise<unknown>;
  checkpointFiles?: string[][];
  promptSection?: string | null;
}) {
  const taskWorkspace = {
    readCodeTree: vi.fn(options.readCodeTree ?? (() => Promise.resolve([]))),
    replaceKnowledgeFolder: vi.fn((_root: string, _dir: string, files: unknown) =>
      Promise.resolve(files === null ? null : '.aiteam-knowledge'),
    ),
  };
  const knowledge = {
    refreshCodeIndex: vi.fn(
      async (_key: string, readTree: (known: Map<string, string>) => Promise<unknown>) => {
        await readTree(new Map());
      },
    ),
    describeTaskKnowledge: vi.fn(() => ({
      ...BRIEFING,
      promptSection:
        options.promptSection === undefined ? BRIEFING.promptSection : options.promptSection,
    })),
  };
  const checkpointRepository = {
    listCheckpoints: vi.fn(() => (options.checkpointFiles ?? []).map((files) => ({ files }))),
  };
  const logger = { warn: vi.fn() };
  const briefer = new TaskKnowledgeBriefer(
    taskWorkspace as never,
    knowledge as never,
    checkpointRepository as never,
    logger as never,
  );
  return { briefer, taskWorkspace, knowledge, logger };
}

const turnInput = (provider: AgentProvider = 'claude_code') => ({
  taskId: 'task-1',
  title: 'API đăng nhập',
  description: 'Dùng JWT',
  stepName: 'Phát triển',
  feedback: 'Sai mật khẩu',
  provider,
  workspace: WORKSPACE,
});

describe('TaskKnowledgeBriefer.prepareTurnKnowledge', () => {
  it('runs the turn without knowledge when git fails', async () => {
    const failure = new Error('git ls-tree failed');
    const { briefer, taskWorkspace, knowledge, logger } = buildBriefer({
      readCodeTree: () => Promise.reject(failure),
    });

    await expect(briefer.prepareTurnKnowledge(turnInput())).resolves.toBeNull();

    expect(taskWorkspace.readCodeTree).toHaveBeenCalledWith('/wt', expect.any(Map));
    expect(knowledge.describeTaskKnowledge).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure, taskId: 'task-1' }),
      'task knowledge unavailable',
    );
  });

  it('passes files of the 5 newest checkpoints as related paths (at most 30)', async () => {
    const few = buildBriefer({
      checkpointFiles: [0, 1, 2, 3, 4, 5].map((index) => [`c${index}.ts`, 'shared.ts']),
    });
    const many = buildBriefer({
      checkpointFiles: [0, 1, 2, 3, 4].map((index) =>
        Array.from({ length: 10 }, (_, file) => `c${index}-${file}.ts`),
      ),
    });

    await few.briefer.prepareTurnKnowledge(turnInput());
    await many.briefer.prepareTurnKnowledge(turnInput());

    expect(few.knowledge.describeTaskKnowledge).toHaveBeenCalledWith({
      projectKey: '/repo',
      keywords: ['API đăng nhập', 'Dùng JWT', 'Phát triển', 'Sai mật khẩu'],
      relatedPaths: ['c0.ts', 'shared.ts', 'c1.ts', 'c2.ts', 'c3.ts', 'c4.ts'],
    });
    const call = many.knowledge.describeTaskKnowledge.mock.calls[0] as unknown as [
      { relatedPaths: string[] },
    ];
    expect(call[0].relatedPaths).toHaveLength(30);
    expect(call[0].relatedPaths.at(-1)).toBe('c2-9.ts');
  });

  it('gives a Custom API agent the prompt section but no folder', async () => {
    const { briefer, taskWorkspace } = buildBriefer({});

    const knowledge = await briefer.prepareTurnKnowledge(turnInput('custom_api'));

    expect(taskWorkspace.replaceKnowledgeFolder).toHaveBeenCalledWith('/wt', '/wt/shop', null);
    expect(knowledge).toEqual({ briefing: BRIEFING.promptSection, folder: null });
  });

  it('writes the folder for other agents, and gives nothing when nothing is relevant', async () => {
    const relevant = buildBriefer({});
    const empty = buildBriefer({ promptSection: null });

    const knowledge = await relevant.briefer.prepareTurnKnowledge(turnInput());
    const nothing = await empty.briefer.prepareTurnKnowledge(turnInput());

    expect(relevant.taskWorkspace.replaceKnowledgeFolder).toHaveBeenCalledWith('/wt', '/wt/shop', {
      lessonsMarkdown: BRIEFING.lessonsMarkdown,
      codeMapMarkdown: BRIEFING.codeMapMarkdown,
    });
    expect(knowledge).toEqual({ briefing: BRIEFING.promptSection, folder: '.aiteam-knowledge' });
    expect(empty.taskWorkspace.replaceKnowledgeFolder).toHaveBeenCalledWith(
      '/wt',
      '/wt/shop',
      null,
    );
    expect(nothing).toBeNull();
  });
});

describe('TaskKnowledgeBriefer.describeReviewKnowledge', () => {
  const reviewInput = {
    taskId: 'task-1',
    title: 'API đăng nhập',
    description: '',
    stepName: 'Phát triển',
    workerSummary: 'Đã thêm login',
  };

  it('describes the repository knowledge, or nothing without a repository', () => {
    const { briefer, knowledge } = buildBriefer({ checkpointFiles: [['src/a.ts']] });

    expect(briefer.describeReviewKnowledge({ ...reviewInput, repositoryRoot: '/repo' })).toBe(
      BRIEFING.promptSection,
    );
    expect(briefer.describeReviewKnowledge({ ...reviewInput, repositoryRoot: null })).toBeNull();
    expect(knowledge.describeTaskKnowledge).toHaveBeenCalledTimes(1);
    expect(knowledge.describeTaskKnowledge).toHaveBeenCalledWith({
      projectKey: '/repo',
      keywords: ['API đăng nhập', '', 'Phát triển', 'Đã thêm login'],
      relatedPaths: ['src/a.ts'],
    });
  });

  it('gives no knowledge when the index cannot be read', () => {
    const { briefer, knowledge, logger } = buildBriefer({});
    const failure = new Error('database is locked');
    knowledge.describeTaskKnowledge.mockImplementation(() => {
      throw failure;
    });

    expect(briefer.describeReviewKnowledge({ ...reviewInput, repositoryRoot: '/repo' })).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure, taskId: 'task-1' }),
      'task knowledge unavailable',
    );
  });
});
