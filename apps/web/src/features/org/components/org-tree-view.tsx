'use client';

import type { OrgTreeNode } from '@aiteam/contracts';
import { StrokeIcon } from '../../../shared/ui/stroke-icon';
import { ToggleSwitch } from '../../../shared/ui/controls';
import { AgentAvatar, ProviderBadge } from '../../organization/components/agent-identity';
import { ROLE_LABELS } from '../../organization/organization-labels';
import styles from './org-tree-view.module.css';

const PLUS_ICON = 'M12 5v14M5 12h14';

interface OrgTreeViewProps {
  root: OrgTreeNode;
  departmentEnabled: boolean;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onAddSubordinate: (positionId: string) => void;
  onToggleAgent: (agentId: string, enabled: boolean) => void;
  actionsDisabled: boolean;
}

/** Block org chart (CSS connectors as in the design); scrolls horizontally inside its frame. */
export function OrgTreeView(props: OrgTreeViewProps) {
  return (
    <div className={styles.scrollFrame}>
      <div className={styles.orgTree}>
        <ul>
          <OrgTreeBranch node={props.root} {...props} />
        </ul>
      </div>
    </div>
  );
}

function OrgTreeBranch({ node, ...props }: OrgTreeViewProps & { node: OrgTreeNode }) {
  const { agent } = node;
  const available = agent.enabled && props.departmentEnabled;
  const isSelected = props.selectedAgentId === agent.id;
  const statusLabel = available ? 'Sẵn sàng' : 'Đã tắt';

  return (
    <li>
      <div
        className={
          isSelected ? `${styles.memberBlock} ${styles.memberBlockSelected}` : styles.memberBlock
        }
      >
        <button
          type="button"
          className={styles.memberButton}
          onClick={() => props.onSelectAgent(agent.id)}
          aria-label={`Chọn ${agent.name}, ${ROLE_LABELS[agent.role]}, ${statusLabel}`}
          aria-pressed={isSelected}
        >
          <AgentAvatar name={agent.name} provider={agent.provider} available={available} />
          <span className={styles.memberText}>
            <span
              className={
                available ? styles.memberName : `${styles.memberName} ${styles.memberNameOff}`
              }
            >
              {agent.name}
            </span>
            <span className={styles.memberMeta}>
              {ROLE_LABELS[agent.role]} · {statusLabel}
              {agent.model !== null && ` · ${agent.model}`}
            </span>
          </span>
        </button>
        <div className={styles.memberActions}>
          <ProviderBadge provider={agent.provider} />
          <span className={styles.memberButtons}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => props.onAddSubordinate(node.positionId)}
              aria-label={`Thêm cấp dưới cho ${agent.name}`}
              title={`Thêm cấp dưới cho ${agent.name}`}
              disabled={props.actionsDisabled}
            >
              <StrokeIcon path={PLUS_ICON} size={16} strokeWidth={2} />
            </button>
            <ToggleSwitch
              pressed={agent.enabled}
              accessibleLabel={`${agent.enabled ? 'Tắt' : 'Bật'} ${agent.name}`}
              onToggle={() => props.onToggleAgent(agent.id, !agent.enabled)}
              disabled={props.actionsDisabled}
            />
          </span>
        </div>
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <OrgTreeBranch key={child.positionId} {...props} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}
