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
import { useApiQuery } from '../../../shared/api/use-api-query';
import { addDepartmentMember } from '../../organization/organization-api';
import { loadProviderConnections } from '../../providers/providers-api';
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
  const connections = useApiQuery('provider-connections', loadProviderConnections);
  const connectionList = connections.status === 'success' ? connections.result : [];
  const [connectionId, setConnectionId] = useState('');
  const [model, setModel] = useState('');
  const selectedConnection = connectionList.find((connection) => connection.id === connectionId);

  const pickProvider = (nextProvider: AgentProvider) => {
    setProvider(nextProvider);
    const firstConnection = nextProvider === 'custom_api' ? connectionList[0] : undefined;
    setConnectionId(firstConnection?.id ?? '');
    setModel(firstConnection?.defaultModel ?? firstConnection?.models[0] ?? '');
  };

  const pickConnection = (nextConnectionId: string) => {
    setConnectionId(nextConnectionId);
    const nextConnection = connectionList.find((connection) => connection.id === nextConnectionId);
    setModel(nextConnection?.defaultModel ?? nextConnection?.models[0] ?? '');
  };

  const submitMember = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = addDepartmentMemberRequestSchema.safeParse({
      name,
      role,
      provider,
      ...(provider === 'custom_api' ? { connectionId, model: model || undefined } : {}),
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
      <form className={styles.form} onSubmit={(event) => void submitMember(event)} noValidate>
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
            onChange={(event) => pickProvider(event.target.value as AgentProvider)}
            className={controlStyles.fieldInput}
          >
            {AGENT_PROVIDERS.map((providerOption) => {
              const unavailable = providerOption === 'custom_api' && connectionList.length === 0;
              return (
                <option key={providerOption} value={providerOption} disabled={unavailable}>
                  {PROVIDER_PRESENTATION[providerOption].label}
                  {unavailable ? ' (thêm kết nối ở Cài đặt API trước)' : ''}
                </option>
              );
            })}
          </select>
        </label>
        {provider === 'custom_api' && (
          <div className={styles.brainGrid}>
            <label className={controlStyles.field}>
              Kết nối API
              <select
                value={connectionId}
                onChange={(event) => pickConnection(event.target.value)}
                className={controlStyles.fieldInput}
              >
                {connectionList.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={controlStyles.field}>
              Model
              <select
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className={`${controlStyles.fieldInput} ${styles.monoInput}`}
              >
                {(selectedConnection?.models ?? []).map((modelOption) => (
                  <option key={modelOption} value={modelOption}>
                    {modelOption}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
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
