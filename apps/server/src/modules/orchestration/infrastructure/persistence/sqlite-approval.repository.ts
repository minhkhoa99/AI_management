import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import type { ApprovalKind, ApprovalStatus } from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import { LiveUpdateHub } from '../../../../shared/events/live-update-hub';
import type {
  ApprovalRecord,
  ApprovalRepository,
} from '../../domain/repositories/approval.repository';

interface ApprovalRow {
  id: string;
  task_id: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  summary: string;
  detail_json: string;
  created_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

const APPROVAL_COLUMNS =
  'id, task_id, kind, status, summary, detail_json, created_at, decided_at, decision_note';
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

@Injectable()
export class SqliteApprovalRepository implements ApprovalRepository {
  private readonly insertStatement: StatementSync;
  private readonly selectByIdStatement: StatementSync;
  private readonly selectPendingOfTaskStatement: StatementSync;
  private readonly selectAllStatement: StatementSync;
  private readonly selectByStatusStatement: StatementSync;
  private readonly decideStatement: StatementSync;

  constructor(
    @Inject(SQLITE_DATABASE) database: DatabaseSync,
    private readonly liveUpdateHub: LiveUpdateHub,
  ) {
    this.insertStatement = database.prepare(
      `INSERT INTO approvals (id, task_id, kind, summary, detail_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ${NOW})`,
    );
    this.selectByIdStatement = database.prepare(
      `SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE id = ?`,
    );
    this.selectPendingOfTaskStatement = database.prepare(
      `SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE task_id = ? AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
    );
    this.selectAllStatement = database.prepare(
      `SELECT ${APPROVAL_COLUMNS} FROM approvals ORDER BY created_at DESC LIMIT 200`,
    );
    this.selectByStatusStatement = database.prepare(
      `SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT 200`,
    );
    this.decideStatement = database.prepare(
      `UPDATE approvals SET status = ?, decision_note = ?, decided_at = ${NOW}
       WHERE id = ? AND status = 'pending'`,
    );
  }

  insertApproval(
    approval: Omit<ApprovalRecord, 'status' | 'createdAt' | 'decidedAt' | 'decisionNote'>,
  ): void {
    this.insertStatement.run(
      approval.id,
      approval.taskId,
      approval.kind,
      approval.summary,
      JSON.stringify(approval.detail),
    );
    this.announceApprovalChange(approval.taskId);
  }

  findApproval(approvalId: string): ApprovalRecord | undefined {
    const row = this.selectByIdStatement.get(approvalId) as ApprovalRow | undefined;
    return row === undefined ? undefined : toApprovalRecord(row);
  }

  findPendingApprovalOfTask(taskId: string): ApprovalRecord | undefined {
    const row = this.selectPendingOfTaskStatement.get(taskId) as ApprovalRow | undefined;
    return row === undefined ? undefined : toApprovalRecord(row);
  }

  listApprovals(status: ApprovalStatus | undefined): ApprovalRecord[] {
    const rows = (status === undefined
      ? this.selectAllStatement.all()
      : this.selectByStatusStatement.all(status)) as unknown as ApprovalRow[];
    return rows.map(toApprovalRecord);
  }

  private announceApprovalChange(taskId: string | null): void {
    this.liveUpdateHub.publishLiveUpdate({
      type: 'approval.changed',
      taskId,
      departmentId: null,
      agentId: null,
      event: null,
    });
  }

  recordDecision(approvalId: string, approved: boolean, note: string | null): boolean {
    const result = this.decideStatement.run(approved ? 'approved' : 'rejected', note, approvalId);
    const decided = Number(result.changes) === 1;
    if (decided) this.announceApprovalChange(this.findApproval(approvalId)?.taskId ?? null);
    return decided;
  }
}

function toApprovalRecord(row: ApprovalRow): ApprovalRecord {
  const detail = JSON.parse(row.detail_json) as Partial<ApprovalRecord['detail']>;
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind,
    status: row.status,
    summary: row.summary,
    detail: {
      stepId: detail.stepId ?? null,
      stepName: detail.stepName ?? null,
      agentId: detail.agentId ?? null,
      agentName: detail.agentName ?? null,
      request: detail.request ?? '',
    },
    createdAt: row.created_at ?? '',
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
  };
}
