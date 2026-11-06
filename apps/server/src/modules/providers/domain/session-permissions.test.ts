import { describe, expect, it } from 'vitest';
import { resolveSessionPermissions } from './session-permissions';

const permissiveEngine = { defaultModel: null, blockDangerousCommands: false, allowNetwork: true };
const strictEngine = { defaultModel: null, blockDangerousCommands: true, allowNetwork: false };

describe('resolveSessionPermissions', () => {
  it('keeps the agent decision when the engine allows everything', () => {
    expect(
      resolveSessionPermissions(
        { accessLevel: 'edit_workspace', networkAccess: true },
        permissiveEngine,
      ),
    ).toEqual({
      accessLevel: 'edit_workspace',
      networkAccess: true,
      blockDangerousCommands: false,
    });
  });

  it('caps network access with the engine ceiling', () => {
    expect(
      resolveSessionPermissions(
        { accessLevel: 'edit_workspace', networkAccess: true },
        strictEngine,
      ),
    ).toEqual({
      accessLevel: 'edit_workspace',
      networkAccess: false,
      blockDangerousCommands: true,
    });
  });

  it('never grants what the agent does not have', () => {
    expect(
      resolveSessionPermissions(
        { accessLevel: 'read_only', networkAccess: false },
        permissiveEngine,
      ),
    ).toMatchObject({ accessLevel: 'read_only', networkAccess: false });
  });

  it('blocks dangerous commands by default for engines without local settings', () => {
    expect(
      resolveSessionPermissions({ accessLevel: 'read_only', networkAccess: true }, null),
    ).toEqual({
      accessLevel: 'read_only',
      networkAccess: true,
      blockDangerousCommands: true,
    });
  });
});
