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

/**
 * agy matches a prefix rule such as `command(git push)` only against the whole command line on
 * Windows, so every prefix becomes a case-insensitive regex that matches anywhere in the line.
 * No backslash may appear: agy decodes rule strings twice (`\s` is rejected, `\b` turns into a
 * backspace character), so spaces are written as `[ ]+`.
 */
function toCommandRegexRules(prefixes: CommandPrefixes): string[] {
  return [...prefixes.shell, ...prefixes.powershell].map(
    (prefix) => `command(regex:(?i).*${prefix.split(' ').join('[ ]+')}.*)`,
  );
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
