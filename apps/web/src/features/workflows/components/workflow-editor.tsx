'use client';

import {
  AGENT_ROLES,
  listWorkflowStepProblems,
  STEP_FAILURE_ACTIONS,
  STEP_GATES,
  STEP_OWNERS,
  STEP_RETRY_LIMITS,
  type AgentSummary,
  type StepFailureAction,
  type StepGate,
  type StepOwner,
  type Workflow,
  type WorkflowStepProblem,
  type WorkflowTemplate,
} from '@aiteam/contracts';
import { useState } from 'react';
import { StrokeIcon } from '../../../shared/ui/stroke-icon';
import { controlStyles, StatusNotice, ToggleSwitch } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { buildInitials } from '../../organization/organization-labels';
import {
  FAILURE_ACTION_LABELS,
  GATE_PRESENTATION,
  RULE_PRESENTATION,
  STEP_OWNER_LABELS,
} from '../workflow-labels';
import {
  appendNewStep,
  changeFailureAction,
  changeStepOwner,
  type EditableStep,
  editableStepsFromBlueprints,
  editableStepsOf,
  removeStep,
  swapSteps,
  toStepDrafts,
} from '../workflow-step-drafts';
import { replaceWorkflowSteps, updateWorkflowRules } from '../workflows-api';
import styles from './workflows.module.css';

const PLUS_ICON = 'M12 5v14M5 12h14';
const ARROW_ICON = 'M4 12h14M13 6l6 6-6 6';
const RETRY_CHOICES = Array.from(
  { length: STEP_RETRY_LIMITS.max - STEP_RETRY_LIMITS.min + 1 },
  (_unused, offset) => STEP_RETRY_LIMITS.min + offset,
);

interface WorkflowEditorProps {
  workflow: Workflow;
  departmentName: string;
  departmentAgents: readonly AgentSummary[];
  templates: readonly WorkflowTemplate[];
  /** Edits not saved yet; undefined means the saved chain is shown. */
  unsavedSteps: EditableStep[] | undefined;
  onStepsEdited: (steps: EditableStep[]) => void;
  onStepsSavedOrDiscarded: () => void;
}

