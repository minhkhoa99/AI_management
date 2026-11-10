import { describe, expect, it } from 'vitest';
import { buildAntigravitySettings } from './antigravity-settings';

const readOnlyOffline = {
  accessLevel: 'read_only',
  networkAccess: false,
  blockDangerousCommands: true,
} as const;
const editOnline = {
  accessLevel: 'edit_workspace',
  networkAccess: true,
  blockDangerousCommands: false,
} as const;
const MANAGED_WRITE_DENIES = [
  'write_file(.agents/)',
  'write_file(.agents)',
  'write_file(.agent/)',
  'write_file(.agent)',
  'write_file(_agents/)',
  'write_file(_agents)',
  'write_file(_agent/)',
  'write_file(_agent)',
  'write_file(.gemini/)',
  'write_file(.gemini)',
];

describe('buildAntigravitySettings', () => {
  it('read-only, offline: denies writes, commands, urls, MCP and the browser', () => {
    expect(buildAntigravitySettings(readOnlyOffline)).toEqual({
      allowNonWorkspaceAccess: false,
      permissions: {
        allow: [],
        deny: [
          'mcp(*)',
          'execute_url(*)',
          'write_file(*)',
          'command(*)',
          'read_url(*)',
          'command(regex:(?i).*curl.*)',
          'command(regex:(?i).*wget.*)',
          'command(regex:(?i).*Invoke-WebRequest.*)',
          'command(regex:(?i).*rm[ ]+-rf.*)',
          'command(regex:(?i).*git[ ]+push.*)',
          'command(regex:(?i).*git[ ]+reset[ ]+--hard.*)',
          'command(regex:(?i).*npm[ ]+publish.*)',
          'command(regex:(?i).*Remove-Item.*)',
        ],
      },
    });
  });

  it('edit, online, dangerous commands allowed: commands and urls pre-approved, config folders write-protected', () => {
    expect(buildAntigravitySettings(editOnline)).toEqual({
      allowNonWorkspaceAccess: false,
      permissions: {
        allow: ['command(*)', 'read_url(*)'],
        deny: ['mcp(*)', 'execute_url(*)', ...MANAGED_WRITE_DENIES],
      },
    });
  });

  it('edit, offline, blocking: dangerous and network commands denied although commands are allowed', () => {
    const settings = buildAntigravitySettings({
      ...editOnline,
      networkAccess: false,
      blockDangerousCommands: true,
    });
    expect(settings.permissions.allow).toEqual(['command(*)']);
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining([
        'read_url(*)',
        'command(regex:(?i).*curl.*)',
        'command(regex:(?i).*git[ ]+push.*)',
      ]),
    );
    expect(settings.permissions.deny).not.toContain('command(*)');
  });

  it('no rule contains a backslash (agy decodes rule strings twice)', () => {
    for (const permissions of [
      readOnlyOffline,
      editOnline,
      { ...editOnline, networkAccess: false, blockDangerousCommands: true },
    ]) {
      expect(JSON.stringify(buildAntigravitySettings(permissions).permissions)).not.toContain('\\');
    }
  });
});
