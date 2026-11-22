import { Inject, Injectable } from '@nestjs/common';
import type { AgentProvider } from '@aiteam/contracts';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import {
  CHECKPOINT_REPOSITORY,
  type CheckpointRepository,
} from '../../domain/repositories/checkpoint.repository';
import type { StepKnowledge } from '../../domain/step-prompt';
import {
  TASK_KNOWLEDGE,
  TASK_WORKSPACE,
  type PreparedTaskWorkspace,
  type TaskKnowledge,
  type TaskWorkspace,
} from '../ports/task-execution.ports';

const RELATED_CHECKPOINTS = 5;
const RELATED_PATHS_MAX = 30;

/**
 * The project's knowledge for a turn: refreshes the code index from the worktree's HEAD, picks
 * what fits the task and writes .aiteam-knowledge/. Knowledge is extra: on any failure the turn
 * runs without it.
 */
@Injectable()
export class TaskKnowledgeBriefer {
  constructor(
    @Inject(TASK_WORKSPACE) private readonly taskWorkspace: TaskWorkspace,
    @Inject(TASK_KNOWLEDGE) private readonly knowledge: TaskKnowledge,
    @Inject(CHECKPOINT_REPOSITORY) private readonly checkpointRepository: CheckpointRepository,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  async prepareTurnKnowledge(input: {
    taskId: string;
    title: string;
    description: string;
    stepName: string | null;
    feedback: string | null;
    provider: AgentProvider;
    workspace: PreparedTaskWorkspace;
  }): Promise<StepKnowledge | null> {
    const { worktreePath, agentDirectory, repositoryRoot } = input.workspace;
    try {
      await this.knowledge.refreshCodeIndex(repositoryRoot, (knownShas) =>
        this.taskWorkspace.readCodeTree(worktreePath, knownShas),
      );
      const briefing = this.knowledge.describeTaskKnowledge({
        projectKey: repositoryRoot,
        keywords: [input.title, input.description, input.stepName ?? '', input.feedback ?? ''],
        relatedPaths: this.listRecentlyChangedPaths(input.taskId),
      });
      // A Custom API agent cannot open files.
      const folder = await this.taskWorkspace.replaceKnowledgeFolder(
        worktreePath,
        agentDirectory,
        input.provider === 'custom_api' || briefing.promptSection === null
          ? null
          : {
              lessonsMarkdown: briefing.lessonsMarkdown,
              codeMapMarkdown: briefing.codeMapMarkdown,
            },
      );
      return briefing.promptSection === null ? null : { briefing: briefing.promptSection, folder };
    } catch (error) {
      this.logger.warn({ err: error, taskId: input.taskId }, 'task knowledge unavailable');
      return null;
    }
  }

  /** For a superior's review: the prompt section only, from the index as it is. */
  describeReviewKnowledge(input: {
    taskId: string;
    repositoryRoot: string | null;
    title: string;
    description: string;
    stepName: string;
    workerSummary: string;
  }): string | null {
    if (input.repositoryRoot === null) return null;
    try {
      return this.knowledge.describeTaskKnowledge({
        projectKey: input.repositoryRoot,
        keywords: [input.title, input.description, input.stepName, input.workerSummary],
        relatedPaths: this.listRecentlyChangedPaths(input.taskId),
      }).promptSection;
    } catch (error) {
      this.logger.warn({ err: error, taskId: input.taskId }, 'task knowledge unavailable');
      return null;
    }
  }

  /** Files of the task's newest checkpoints. */
  private listRecentlyChangedPaths(taskId: string): string[] {
    const paths = this.checkpointRepository
      .listCheckpoints(taskId)
      .slice(0, RELATED_CHECKPOINTS)
      .flatMap((checkpoint) => checkpoint.files);
    return [...new Set(paths)].slice(0, RELATED_PATHS_MAX);
  }
}
