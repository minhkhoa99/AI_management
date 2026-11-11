'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AgentSummary, Department } from '@aiteam/contracts';
import { controlStyles, StatusNotice, StatusPill, ToggleSwitch } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { AgentAvatar, ProviderBadge } from '../../organization/components/agent-identity';
import { setAgentEnabled, setAgentsEnabled } from '../../organization/organization-api';
import { buildOrgHref, ROLE_LABELS } from '../../organization/organization-labels';
import styles from './overview.module.css';

const ALL_DEPARTMENTS = 'all';

interface AgentTableProps {
  agents: AgentSummary[];
  departments: Department[];
}

export function AgentTable({ agents, departments }: AgentTableProps) {
  const [departmentFilter, setDepartmentFilter] = useState<string>(ALL_DEPARTMENTS);
  const [pickedAgentIds, setPickedAgentIds] = useState<ReadonlySet<string>>(new Set());
  const { outcome, isPending, performAction } = useActionOutcome();

  const visibleAgents =
    departmentFilter === ALL_DEPARTMENTS
      ? agents
      : agents.filter((agent) => agent.department.id === departmentFilter);
  const pickedVisibleIds = visibleAgents
    .map((agent) => agent.id)
    .filter((agentId) => pickedAgentIds.has(agentId));

  const togglePicked = (agentId: string) =>
    setPickedAgentIds((previous) => {
      const next = new Set(previous);
      if (!next.delete(agentId)) {
        next.add(agentId);
      }
      return next;
    });

  const setPickedAgentsEnabled = async (enabled: boolean) => {
    const result = await performAction(
      () => setAgentsEnabled(pickedVisibleIds, enabled),
      (response) => `Đã ${enabled ? 'bật' : 'tắt'} ${response.updatedCount} agent.`,
    );
    if (result !== undefined) {
      setPickedAgentIds(new Set());
    }
  };

  return (
    <section aria-label="Danh sách agent" className={styles.tableCard}>
      <div className={styles.tableHeader}>
        <h2 className={controlStyles.panelTitle}>Agent ({visibleAgents.length})</h2>
        <div role="group" aria-label="Lọc theo phòng" className={styles.filterPills}>
          {[{ id: ALL_DEPARTMENTS, name: 'Tất cả' }, ...departments].map((filterOption) => (
            <button
              key={filterOption.id}
              type="button"
              className={controlStyles.pillButton}
              aria-pressed={departmentFilter === filterOption.id}
              onClick={() => setDepartmentFilter(filterOption.id)}
            >
              {filterOption.name}
            </button>
          ))}
        </div>
      </div>

      {pickedVisibleIds.length > 0 && (
        <div className={styles.bulkBar} role="group" aria-label="Thao tác hàng loạt">
          <span className={styles.bulkLabel}>Đã chọn {pickedVisibleIds.length} agent</span>
          <button
            type="button"
            className={styles.bulkButton}
            onClick={() => void setPickedAgentsEnabled(true)}
            disabled={isPending}
          >
            Bật tất cả
          </button>
          <button
            type="button"
            className={styles.bulkButton}
            onClick={() => void setPickedAgentsEnabled(false)}
            disabled={isPending}
          >
            Tắt tất cả
          </button>
          <button
            type="button"
            className={styles.bulkClear}
            onClick={() => setPickedAgentIds(new Set())}
          >
            Bỏ chọn
          </button>
        </div>
      )}
      <div className={styles.noticeSlot}>
        <StatusNotice outcome={outcome} />
      </div>

      {visibleAgents.length === 0 ? (
        <p className={styles.tableEmpty}>
          Chưa có agent nào. <Link href="/org/">Thêm thành viên ở Sơ đồ tổ chức</Link>.
        </p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.agentTable}>
            <thead>
              <tr>
                <th scope="col" className={styles.pickColumn}>
                  <span className="visually-hidden">Chọn</span>
                </th>
                <th scope="col">Agent</th>
                <th scope="col">Phòng</th>
                <th scope="col">Bộ não</th>
                <th scope="col">Trạng thái</th>
                <th scope="col" className={styles.toggleColumn}>
                  Bật
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleAgents.map((agent) => {
                const available = agent.enabled && agent.department.enabled;
                const isPicked = pickedAgentIds.has(agent.id);
                return (
                  <tr key={agent.id} className={isPicked ? styles.rowPicked : undefined}>
                    <td className={styles.pickColumn}>
                      <input
                        type="checkbox"
                        className={styles.pickBox}
                        checked={isPicked}
                        onChange={() => togglePicked(agent.id)}
                        aria-label={`Chọn ${agent.name}`}
                      />
                    </td>
                    <td>
                      <Link
                        href={buildOrgHref(agent.department.id, agent.id)}
                        className={styles.agentLink}
                      >
                        <AgentAvatar
                          name={agent.name}
                          provider={agent.provider}
                          available={available}
                          size={34}
                        />
                        <span className={styles.agentText}>
                          <span
                            className={
                              available
                                ? styles.agentName
                                : `${styles.agentName} ${styles.agentNameOff}`
                            }
                          >
                            {agent.name}
                          </span>
                          <span className={styles.agentRole}>{ROLE_LABELS[agent.role]}</span>
                        </span>
                      </Link>
                    </td>
                    <td className={styles.noWrap}>
                      <span className={styles.departmentCell}>
                        <span
                          aria-hidden="true"
                          className={styles.colorDot}
                          style={{ background: agent.department.color }}
                        />
                        {agent.department.name}
                      </span>
                    </td>
                    <td>
                      <ProviderBadge provider={agent.provider} model={agent.model} />
                      {agent.model !== null && (
                        <span className={styles.modelLine}>{agent.model}</span>
                      )}
                    </td>
                    <td className={styles.noWrap}>
                      <StatusPill available={available} />
                    </td>
                    <td className={styles.toggleColumn}>
                      <ToggleSwitch
                        pressed={agent.enabled}
                        accessibleLabel={`${agent.enabled ? 'Tắt' : 'Bật'} ${agent.name}`}
                        onToggle={() =>
                          void performAction(
                            () => setAgentEnabled(agent.id, !agent.enabled),
                            () => null,
                          )
                        }
                        disabled={isPending}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
