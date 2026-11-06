import { DEPARTMENT_NAME_MAX_LENGTH, type TeamMode } from '@aiteam/contracts';
import { ConflictError } from '../../../../shared/errors/app-error';
import { DisplayName } from '../../../../shared/domain/display-name';
import { parseHexColor } from '../value-objects/hex-color';

export interface DepartmentState {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  teamMode: TeamMode;
}

export class Department {
  private constructor(private state: DepartmentState) {}

  /** A brand-new department: enabled, coordinated by the built-in orchestrator. */
  static createNew(input: { id: string; name: string; color: string }): Department {
    return new Department({
      id: input.id,
      name: parseDepartmentName(input.name).text,
      color: parseHexColor(input.color),
      enabled: true,
      teamMode: 'orchestrator',
    });
  }

  /** Rebuilds a department loaded from storage (already validated when it was saved). */
  static restore(state: DepartmentState): Department {
    return new Department({ ...state });
  }

  get id(): string {
    return this.state.id;
  }

  get name(): string {
    return this.state.name;
  }

  get enabled(): boolean {
    return this.state.enabled;
  }

  rename(newName: string): void {
    this.state.name = parseDepartmentName(newName).text;
  }

  recolor(newColor: string): void {
    this.state.color = parseHexColor(newColor);
  }

  setEnabled(enabled: boolean): void {
    this.state.enabled = enabled;
  }

  hasSameNameAs(otherName: string): boolean {
    return parseDepartmentName(this.state.name).isSameNameAs(parseDepartmentName(otherName));
  }

  /** A disabled department keeps its members but must not receive new tasks (used in phase 3). */
  assertAcceptsNewTasks(): void {
    if (!this.state.enabled) {
      throw new ConflictError(`Phòng "${this.state.name}" đang tắt, không nhận task mới.`, {
        code: 'DEPARTMENT_DISABLED',
      });
    }
  }

  toState(): DepartmentState {
    return { ...this.state };
  }
}

export function parseDepartmentName(rawName: string): DisplayName {
  return DisplayName.parse(rawName, DEPARTMENT_NAME_MAX_LENGTH, 'DEPARTMENT_NAME_INVALID');
}