/** Step chain of one workflow ("Lưu quy trình" saves it), step form and department rules. */
export function WorkflowEditor({
  workflow,
  departmentName,
  departmentAgents,
  templates,
  unsavedSteps,
  onStepsEdited,
  onStepsSavedOrDiscarded,
}: WorkflowEditorProps) {
  const steps = unsavedSteps ?? editableStepsOf(workflow);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { outcome, isPending, performAction } = useActionOutcome();
  const problems = listWorkflowStepProblems(steps);
  const isDirty = unsavedSteps !== undefined;
  const selectedStepIndex = Math.min(selectedIndex, steps.length - 1);
  const selectedStep = steps[selectedStepIndex];

  const editSteps = (nextSteps: EditableStep[], nextSelectedIndex = selectedStepIndex) => {
    onStepsEdited(nextSteps);
    setSelectedIndex(Math.max(0, Math.min(nextSelectedIndex, nextSteps.length - 1)));
  };
  const editSelectedStep = (changeStep: (step: EditableStep) => EditableStep) => {
    if (selectedStep === undefined) return;
    editSteps(steps.map((step, index) => (index === selectedStepIndex ? changeStep(step) : step)));
  };

  const saveSteps = () =>
    void performAction(
      () => replaceWorkflowSteps(workflow.id, { steps: toStepDrafts(steps) }),
      () => {
        onStepsSavedOrDiscarded();
        return `Đã lưu ${workflow.name}.`;
      },
    );

  return (
    <>
      {!workflow.enforce && (
        <p className={styles.looseNote}>
          Quy trình đang tắt: agent trong {departmentName} tự quyết thứ tự làm việc, nền tảng chỉ
          ghi log.
        </p>
      )}

      <section aria-label="Mẫu quy trình" className={styles.templateBar}>
        <span className={styles.templateLabel}>Bắt đầu từ mẫu</span>
        <div role="group" aria-label="Chọn mẫu quy trình" className={styles.templatePills}>
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              className={controlStyles.pillButton}
              onClick={() => editSteps(editableStepsFromBlueprints(template.steps), 0)}
            >
              {template.label}
            </button>
          ))}
        </div>
        <span className={styles.templateHint}>
          Chọn mẫu sẽ thay các bước hiện tại. Sửa tiếp từng bước bên dưới rồi bấm Lưu quy trình.
        </span>
      </section>

      <section aria-label="Các bước của quy trình" className={styles.chainSection}>
        <div className={styles.chainHeader}>
          <div>
            <h2 className={styles.chainTitle}>Các bước: {workflow.name}</h2>
            <span className={styles.chainMeta}>{steps.length} bước · bấm một bước để sửa</span>
          </div>
          <div className={styles.chainActions}>
            <ToggleSwitch
              pressed={workflow.enforce}
              accessibleLabel={`${workflow.enforce ? 'Tắt' : 'Bật'} bắt buộc tuân theo ${workflow.name}`}
              visibleLabel={workflow.enforce ? 'Bắt buộc tuân theo' : 'Không bắt buộc'}
              disabled={isPending}
              onToggle={() =>
                void performAction(
                  () => updateWorkflowRules(workflow.id, { enforce: !workflow.enforce }),
                  () => null,
                )
              }
            />
            {isDirty && (
              <button
                type="button"
                className={controlStyles.secondaryButton}
                onClick={onStepsSavedOrDiscarded}
              >
                Bỏ thay đổi
              </button>
            )}
            <button
              type="button"
              className={controlStyles.primaryButton}
              disabled={!isDirty || problems.length > 0 || isPending}
              onClick={saveSteps}
            >
              Lưu quy trình
            </button>
          </div>
        </div>
        <div className={styles.chainScroll}>
          <ol className={styles.chain}>
            {steps.map((step, index) => (
              <li key={step.key} className={styles.chainItem}>
                <StepCard
                  step={step}
                  stepNumber={index + 1}
                  selected={index === selectedStepIndex}
                  invalid={problems.some((problem) => problem.stepIndex === index)}
                  departmentAgents={departmentAgents}
                  onSelect={() => setSelectedIndex(index)}
                />
                {index < steps.length - 1 && (
                  <span aria-hidden="true" className={styles.chainArrow}>
                    <StrokeIcon path={ARROW_ICON} size={18} strokeWidth={1.8} />
                  </span>
                )}
              </li>
            ))}
            <li className={styles.addStepItem}>
              <button
                type="button"
                className={styles.addStepCard}
                disabled={steps.length >= 20}
                onClick={() => editSteps(appendNewStep(steps), steps.length)}
              >
                <StrokeIcon path={PLUS_ICON} size={20} strokeWidth={2} />
                Thêm bước
              </button>
            </li>
          </ol>
        </div>
      </section>
      <StatusNotice outcome={outcome} />

      <div className={styles.lowerGrid}>
        {selectedStep !== undefined && (
          <StepForm
            step={selectedStep}
            stepIndex={selectedStepIndex}
            allSteps={steps}
            problems={problems.filter((problem) => problem.stepIndex === selectedStepIndex)}
            departmentAgents={departmentAgents}
            onChangeStep={editSelectedStep}
            onMoveEarlier={() =>
              editSteps(
                swapSteps(steps, selectedStepIndex - 1, selectedStepIndex),
                selectedStepIndex - 1,
              )
            }
            onMoveLater={() =>
              editSteps(
                swapSteps(steps, selectedStepIndex, selectedStepIndex + 1),
                selectedStepIndex + 1,
              )
            }
            onRemove={() => editSteps(removeStep(steps, selectedStepIndex), selectedStepIndex - 1)}
          />
        )}
        <RulesPanel workflow={workflow} />
      </div>
    </>
  );
}

function agentsWithRole(agents: readonly AgentSummary[], ownerRole: StepOwner): AgentSummary[] {
  return agents.filter((agent) => agent.role === ownerRole);
}

