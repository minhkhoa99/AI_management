'use client';

import { type FormEvent, useState } from 'react';
import {
  AGENT_PROVIDERS,
  AGENT_ROLES,
  type AgentDetail,
  type AgentProvider,
  type AgentRole,
  addDepartmentMemberRequestSchema,
  type OrgTreeNode,
} from '@aiteam/contracts';
import { controlStyles, InlinePanel, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { addDepartmentMember } from '../../organization/organization-api';
import { PROVIDER_PRESENTATION, ROLE_LABELS } from '../../organization/organization-labels';
import { collectFieldErrors, listTreeMembers } from '../org-tree-navigation';
import styles from './org-screen.module.css';

interface AddMemberPanelProps {
  departmentId: string;
  departmentName: string;
  root: OrgTreeNode | null;
  presetManagerPositionId: string | null;
  onAdded: (agent: AgentDetail) => void;
  onCancel: () => void;
}

export function AddMemberPanel(props: AddMemberPanelProps) {
  const members = listTreeMembers(props.root);
  const isFirstMember = members.length === 0;
  const [name, setName] = useState('');
  const [role, setRole] = useState<AgentRole>(isFirstMember ? 'manager' : 'dev');
  const [provider, setProvider] = useState<AgentProvider>('codex');
  const [managerPositionId, setManagerPositionId] = useState<string>(
    props.presetManagerPositionId ?? members[0]?.positionId ?? '',
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { outcome, isPending, performAction } = useActionOutcome();

  const submitMember = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = addDepartmentMemberRequestSchema.safeParse({
      name,
      role,
      provider,
      reportsToPositionId: isFirstMember ? null : managerPositionId,
    });
    if (!parsed.success) {
      setFieldErrors(collectFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    const added = await performAction(
      () => addDepartmentMember(props.departmentId, parsed.data),
      () => null,
    );
    if (added !== undefined) {
      props.onAdded(added);
    }
  };

  return (
    <InlinePanel title={`Thêm thành viên vào ${props.departmentName}`} emphasised>
      <form className={styles.form} onSubmit={submitMember} noValidate>
        <label className={controlStyles.field}>
          Tên hiển thị
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Dev mobile"
            maxLength={80}
            className={
              fieldErrors.name === undefined
                ? controlStyles.fieldInput
                : `${controlStyles.fieldInput} ${controlStyles.fieldInputInvalid}`
            }
            aria-invalid={fieldErrors.name !== undefined}
            aria-describedby={fieldErrors.name === undefined ? undefined : 'member-name-error'}
          />
        </label>
        {fieldErrors.name !== undefined && (
          <span id="member-name-error" role="alert" className={controlStyles.fieldError}>
            {fieldErrors.name}
          </span>
        )}
        <label className={controlStyles.field}>
          Vai trò
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as AgentRole)}
            className={controlStyles.fieldInput}
          >
            {AGENT_ROLES.map((roleOption) => (
              <option key={roleOption} value={roleOption}>
                {ROLE_LABELS[roleOption]}
              </option>
            ))}
          </select>
        </label>
        <label className={controlStyles.field}>
          Bộ não (provider)
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as AgentProvider)}
            className={controlStyles.fieldInput}
          >
            {AGENT_PROVIDERS.map((providerOption) => {
              const presentation = PROVIDER_PRESENTATION[providerOption];
              return (
                <option
                  key={providerOption}
                  value={providerOption}
                  disabled={!presentation.availableNow}
                >
                  {presentation.label}
                  {presentation.unavailableHint === undefined
                    ? ''
                    : ` (${presentation.unavailableHint})`}
                </option>
              );
            })}
          </select>
        </label>
        <label className={controlStyles.field}>
          Báo cáo cho
          {isFirstMember ? (
            <span className={styles.fieldHint}>
              Thành viên đầu tiên là trưởng phòng, không báo cáo cho ai.
            </span>
          ) : (
            <select
              value={managerPositionId}
              onChange={(event) => setManagerPositionId(event.target.value)}
              className={controlStyles.fieldInput}
            >
              {members.map((member) => (
                <option key={member.positionId} value={member.positionId}>
                  {member.agent.name} ({ROLE_LABELS[member.agent.role]})
                </option>
              ))}
            </select>
          )}
        </label>
        <StatusNotice outcome={outcome} />
        <div className={controlStyles.buttonRow}>
          <button type="submit" className={controlStyles.primaryButton} disabled={isPending}>
            Thêm vào phòng
          </button>
          <button type="button" className={controlStyles.secondaryButton} onClick={props.onCancel}>
            Huỷ
          </button>
        </div>
      </form>
    </InlinePanel>
  );
}
