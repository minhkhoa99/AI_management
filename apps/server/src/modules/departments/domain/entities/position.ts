/** A seat in a department's org chart. In phase 1 every seat holds exactly one agent. */
export interface Position {
  readonly id: string;
  readonly departmentId: string;
  readonly title: string;
  readonly reportsToPositionId: string | null;
  readonly agentId: string;
}
