import { Inject, Injectable } from '@nestjs/common';
import { buildCompletionGoal } from '@aiteam/contracts';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import { AgentSessionSupervisor } from '../../../../shared/runtime/agent-session-supervisor';
import { type EngineSnapshot, formatTaskCode, type Task } from '../../domain/entities/task';
import type { WorkflowStepState } from '../../domain/entities/workflow';
import {
  TASK_ATTACHMENT_REPOSITORY,
  type TaskAttachmentRepository,
} from '../../domain/repositories/task-attachment.repository';
import {
  TASK_DELEGATION_REPOSITORY,
  type TaskDelegationRepository,
} from '../../domain/repositories/task-delegation.repository';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { ROLE_LABELS_FOR_PROMPTS } from '../../domain/role-labels';
import { chooseStepAgent } from '../../domain/step-assignee';
import { buildStepPrompt, type StepPromptInput } from '../../domain/step-prompt';
import {
  AGENT_RUN_PREPARER,
  STAFF_DIRECTORY,
  TASK_EVENT_LOG,
  TASK_WORKSPACE,
  AGENT_SKILL_SOURCE,
  type AgentSkillFolder,
  type AgentSkillSource,
  type AgentRunPreparer,
  type PreparedAgentRun,
  type StaffDirectory,
  type TaskEventLog,
  type TaskWorkspace,
} from '../ports/task-execution.ports';
import { ApprovalRequests } from './approval-requests';
import { FinishTaskTurnUseCase } from './finish-task-turn.use-case';
import { SessionEventRecorder } from './session-event-recorder';
import { TaskProgression } from './task-progression';
import { TaskSplitter } from './task-splitter';
import { TaskRunRegistry } from './task-run-registry';

const NO_AGENT_RETRY_DELAY_MS = 60_000;
/** Per skill, for Custom API agents that get the text in the prompt. */
const INLINE_SKILL_MAX_LENGTH = 12_000;

/**
 * Starts the next turn of a queued task: picks the step and the agent that does it, prepares the
 * task's git worktree, builds the prompt and runs the agent session under the supervisor.
 */
