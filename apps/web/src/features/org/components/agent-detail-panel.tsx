'use client';

import { type FormEvent, useState } from 'react';
import {
  AGENT_ROLES,
  type AgentDetail,
  type AgentRole,
  type OrgTreeNode,
  updateDepartmentMemberRequestSchema,
} from '@aiteam/contracts';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { controlStyles, StatusNotice, StatusPill, ToggleSwitch } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { AgentAvatar, ProviderBadge } from '../../organization/components/agent-identity';
import {
  changeReportingLine,
  loadAgentDetail,
  removeDepartmentMember,
  setAgentEnabled,
  updateDepartmentMember,
} from '../../organization/organization-api';
import { PROVIDER_PRESENTATION, ROLE_LABELS } from '../../organization/organization-labels';
import {
  collectDescendantPositionIds,
  collectFieldErrors,
  listTreeMembers,
} from '../org-tree-navigation';
import styles from './org-screen.module.css';

interface AgentDetailPanelProps {
  agentId: string;
  root: OrgTreeNode | null;
  onRemoved: () => void;
}

export function AgentDetailPanel({ agentId, root, onRemoved }: AgentDetailPanelProps) {
  const detail = useApiQuery(`agent:${agentId}`, () => loadAgentDetail(agentId));

  if (detail.status === 'loading') {
    return (
      <section aria-label="Chi tiết agent" className={controlStyles.panel}>
        <p className={styles.mutedText}>Đang tải…</p>
      </section>
    );
  }
  if (detail.status === 'error') {
    return (
      <section aria-label="Chi tiết agent" className={controlStyles.panel}>
        <StatusNotice outcome={{ tone: 'error', error: detail.error }} />
      </section>
    );
  }
  // Keyed by agent so the edit form resets when another agent is selected.
  return (
    <AgentDetailContent
      key={detail.result.id}
      agent={detail.result}
      root={root}
      onRemoved={onRemoved}
    />
  );
}