function StepCard({
  step,
  stepNumber,
  selected,
  invalid,
  departmentAgents,
  onSelect,
}: {
  step: EditableStep;
  stepNumber: number;
  selected: boolean;
  invalid: boolean;
  departmentAgents: readonly AgentSummary[];
  onSelect: () => void;
}) {
  const gate = GATE_PRESENTATION[step.gate];
  const owners = agentsWithRole(departmentAgents, step.ownerRole);
  const ownerLabel = STEP_OWNER_LABELS[step.ownerRole];
  const isUserStep = step.ownerRole === 'user';
  return (
    <button
      type="button"
      className={invalid ? `${styles.stepCard} ${styles.stepCardInvalid}` : styles.stepCard}
      aria-pressed={selected}
      aria-label={`Bước ${stepNumber}: ${step.name}, ${ownerLabel}, ${gate.label}${invalid ? ', cần sửa' : ''}`}
      onClick={onSelect}
    >
      <span className={styles.stepHeading}>
        <span className={styles.stepNumber}>{stepNumber}</span>
        <span className={styles.stepName}>{step.name}</span>
      </span>
      <span className={styles.stepOwner}>
        <span
          aria-hidden="true"
          className={
            isUserStep ? `${styles.ownerAvatar} ${styles.ownerAvatarUser}` : styles.ownerAvatar
          }
        >
          {buildInitials(owners[0]?.name ?? ownerLabel)}
        </span>
        <span className={styles.ownerText}>
          <span>{ownerLabel}</span>
          {!isUserStep &&
            (owners.length === 0 ? (
              <span className={styles.ownerMissing}>Phòng chưa có agent vai trò này</span>
            ) : (
              <span className={styles.ownerAgents}>
                {owners.map((agent) => agent.name).join(', ')}
              </span>
            ))}
        </span>
      </span>
      <span
        className={styles.gatePill}
        style={{ background: gate.background, color: gate.foreground }}
      >
        {gate.label}
      </span>
      <span className={styles.failText}>
        Không đạt: {FAILURE_ACTION_LABELS[step.onFail]}
        {step.onFail === 'retry' ? ` (tối đa ${step.maxRetries} lần)` : ''}
        {step.onFail === 'return_to_step' && step.returnToStepIndex !== null
          ? ` (về bước ${step.returnToStepIndex + 1})`
          : ''}
      </span>
      <span className={styles.outputText}>
        Đầu ra: {step.requiredOutput === '' ? 'chưa ghi' : step.requiredOutput}
      </span>
    </button>
  );
}

