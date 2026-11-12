import { ValidationError } from '../../../../../shared/errors/app-error';
import { ENGINE_MANAGED_WORKSPACE_PATHS } from '../../../../../shared/runtime/engine-managed-paths';
import type { SessionPermissions } from '../../../../orchestration/application/ports/agent-engine.port';
import {
  type CommandPrefixes,
  DANGEROUS_COMMAND_PREFIXES,
  NETWORK_COMMAND_PREFIXES,
} from '../../../domain/command-restrictions';

/** The JSON passed to `agy --settings` for one run. */
export interface AntigravitySettings {
  allowNonWorkspaceAccess: false;
  permissions: { allow: string[]; deny: string[] };
}

/** Prefixes may only hold letters, digits, spaces and `-`: nothing else may change the regex. */
const SAFE_COMMAND_PREFIX = /^[A-Za-z0-9-]+(?: +[A-Za-z0-9-]+)*$/;

/**
 * agy matches a rule only against the WHOLE command line, so each prefix becomes a
 * case-insensitive regex that matches anywhere in it. The `s` flag lets `.` cross a newline (a
 * two-line command whose second line is `git push` would otherwise slip past `.*`), and every
 * run of spaces becomes `[[:space:]]+` (any whitespace). No backslash may appear: agy decodes
 * rule strings twice (a backslash-s is rejected, a backslash-b turns into a backspace character).
 */
export function buildCommandRegexRule(prefix: string): string {
  if (!SAFE_COMMAND_PREFIX.test(prefix)) {
    throw new ValidationError(
      `Tiền tố lệnh "${prefix}" chỉ được chứa chữ, số, khoảng trắng và dấu "-".`,
      { code: 'COMMAND_PREFIX_UNSAFE' },
    );
  }
  return `command(regex:(?is).*${prefix.split(/ +/).join('[[:space:]]+')}.*)`;
}

function toCommandRegexRules(prefixes: CommandPrefixes): string[] {
  return [...prefixes.shell, ...prefixes.powershell].map(buildCommandRegexRule);
}

/** Write protection for the config folders an engine loads commands from (see ENGINE_MANAGED_WORKSPACE_PATHS). */
function managedFolderWriteDenies(): string[] {
  return ENGINE_MANAGED_WORKSPACE_PATHS.flatMap((folder) => [
    `write_file(${folder}/)`,
    `write_file(${folder})`,
  ]);
}

export function buildAntigravitySettings(permissions: SessionPermissions): AntigravitySettings {
  const allow: string[] = [];
  const deny: string[] = ['mcp(*)', 'execute_url(*)'];

  if (permissions.accessLevel === 'edit_workspace') {
    allow.push('command(*)');
    deny.push(...managedFolderWriteDenies());
  } else {
    deny.push('write_file(*)', 'command(*)');
  }

  if (permissions.networkAccess) {
    allow.push('read_url(*)');
  } else {
    deny.push('read_url(*)', ...toCommandRegexRules(NETWORK_COMMAND_PREFIXES));
  }

  if (permissions.blockDangerousCommands) {
    deny.push(...toCommandRegexRules(DANGEROUS_COMMAND_PREFIXES));
  }

  return { allowNonWorkspaceAccess: false, permissions: { allow, deny } };
}