@Injectable()
export class StartTaskTurnUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: TaskAttachmentRepository,
    @Inject(TASK_DELEGATION_REPOSITORY)
    private readonly delegationRepository: TaskDelegationRepository,
    @Inject(STAFF_DIRECTORY) private readonly staffDirectory: StaffDirectory,
    @Inject(TASK_WORKSPACE) private readonly taskWorkspace: TaskWorkspace,
    @Inject(AGENT_SKILL_SOURCE) private readonly skillSource: AgentSkillSource,
    @Inject(AGENT_RUN_PREPARER) private readonly runPreparer: AgentRunPreparer,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
    private readonly sessionSupervisor: AgentSessionSupervisor,
    private readonly runRegistry: TaskRunRegistry,
    private readonly progression: TaskProgression,
    private readonly approvalRequests: ApprovalRequests,
    private readonly sessionEventRecorder: SessionEventRecorder,
    private readonly finishTaskTurnUseCase: FinishTaskTurnUseCase,
    private readonly taskSplitter: TaskSplitter,
  ) {}

  /** Never rejects: whatever goes wrong fails this task only. */
  async startTaskTurn(taskId: string): Promise<void> {
    try {
      await this.beginTurn(taskId);
    } catch (error) {
      this.logger.error({ err: error, taskId }, 'task turn could not start');
      this.runRegistry.releaseRun(taskId);
      const task = this.taskRepository.findTaskById(taskId);
      if (task !== undefined && !task.isFinished) {
        task.fail(`Không bắt đầu được: ${error instanceof Error ? error.message : String(error)}`);
        this.taskRepository.updateTask(task);
      }
    }
  }

  private async beginTurn(taskId: string): Promise<void> {
    const task = this.taskRepository.findTaskById(taskId);
    if (task === undefined || task.status !== 'queued' || this.runRegistry.isRunning(taskId)) {
      return;
    }
    const state = task.toState();
    const route = this.progression.resolveTaskRoute(state.workflowId);
    const stepIndex =
      route === null
        ? -1
        : Math.max(
            0,
            route.steps.findIndex((step) => step.id === state.currentStepId),
          );
    const step = route?.steps[stepIndex];

    if (step?.ownerRole === 'user') {
      this.askUserForStep(task, step);
      return;
    }

    const staff = this.staffDirectory.listDepartmentStaff(state.departmentId);
    const role =
      step === undefined
        ? staff.find((member) => member.agentId === state.assigneeAgentId)?.role
        : step.ownerRole;
    if (role === undefined) {
      task.fail('Người nhận task không còn trong phòng.');
      this.taskRepository.updateTask(task);
      return;
    }
    const agentId = chooseStepAgent({
      role,
      staff,
      currentAssigneeId: state.assigneeAgentId,
      activeTaskCountByAgent: this.staffDirectory.countActiveTasksByAgent(state.departmentId),
    });
    const snapshot = agentId === null ? undefined : this.staffDirectory.readEngineSnapshot(agentId);
    if (snapshot === undefined) {
      task.requeue({
        stepId: step?.id ?? null,
        retriesUsed: state.stepAttempt,
        runAfter: new Date(Date.now() + NO_AGENT_RETRY_DELAY_MS).toISOString(),
        note: `Chờ một agent ${ROLE_LABELS_FOR_PROMPTS[role]} đang bật trong phòng.`,
      });
      this.taskRepository.updateTask(task);
      return;
    }

    const prepared = this.runPreparer.prepareAgentRun(snapshot);
    if (snapshot.agentId !== state.assigneeAgentId) {
      this.delegationRepository.recordDelegation({
        id: this.idGenerator.generateId(),
        taskId,
        fromAgentId: state.assigneeAgentId,
        toAgentId: snapshot.agentId,
        reason: 'workflow_step',
      });
    }
    const resumeSessionRef = canResumeSession(state.engineSnapshot, snapshot)
      ? state.sessionRef
      : null;
    task.startTurn(step?.id ?? null, snapshot);
    if (resumeSessionRef === null && state.sessionRef !== null) {
      task.forgetEngineSession(
        'Bộ não hoặc kết nối của bạn vừa đổi: phiên trước không tiếp tục được. Dựa vào kết quả các bước trước để làm tiếp.',
      );
    }
    const feedback = task.consumeFeedback();
    this.taskRepository.updateTask(task);
    this.runRegistry.reserveRun(taskId, snapshot.agentId, 'turn');

    const skills = this.skillSource.listAgentSkillFolders(snapshot.agentId);
    const workspace = await this.taskWorkspace.prepareTaskWorkspace({
      taskId,
      workingDirectory: state.workingDirectory,
      worktreePath: state.worktreePath,
      qaDocuments: this.attachmentRepository.listAttachments(taskId),
      forkFromTaskId: state.parentTaskId,
      skills,
    });
    const current = this.taskRepository.findTaskById(taskId);
    if (current === undefined) {
      this.runRegistry.releaseRun(taskId);
      return;
    }
    current.rememberWorktree(workspace.worktreePath, workspace.baseSha);
    this.taskRepository.updateTask(current);
    this.runRegistry.rememberWorkDirectory(taskId, workspace.agentDirectory);
    if (this.runRegistry.stopReasonOf(taskId) !== null) {
      // Deleted or reconfigured while the worktree was being prepared.
      await this.finishTaskTurnUseCase.finishTaskTurn(taskId, { kind: 'cancelled' });
      return;
    }

    const prompt = this.buildPrompt(current, step, route?.steps.length ?? 0, stepIndex, snapshot, {
      feedback,
      qaDocumentPaths: workspace.qaDocumentPaths,
      skills,
      skillManifestPaths: workspace.skillManifestPaths,
    });
    this.launchSession(
      current,
      snapshot,
      prepared,
      prompt,
      workspace.agentDirectory,
      workspace.worktreePath,
      resumeSessionRef,
      step,
    );
  }

  private launchSession(
    task: Task,
    snapshot: EngineSnapshot & { name: string },
    prepared: PreparedAgentRun,
    prompt: string,
    workDirectory: string,
    worktreeRoot: string,
    resumeSessionRef: string | null,
    step: WorkflowStepState | undefined,
  ): void {
    const state = task.toState();
    this.eventLog.recordTaskEvent({
      taskId: task.id,
      agentId: snapshot.agentId,
      kind: 'turn_started',
      payload: {
        stepName: step?.name ?? 'Thực hiện task',
        agentName: snapshot.name,
        resumed: resumeSessionRef !== null,
      },
    });
    const sessionId = this.sessionSupervisor.startSupervisedSession({
      ownerLabel: `task:${formatTaskCode(state.sequenceNumber)}`,
      openSession: (signal) =>
        prepared.engine.startSession(
          {
            prompt,
            workingDirectory: workDirectory,
            workspaceRoot: worktreeRoot,
            model: prepared.model,
            permissions: prepared.permissions,
            resumeSessionRef,
            apiConnection: prepared.apiConnection,
          },
          signal,
        ),
      receiveSessionEvent: (event) =>
        this.sessionEventRecorder.recordSessionEvent(task.id, snapshot.agentId, event, {
          keepSessionRef: true,
          worktreePath: state.worktreePath,
          workDirectory,
        }),
      finishSession: (terminal) => this.finishTaskTurnUseCase.finishTaskTurn(task.id, terminal),
    });
    this.runRegistry.attachStopHandle(task.id, () =>
      this.sessionSupervisor.cancelSupervisedSession(sessionId),
    );
  }

  private buildPrompt(
    task: Task,
    step: WorkflowStepState | undefined,
    stepCount: number,
    stepIndex: number,
    snapshot: EngineSnapshot & { name: string; role: keyof typeof ROLE_LABELS_FOR_PROMPTS },
    extras: {
      feedback: string | null;
      qaDocumentPaths: string[];
      skills: readonly AgentSkillFolder[];
      skillManifestPaths: ReadonlyMap<string, string>;
    },
  ): string {
    const state = task.toState();
    const rules = this.progression.readWorkflowRules(state.workflowId);
    const parent =
      state.parentTaskId === null
        ? undefined
        : this.taskRepository.findTaskById(state.parentTaskId)?.toState();
    return buildStepPrompt({
      taskCode: formatTaskCode(state.sequenceNumber),
      title: state.title,
      description: state.description,
      goal: buildCompletionGoal({
        description: state.description,
        criteria: state.criteria,
        qaDocuments: this.attachmentRepository.listAttachments(task.id),
      }),
      qaDocumentPaths: extras.qaDocumentPaths,
      step:
        step === undefined
          ? null
          : {
              name: step.name,
              number: stepIndex + 1,
              count: stepCount,
              gate: step.gate,
              requiredOutput: step.requiredOutput,
            },
      agentRoleLabel: `${ROLE_LABELS_FOR_PROMPTS[snapshot.role]} ${snapshot.name}`,
      previousReports: this.eventLog.listStepReports(task.id),
      feedback: extras.feedback,
      // Without a workflow the default rule still applies: sensitive work needs the user.
      sensitiveActionsNeedApproval: rules?.sensitiveActionsNeedApproval ?? true,
      splitCandidates: this.taskSplitter
        .listSplitCandidates(task, snapshot.agentId)
        .map((candidate) => ({
          name: candidate.name,
          roleLabel: ROLE_LABELS_FOR_PROMPTS[candidate.role],
        })),
      skills: this.describeSkillsForPrompt(snapshot.provider, extras),
      subtaskOf:
        parent === undefined
          ? null
          : { taskCode: formatTaskCode(parent.sequenceNumber), title: parent.title },
      canEditWorkspace: snapshot.accessLevel === 'edit_workspace',
    });
  }

  /**
   * Agents on Claude Code or Codex read each SKILL.md from the worktree when needed; a Custom
   * API agent cannot open files, so it gets the text (capped).
   */
  private describeSkillsForPrompt(
    provider: EngineSnapshot['provider'],
    extras: {
      skills: readonly AgentSkillFolder[];
      skillManifestPaths: ReadonlyMap<string, string>;
    },
  ): StepPromptInput['skills'] {
    return extras.skills.flatMap((skill): StepPromptInput['skills'] => {
      const manifestPath = extras.skillManifestPaths.get(skill.slug) ?? null;
      if (provider !== 'custom_api') {
        return manifestPath === null
          ? []
          : [{ name: skill.name, description: skill.description, manifestPath, content: null }];
      }
      const text = this.skillSource.readSkillManifest(skill.skillId);
      return [
        {
          name: skill.name,
          description: skill.description,
          manifestPath: null,
          content:
            text.length <= INLINE_SKILL_MAX_LENGTH
              ? text
              : `${text.slice(0, INLINE_SKILL_MAX_LENGTH)}…`,
        },
      ];
    });
  }

  /** A step the user owns: nothing to run, the user approves what the previous steps did. */
  private askUserForStep(task: Task, step: WorkflowStepState): void {
    const reports = this.eventLog.listStepReports(task.id);
    const latest = reports.at(-1);
    task.requeue({ stepId: step.id, retriesUsed: task.toState().stepAttempt });
    this.approvalRequests.requestApproval(task, {
      kind: 'step_gate',
      summary: `Bước "${step.name}": chờ bạn duyệt`,
      request:
        latest === undefined
          ? 'Duyệt để task đi tiếp.'
          : `${latest.stepName} (${latest.agentName}): ${latest.summary}`,
      step: { id: step.id, name: step.name },
      agent: null,
    });
    this.taskRepository.updateTask(task);
  }
}

/** Same agent on the same engine and connection: the engine session can continue (model may differ). */
function canResumeSession(previous: EngineSnapshot | null, next: EngineSnapshot): boolean {
  return (
    previous !== null &&
    previous.agentId === next.agentId &&
    previous.provider === next.provider &&
    previous.connectionId === next.connectionId
  );
}