function AgentDetailContent({
  agent,
  root,
  onRemoved,
}: {
  agent: AgentDetail;
  root: OrgTreeNode | null;
  onRemoved: () => void;
}) {
  const available = agent.enabled && agent.department.enabled;
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState<AgentRole>(agent.role);
  const [nameError, setNameError] = useState<string | undefined>();
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false);
  const { outcome, isPending, performAction } = useActionOutcome();

  const descendantIds = collectDescendantPositionIds(root, agent.positionId);
  const managerChoices = listTreeMembers(root).filter(
    (member) => member.positionId !== agent.positionId && !descendantIds.has(member.positionId),
  );
  const [managerPositionId, setManagerPositionId] = useState(agent.reportsToPositionId ?? '');

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = updateDepartmentMemberRequestSchema.safeParse({ name, role });
    if (!parsed.success) {
      setNameError(collectFieldErrors(parsed.error).name);
      return;
    }
    setNameError(undefined);
    await performAction(
      () => updateDepartmentMember(agent.department.id, agent.positionId, parsed.data),
      (updated) => `Đã lưu ${updated.name}.`,
    );
  };

  const reassignReportingLine = () =>
    performAction(
      () => changeReportingLine(agent.department.id, agent.positionId, managerPositionId),
      (moved) => `${moved.name} giờ báo cáo cho ${moved.reportsToAgentName ?? '—'}.`,
    );

  const removeMember = async () => {
    const removed = await performAction(
      () => removeDepartmentMember(agent.department.id, agent.positionId).then(() => true),
      () => null,
    );
    if (removed === true) {
      onRemoved();
    } else {
      setIsConfirmingRemoval(false);
    }
  };

  return (
    <section aria-label="Chi tiết agent" className={controlStyles.panel}>
      <div className={styles.detailHeader}>
        <AgentAvatar name={agent.name} provider={agent.provider} available={available} size={46} />
        <div className={styles.detailTitle}>
          <h2 className={controlStyles.panelTitle}>{agent.name}</h2>
          <span className={styles.mutedText}>
            {ROLE_LABELS[agent.role]} ·{' '}
            {agent.reportsToAgentName === null
              ? 'trưởng phòng'
              : `báo cáo cho ${agent.reportsToAgentName}`}
          </span>
        </div>
        <StatusPill available={available} />
      </div>

      <div className={styles.statGrid}>
        <div className={styles.statTile}>
          <span className={styles.statLabel}>Cấp dưới</span>
          <span className={styles.statValue}>{agent.subordinateCount}</span>
        </div>
        <div className={styles.statTile}>
          <span className={styles.statLabel}>Bộ não</span>
          <ProviderBadge provider={agent.provider} />
        </div>
        <div className={styles.statTile}>
          <span className={styles.statLabel}>Quyền</span>
          <span className={styles.statValueSmall}>
            {agent.accessLevel === 'read_only' ? 'Chỉ đọc' : 'Sửa workspace'}
            {agent.networkAccess ? ' · có mạng' : ' · không mạng'}
          </span>
        </div>
      </div>
      <p className={styles.fieldHint}>
        {PROVIDER_PRESENTATION[agent.provider].note}. Đổi bộ não và quyền có ở Giai đoạn 2.
      </p>

      <ToggleSwitch
        pressed={agent.enabled}
        accessibleLabel={`${agent.enabled ? 'Tắt' : 'Bật'} ${agent.name}`}
        visibleLabel={agent.enabled ? 'Agent đang bật' : 'Agent đang tắt'}
        onToggle={() =>
          void performAction(
            () => setAgentEnabled(agent.id, !agent.enabled),
            (toggled) => `${toggled.name} đã ${toggled.enabled ? 'bật' : 'tắt'}.`,
          )
        }
        disabled={isPending}
      />
      {!agent.department.enabled && (
        <p className={styles.fieldHint}>
          Phòng {agent.department.name} đang tắt nên agent không nhận việc.
        </p>
      )}

      <form className={styles.form} onSubmit={saveProfile} noValidate>
        <label className={controlStyles.field}>
          Tên hiển thị
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            className={
              nameError === undefined
                ? controlStyles.fieldInput
                : `${controlStyles.fieldInput} ${controlStyles.fieldInputInvalid}`
            }
            aria-invalid={nameError !== undefined}
          />
        </label>
        {nameError !== undefined && (
          <span role="alert" className={controlStyles.fieldError}>
            {nameError}
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
        <div className={controlStyles.buttonRow}>
          <button type="submit" className={controlStyles.secondaryButton} disabled={isPending}>
            Lưu tên và vai trò
          </button>
        </div>
      </form>

      {agent.reportsToPositionId !== null && (
        <div className={styles.form}>
          <label className={controlStyles.field}>
            Báo cáo cho
            <select
              value={managerPositionId}
              onChange={(event) => setManagerPositionId(event.target.value)}
              className={controlStyles.fieldInput}
            >
              {managerChoices.map((member) => (
                <option key={member.positionId} value={member.positionId}>
                  {member.agent.name} ({ROLE_LABELS[member.agent.role]})
                </option>
              ))}
            </select>
          </label>
          <div className={controlStyles.buttonRow}>
            <button
              type="button"
              className={controlStyles.secondaryButton}
              onClick={() => void reassignReportingLine()}
              disabled={isPending || managerPositionId === agent.reportsToPositionId}
            >
              Đổi cấp trên
            </button>
          </div>
        </div>
      )}

      <StatusNotice outcome={outcome} />

      {isConfirmingRemoval ? (
        <div className={styles.confirmBox} role="group" aria-label="Xác nhận xoá thành viên">
          <span>
            Xoá {agent.name} khỏi phòng {agent.department.name}? Không hoàn tác được.
          </span>
          <div className={controlStyles.buttonRow}>
            <button
              type="button"
              className={controlStyles.dangerButton}
              onClick={() => void removeMember()}
              disabled={isPending}
            >
              Xoá thành viên
            </button>
            <button
              type="button"
              className={controlStyles.secondaryButton}
              onClick={() => setIsConfirmingRemoval(false)}
            >
              Giữ lại
            </button>
          </div>
        </div>
      ) : (
        <div className={controlStyles.buttonRow}>
          <button
            type="button"
            className={controlStyles.secondaryButton}
            onClick={() => setIsConfirmingRemoval(true)}
            disabled={isPending}
          >
            Xoá khỏi phòng…
          </button>
          <button
            type="button"
            className={controlStyles.secondaryButton}
            disabled
            title="Theo dõi trực tiếp có ở Giai đoạn 4"
          >
            Xem trực tiếp agent này
          </button>
        </div>
      )}
    </section>
  );
}
