'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { TEAM_MODES, type Department } from '@aiteam/contracts';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { StrokeIcon } from '../../../shared/ui/stroke-icon';
import { controlStyles, StatusNotice, ToggleSwitch } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import {
  deleteDepartment,
  loadDepartments,
  loadOrgTree,
  setAgentEnabled,
  setDepartmentEnabled,
} from '../../organization/organization-api';
import { buildOrgHref, TEAM_MODE_PRESENTATION } from '../../organization/organization-labels';
import { AddMemberPanel } from './add-member-panel';
import { AgentDetailPanel } from './agent-detail-panel';
import { DepartmentFormPanel } from './department-form-panel';
import { OrgTreeView } from './org-tree-view';
import styles from './org-screen.module.css';

const PLUS_ICON = 'M12 5v14M5 12h14';

type DepartmentPanel = 'none' | 'create' | 'edit' | 'confirm-delete';

/** /org?dept=&agent= : department tabs, org chart, add-member form and agent detail. */
export function OrgScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const departments = useApiQuery('departments', loadDepartments);
  const [departmentPanel, setDepartmentPanel] = useState<DepartmentPanel>('none');

  const requestedDepartmentId = searchParams.get('dept');
  const selectedAgentId = searchParams.get('agent');
  const departmentList = departments.status === 'success' ? departments.result : [];
  const selectedDepartment =
    departmentList.find((department) => department.id === requestedDepartmentId) ??
    departmentList[0];

  const navigateTo = (departmentId: string, agentId?: string) =>
    router.replace(buildOrgHref(departmentId, agentId), { scroll: false });

  if (departments.status === 'loading') {
    return <p className={styles.mutedText}>Đang tải phòng ban…</p>;
  }
  if (departments.status === 'error') {
    return <StatusNotice outcome={{ tone: 'error', error: departments.error }} />;
  }

  return (
    <div className={styles.screen}>
      <div className={styles.toolbar}>
        <div role="tablist" aria-label="Chọn phòng ban" className={styles.departmentTabs}>
          {departmentList.map((department) => (
            <button
              key={department.id}
              type="button"
              role="tab"
              aria-selected={department.id === selectedDepartment?.id}
              className={styles.departmentTab}
              onClick={() => {
                setDepartmentPanel('none');
                navigateTo(department.id);
              }}
            >
              <span
                aria-hidden="true"
                className={styles.colorDot}
                style={{ background: department.color }}
              />
              {department.name}
            </button>
          ))}
          <button
            type="button"
            className={styles.addDepartmentButton}
            onClick={() => setDepartmentPanel('create')}
          >
            <StrokeIcon path={PLUS_ICON} size={14} strokeWidth={2} />
            Thêm phòng
          </button>
        </div>
        {selectedDepartment !== undefined && (
          <DepartmentToolbar
            department={selectedDepartment}
            onEdit={() => setDepartmentPanel('edit')}
            onDelete={() => setDepartmentPanel('confirm-delete')}
          />
        )}
      </div>

      {departmentPanel === 'create' && (
        <DepartmentFormPanel
          onSaved={(created) => {
            setDepartmentPanel('none');
            navigateTo(created.id);
          }}
          onCancel={() => setDepartmentPanel('none')}
        />
      )}
      {departmentPanel === 'edit' && selectedDepartment !== undefined && (
        <DepartmentFormPanel
          editedDepartment={selectedDepartment}
          onSaved={() => setDepartmentPanel('none')}
          onCancel={() => setDepartmentPanel('none')}
        />
      )}
      {departmentPanel === 'confirm-delete' && selectedDepartment !== undefined && (
        <DeleteDepartmentConfirmation
          department={selectedDepartment}
          onDeleted={() => {
            setDepartmentPanel('none');
            router.replace('/org/', { scroll: false });
          }}
          onCancel={() => setDepartmentPanel('none')}
        />
      )}

      {selectedDepartment === undefined ? (
        departmentPanel !== 'create' && (
          <section className={controlStyles.panel} aria-label="Chưa có phòng ban">
            <h2 className={controlStyles.panelTitle}>Chưa có phòng ban</h2>
            <p className={styles.mutedText}>
              Tạo phòng ban đầu tiên, sau đó thêm trưởng phòng và các thành viên.
            </p>
            <div className={controlStyles.buttonRow}>
              <button
                type="button"
                className={controlStyles.primaryButton}
                onClick={() => setDepartmentPanel('create')}
              >
                Tạo phòng ban
              </button>
            </div>
          </section>
        )
      ) : (
        <DepartmentOrgChart
          key={selectedDepartment.id}
          department={selectedDepartment}
          selectedAgentId={selectedAgentId}
          onSelectAgent={(agentId) => navigateTo(selectedDepartment.id, agentId)}
          onClearAgent={() => navigateTo(selectedDepartment.id)}
        />
      )}
    </div>
  );
}

