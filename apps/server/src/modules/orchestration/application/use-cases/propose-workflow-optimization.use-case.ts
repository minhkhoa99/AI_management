import { Inject, Injectable } from '@nestjs/common';
import type { ProposeWorkflowOptimizationRequest, WorkflowProposal } from '@aiteam/contracts';
import { ValidationError } from '../../../../shared/errors/app-error';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import { requireDepartment } from '../../../departments/application/use-cases/department-lookup';
import {
  DEPARTMENT_REPOSITORY,
  type DepartmentRepository,
} from '../../../departments/domain/repositories/department.repository';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepository,
} from '../../domain/repositories/workflow.repository';
import { summarizeWorkflowRuns } from '../../domain/workflow-run-stats';
import {
  TASK_EVENT_LOG,
  TASK_KNOWLEDGE,
  type TaskEventLog,
  type TaskKnowledge,
} from '../ports/task-execution.ports';
import {
  WORKFLOW_RUN_HISTORY_QUERY,
  type WorkflowRunHistoryQuery,
} from '../ports/workflow-run-history.query';
import { requireWorkflow } from './workflow-lookup';
import { WorkflowProposalAuthor } from './workflow-proposal-author';

/** Below this, statistics say nothing: refused before spending tokens. */
const MIN_FINISHED_TASKS = 5;
const FREQUENT_LESSONS_MAX = 10;

/** AI suggests a better chain from the workflow's recent runs; nothing is saved. */
@Injectable()
export class ProposeWorkflowOptimizationUseCase {
  constructor(
    @Inject(WORKFLOW_REPOSITORY) private readonly workflowRepository: WorkflowRepository,
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    @Inject(WORKFLOW_RUN_HISTORY_QUERY) private readonly runHistoryQuery: WorkflowRunHistoryQuery,
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_KNOWLEDGE) private readonly knowledge: TaskKnowledge,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
    private readonly proposalAuthor: WorkflowProposalAuthor,
  ) {}

  async proposeWorkflowOptimization(
    workflowId: string,
    request: ProposeWorkflowOptimizationRequest,
  ): Promise<WorkflowProposal> {
    const workflow = requireWorkflow(this.workflowRepository, workflowId);
    this.eventLog.flushPendingEvents();
    const history = this.runHistoryQuery.listWorkflowRunHistory(workflowId);
    if (history.finishedTaskCount < MIN_FINISHED_TASKS) {
      throw new ValidationError('Cần ít nhất 5 task đã kết thúc theo quy trình này để AI tối ưu.', {
        code: 'WORKFLOW_STATS_TOO_FEW',
      });
    }
    const department = requireDepartment(this.departmentRepository, workflow.departmentId);
    const proposal = await this.proposalAuthor.writeWorkflowProposal({
      departmentId: workflow.departmentId,
      departmentName: department.name,
      agentId: request.agentId,
      mode: {
        kind: 'optimize',
        workflowName: workflow.name,
        steps: workflow.steps,
        stats: summarizeWorkflowRuns(workflow.steps, history.events),
        frequentLessons: this.listFrequentLessons(workflow.departmentId),
      },
    });
    return { ...proposal, basedOnTaskCount: history.finishedTaskCount };
  }

  /** Lessons of the repository the department last worked in; knowledge is extra. */
  private listFrequentLessons(departmentId: string): string[] {
    try {
      const repositoryRoot = this.taskRepository.findLatestRepositoryRoot(departmentId);
      return repositoryRoot === null
        ? []
        : this.knowledge.listFrequentLessons(repositoryRoot, FREQUENT_LESSONS_MAX);
    } catch (error) {
      this.logger.warn({ err: error, departmentId }, 'frequent lessons unavailable');
      return [];
    }
  }
}