function StepForm({
  step,
  stepIndex,
  allSteps,
  problems,
  departmentAgents,
  onChangeStep,
  onMoveEarlier,
  onMoveLater,
  onRemove,
}: {
  step: EditableStep;
  stepIndex: number;
  allSteps: readonly EditableStep[];
  problems: readonly WorkflowStepProblem[];
  departmentAgents: readonly AgentSummary[];
  onChangeStep: (changeStep: (step: EditableStep) => EditableStep) => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onRemove: () => void;
}) {
  const ownerChoices: readonly StepOwner[] = STEP_OWNERS;
  const gateChoices: readonly StepGate[] =
    step.ownerRole === 'user' ? ['user_approval'] : STEP_GATES;
  const describeOwner = (owner: StepOwner) => {
    if (owner === 'user') return STEP_OWNER_LABELS.user;
    const names = agentsWithRole(departmentAgents, owner).map((agent) => agent.name);
    return `${STEP_OWNER_LABELS[owner]} – ${names.length === 0 ? 'chưa có agent' : names.join(', ')}`;
  };

  return (
    <section aria-label="Sửa bước" className={controlStyles.panel}>
      <div className={styles.formHeader}>
        <h2 className={controlStyles.panelTitle}>Sửa bước {stepIndex + 1}</h2>
        <div className={controlStyles.buttonRow}>
          {stepIndex > 0 && (
            <button type="button" className={controlStyles.secondaryButton} onClick={onMoveEarlier}>
              Đưa lên trước
            </button>
          )}
          {stepIndex < allSteps.length - 1 && (
            <button type="button" className={controlStyles.secondaryButton} onClick={onMoveLater}>
              Đưa ra sau
            </button>
          )}
          {allSteps.length > 1 && (
            <button type="button" className={controlStyles.dangerButton} onClick={onRemove}>
              Xoá bước
            </button>
          )}
        </div>
      </div>
      <div className={styles.formGrid}>
        <label className={controlStyles.field}>
          Tên bước
          <input
            type="text"
            value={step.name}
            onChange={(event) => {
              const name = event.target.value;
              onChangeStep((current) => ({ ...current, name }));
            }}
            className={controlStyles.fieldInput}
          />
        </label>
        <label className={controlStyles.field}>
          Người phụ trách
          <select
            value={step.ownerRole}
            onChange={(event) => {
              const owner = ownerChoices.find((choice) => choice === event.target.value);
              if (owner !== undefined) onChangeStep((current) => changeStepOwner(current, owner));
            }}
            className={controlStyles.fieldInput}
          >
            {[...AGENT_ROLES, 'user' as const].map((owner) => (
              <option key={owner} value={owner}>
                {describeOwner(owner)}
              </option>
            ))}
          </select>
        </label>
        <label className={controlStyles.field}>
          Điều kiện sang bước sau
          <select
            value={step.gate}
            onChange={(event) => {
              const gate = gateChoices.find((choice) => choice === event.target.value);
              if (gate !== undefined) onChangeStep((current) => ({ ...current, gate }));
            }}
            className={controlStyles.fieldInput}
          >
            {gateChoices.map((gate) => (
              <option key={gate} value={gate}>
                {GATE_PRESENTATION[gate].label}
              </option>
            ))}
          </select>
        </label>
        <label className={controlStyles.field}>
          Khi không đạt
          <select
            value={step.onFail}
            onChange={(event) => {
              const action = STEP_FAILURE_ACTIONS.find((choice) => choice === event.target.value);
              if (action !== undefined) {
                onChangeStep((current) => changeFailureAction(current, stepIndex, action));
              }
            }}
            className={controlStyles.fieldInput}
          >
            {STEP_FAILURE_ACTIONS.map((action: StepFailureAction) => (
              <option
                key={action}
                value={action}
                disabled={action === 'return_to_step' && stepIndex === 0}
              >
                {FAILURE_ACTION_LABELS[action]}
              </option>
            ))}
          </select>
        </label>
        {step.onFail === 'return_to_step' && stepIndex > 0 && (
          <label className={controlStyles.field}>
            Quay lại bước
            <select
              value={step.returnToStepIndex ?? ''}
              onChange={(event) => {
                const returnToStepIndex = Number(event.target.value);
                onChangeStep((current) => ({ ...current, returnToStepIndex }));
              }}
              className={controlStyles.fieldInput}
            >
              {allSteps.slice(0, stepIndex).map((earlierStep, earlierIndex) => (
                <option key={earlierStep.key} value={earlierIndex}>
                  {earlierIndex + 1}. {earlierStep.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {step.onFail === 'retry' && (
          <label className={controlStyles.field}>
            Số lần thử lại tối đa
            <select
              value={step.maxRetries}
              onChange={(event) => {
                const maxRetries = Number(event.target.value);
                onChangeStep((current) => ({ ...current, maxRetries }));
              }}
              className={controlStyles.fieldInput}
            >
              {RETRY_CHOICES.map((count) => (
                <option key={count} value={count}>
                  {count} lần
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {stepIndex === 0 && (
        <p className={styles.formHint}>
          Bước đầu tiên không có bước nào để quay lại. Chọn “Thử lại” hoặc “Dừng”.
        </p>
      )}
      <label className={controlStyles.field}>
        Đầu ra bắt buộc của bước này
        <input
          type="text"
          value={step.requiredOutput}
          onChange={(event) => {
            const requiredOutput = event.target.value;
            onChangeStep((current) => ({ ...current, requiredOutput }));
          }}
          placeholder="Báo cáo kiểm thử và danh sách lỗi"
          className={controlStyles.fieldInput}
        />
      </label>
      <p className={styles.formHint}>
        Agent phụ trách chỉ được báo xong khi có đủ đầu ra này. Nền tảng kiểm tra điều kiện chuyển
        bước trước khi giao việc cho bước sau.
      </p>
      {problems.length > 0 && (
        <ul role="alert" className={styles.problemList}>
          {problems.map((problem) => (
            <li key={problem.message}>{problem.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RulesPanel({ workflow }: { workflow: Workflow }) {
  const { outcome, isPending, performAction } = useActionOutcome();
  return (
    <section aria-label="Luật chung" className={controlStyles.panel}>
      <h2 className={controlStyles.panelTitle}>Luật chung của phòng</h2>
      <div>
        {RULE_PRESENTATION.map((rule) => {
          const enabled = workflow.rules[rule.key];
          return (
            <div key={rule.key} className={styles.ruleRow}>
              <span className={styles.ruleText}>
                <span className={styles.ruleLabel}>{rule.label}</span>
                <span className={styles.ruleDescription}>{rule.description}</span>
              </span>
              <ToggleSwitch
                pressed={enabled}
                accessibleLabel={`${enabled ? 'Tắt' : 'Bật'} luật: ${rule.label}`}
                disabled={isPending}
                onToggle={() =>
                  void performAction(
                    () => updateWorkflowRules(workflow.id, { rules: { [rule.key]: !enabled } }),
                    () => null,
                  )
                }
              />
            </div>
          );
        })}
      </div>
      <StatusNotice outcome={outcome} />
    </section>
  );
}
