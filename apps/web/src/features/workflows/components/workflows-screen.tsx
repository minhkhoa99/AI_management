'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { Department, Workflow } from '@aiteam/contracts';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { DepartmentTabs } from '../../organization/components/department-tabs';
import { loadAgents, loadDepartments } from '../../organization/organization-api';
import type { EditableStep } from '../workflow-step-drafts';
import { loadWorkflows, loadWorkflowTemplates } from '../workflows-api';
import { WorkflowCards } from './workflow-cards';
import { WorkflowEditor } from './workflow-editor';
import { WorkflowFormPanel } from './workflow-form-panel';
import styles from './workflows.module.css';

function buildWorkflowsHref(departmentId: string, workflowId?: string): string {
  const query = new URLSearchParams({ dept: departmentId });
  if (workflowId !== undefined) query.set('workflow', workflowId);
  return `/workflows/?${query.toString()}`;
}

/** /workflows?dept=&workflow= : workflows of a department, the step chain and its rules. */
export function WorkflowsScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const departments = useApiQuery('departments', loadDepartments);
  const departmentList = departments.status === 'success' ? departments.result : [];
  const selectedDepartment =
    departmentList.find((department) => department.id === searchParams.get('dept')) ??
    departmentList[0];

  const navigateTo = (departmentId: string, workflowId?: string) =>
    router.replace(buildWorkflowsHref(departmentId, workflowId), { scroll: false });

  if (departments.status === 'loading') {
    return <p className={styles.mutedText}>Đang tải phòng ban…</p>;
  }
  if (departments.status === 'error') {
    return <StatusNotice outcome={{ tone: 'error', error: departments.error }} />;
  }

  return (
    <div className={styles.screen}>
      <DepartmentTabs
        departments={departmentList}
        selectedDepartmentId={selectedDepartment?.id}
        onSelectDepartment={(departmentId) => navigateTo(departmentId)}
      />
      {selectedDepartment === undefined ? (
        <section className={controlStyles.panel} aria-label="Chưa có phòng ban">
          <h2 className={controlStyles.panelTitle}>Chưa có phòng ban</h2>
          <p className={styles.mutedText}>
            Quy trình thuộc về một phòng ban. Tạo phòng ban ở màn hình Sơ đồ tổ chức trước.
          </p>
        </section>
      ) : (
        <DepartmentWorkflows
          key={selectedDepartment.id}
          department={selectedDepartment}
          requestedWorkflowId={searchParams.get('workflow')}
          onSelectWorkflow={(workflowId) => navigateTo(selectedDepartment.id, workflowId)}
        />
      )}
    </div>
  );
}

type WorkflowPanel = 'none' | 'create' | 'edit';

function DepartmentWorkflows({
  department,
  requestedWorkflowId,
  onSelectWorkflow,
}: {
  department: Department;
  requestedWorkflowId: string | null;
  onSelectWorkflow: (workflowId: string) => void;
}) {
  const workflows = useApiQuery(`workflows:${department.id}`, () => loadWorkflows(department.id));
  const agents = useApiQuery(`agents:${department.id}`, () => loadAgents(department.id));
  const templates = useApiQuery('workflow-templates', loadWorkflowTemplates);
  const [panel, setPanel] = useState<WorkflowPanel>('none');
  // Unsaved step edits per workflow, so switching between workflows does not lose them.
  const [unsavedSteps, setUnsavedSteps] = useState<Record<string, EditableStep[]>>({});

  if (workflows.status === 'loading') {
    return <p className={styles.mutedText}>Đang tải quy trình…</p>;
  }
  if (workflows.status === 'error') {
    return <StatusNotice outcome={{ tone: 'error', error: workflows.error }} />;
  }

  const workflowList = workflows.result;
  const selectedWorkflow: Workflow | undefined =
    workflowList.find((workflow) => workflow.id === requestedWorkflowId) ?? workflowList[0];
  const forgetUnsavedSteps = (workflowId: string) =>
    setUnsavedSteps(({ [workflowId]: _discarded, ...others }) => others);

  return (
    <>
      <WorkflowCards
        workflows={workflowList}
        selectedWorkflowId={selectedWorkflow?.id}
        unsavedWorkflowIds={Object.keys(unsavedSteps)}
        onSelectWorkflow={onSelectWorkflow}
        onEditWorkflow={(workflowId) => {
          onSelectWorkflow(workflowId);
          setPanel('edit');
        }}
        onCreateWorkflow={() => setPanel('create')}
        onWorkflowDeleted={forgetUnsavedSteps}
        onWorkflowCreated={(created) => onSelectWorkflow(created.id)}
      />

      {panel !== 'none' && (
        <WorkflowFormPanel
          key={panel === 'edit' ? `edit:${selectedWorkflow?.id ?? ''}` : 'create'}
          departmentId={department.id}
          departmentName={department.name}
          editedWorkflow={panel === 'edit' ? selectedWorkflow : undefined}
          copyableWorkflow={selectedWorkflow}
          templates={templates.status === 'success' ? templates.result : []}
          onSaved={(saved) => {
            setPanel('none');
            onSelectWorkflow(saved.id);
          }}
          onCancel={() => setPanel('none')}
        />
      )}

      {workflowList.length === 0 && panel !== 'create' && (
        <section className={controlStyles.panel} aria-label="Chưa có quy trình">
          <h2 className={controlStyles.panelTitle}>{department.name} chưa có quy trình</h2>
          <p className={styles.mutedText}>
            Không có quy trình, người được giao tự quyết thứ tự làm việc. Tạo quy trình từ mẫu để
            task đi qua các bước có điều kiện.
          </p>
          <div className={controlStyles.buttonRow}>
            <button
              type="button"
              className={controlStyles.primaryButton}
              onClick={() => setPanel('create')}
            >
              Tạo quy trình
            </button>
          </div>
        </section>
      )}

      {selectedWorkflow !== undefined && (
        <WorkflowEditor
          key={selectedWorkflow.id}
          workflow={selectedWorkflow}
          departmentName={department.name}
          departmentAgents={agents.status === 'success' ? agents.result : []}
          templates={templates.status === 'success' ? templates.result : []}
          unsavedSteps={unsavedSteps[selectedWorkflow.id]}
          onStepsEdited={(steps) =>
            setUnsavedSteps((previous) => ({ ...previous, [selectedWorkflow.id]: steps }))
          }
          onStepsSavedOrDiscarded={() => forgetUnsavedSteps(selectedWorkflow.id)}
        />
      )}
    </>
  );
}