function DepartmentToolbar({
  department,
  onEdit,
  onDelete,
}: {
  department: Department;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { outcome, isPending, performAction } = useActionOutcome();
  return (
    <div className={styles.departmentActions}>
      <ToggleSwitch
        pressed={department.enabled}
        accessibleLabel={`${department.enabled ? 'Tắt' : 'Bật'} cả ${department.name}`}
        visibleLabel={department.enabled ? 'Phòng đang bật' : 'Phòng đang tắt'}
        onToggle={() =>
          void performAction(
            () => setDepartmentEnabled(department.id, !department.enabled),
            () => null,
          )
        }
        disabled={isPending}
      />
      <button type="button" className={controlStyles.secondaryButton} onClick={onEdit}>
        Sửa phòng
      </button>
      <button type="button" className={controlStyles.secondaryButton} onClick={onDelete}>
        Xoá phòng…
      </button>
      <StatusNotice outcome={outcome} />
    </div>
  );
}

function DeleteDepartmentConfirmation({
  department,
  onDeleted,
  onCancel,
}: {
  department: Department;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const { outcome, isPending, performAction } = useActionOutcome();
  const confirmDeletion = async () => {
    const deleted = await performAction(
      () => deleteDepartment(department.id).then(() => true),
      () => null,
    );
    if (deleted === true) {
      onDeleted();
    }
  };
  return (
    <section
      className={styles.confirmBox}
      role="group"
      aria-label={`Xác nhận xoá ${department.name}`}
    >
      <span>
        Xoá phòng {department.name}? Chỉ xoá được khi phòng không còn thành viên
        {department.agentCount > 0 ? ` (hiện còn ${department.agentCount})` : ''}.
      </span>
      <StatusNotice outcome={outcome} />
      <div className={controlStyles.buttonRow}>
        <button
          type="button"
          className={controlStyles.dangerButton}
          onClick={() => void confirmDeletion()}
          disabled={isPending}
        >
          Xoá phòng
        </button>
        <button type="button" className={controlStyles.secondaryButton} onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </section>
  );
}

function DepartmentOrgChart({
  department,
  selectedAgentId,
  onSelectAgent,
  onClearAgent,
}: {
  department: Department;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onClearAgent: () => void;
}) {
  const orgTree = useApiQuery(`org-tree:${department.id}`, () => loadOrgTree(department.id));
  const [addMemberUnder, setAddMemberUnder] = useState<string | null | undefined>(undefined);
  const { outcome, isPending, performAction } = useActionOutcome();
  const root = orgTree.status === 'success' ? orgTree.result.root : null;
  const isAddingMember = addMemberUnder !== undefined;
  const currentMode = TEAM_MODE_PRESENTATION[department.teamMode];

  return (
    <>
      <section aria-label="Chế độ team" className={styles.teamModeBar}>
        <span className={styles.teamModeLabel}>Chế độ team</span>
        <div role="group" aria-label="Chế độ team" className={styles.teamModeChoices}>
          {TEAM_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={controlStyles.pillButton}
              aria-pressed={department.teamMode === mode}
              disabled
              title="Đổi chế độ team có ở Giai đoạn 3"
            >
              {TEAM_MODE_PRESENTATION[mode].label}
            </button>
          ))}
        </div>
        <span className={styles.teamModeHint}>{currentMode.hint}</span>
      </section>

      <div className={styles.chartLayout}>
        <section aria-label="Sơ đồ phân cấp" className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <h2 className={controlStyles.panelTitle}>Sơ đồ phân cấp {department.name}</h2>
            <button
              type="button"
              className={controlStyles.secondaryButton}
              onClick={() => setAddMemberUnder(root?.positionId ?? null)}
            >
              <span className={styles.buttonIcon}>
                <StrokeIcon path={PLUS_ICON} size={16} strokeWidth={2} />
                Thêm thành viên
              </span>
            </button>
          </div>
          {orgTree.status === 'loading' && <p className={styles.chartEmpty}>Đang tải sơ đồ…</p>}
          {orgTree.status === 'error' && (
            <div className={styles.chartEmpty}>
              <StatusNotice outcome={{ tone: 'error', error: orgTree.error }} />
            </div>
          )}
          {orgTree.status === 'success' && root === null && (
            <p className={styles.chartEmpty}>
              Phòng chưa có thành viên. Bấm “Thêm thành viên” để thêm trưởng phòng.
            </p>
          )}
          {root !== null && (
            <OrgTreeView
              root={root}
              departmentEnabled={department.enabled}
              selectedAgentId={selectedAgentId}
              onSelectAgent={onSelectAgent}
              onAddSubordinate={(positionId) => setAddMemberUnder(positionId)}
              onToggleAgent={(agentId, enabled) =>
                void performAction(
                  () => setAgentEnabled(agentId, enabled),
                  () => null,
                )
              }
              actionsDisabled={isPending}
            />
          )}
          <div className={styles.chartFooter}>
            <span className={styles.legendItem}>
              <span
                aria-hidden="true"
                className={styles.legendRing}
                style={{ borderColor: 'var(--color-success)' }}
              />
              Sẵn sàng
            </span>
            <span className={styles.legendItem}>
              <span
                aria-hidden="true"
                className={styles.legendRing}
                style={{ borderColor: '#5B6782' }}
              />
              Đã tắt
            </span>
            <span className={styles.legendNote}>
              Nút + trên mỗi khối thêm cấp dưới trực tiếp. Mỗi agent chỉ giao việc cho cấp dưới của
              mình.
            </span>
          </div>
          <div className={styles.chartNotice}>
            <StatusNotice outcome={outcome} />
          </div>
        </section>

        <aside className={styles.sidePanels}>
          {isAddingMember && (
            <AddMemberPanel
              key={`${department.id}:${addMemberUnder ?? 'head'}`}
              departmentId={department.id}
              departmentName={department.name}
              root={root}
              presetManagerPositionId={addMemberUnder}
              onAdded={(agent) => {
                setAddMemberUnder(undefined);
                onSelectAgent(agent.id);
              }}
              onCancel={() => setAddMemberUnder(undefined)}
            />
          )}
          {selectedAgentId !== null && (
            <AgentDetailPanel agentId={selectedAgentId} root={root} onRemoved={onClearAgent} />
          )}
        </aside>
      </div>
    </>
  );
}
