import { describe, expect, it } from 'vitest';
import { evaluateNodeVersion } from './node-version-policy.mjs';

describe('evaluateNodeVersion', () => {
  it.each(['v22.23.4', 'v22.24.0', 'v24.22.1', 'v24.22.2', 'v26.12.1', 'v26.13.0', 'v28.0.0'])(
    'accepts patched or newer version %s',
    (version) => {
      expect(evaluateNodeVersion(version).accepted).toBe(true);
    },
  );

  it.each([
    ['v22.23.3', /22\.23\.4/],
    ['v22.12.0', /22\.23\.4/],
    ['v24.21.0', /24\.22\.1/],
    ['v26.12.0', /26\.12\.1/],
    ['v23.11.0', /LTS/],
    ['v25.0.0', /LTS/],
    ['v20.19.0', /LTS/],
    ['not-a-version', /Không đọc được/],
  ])('rejects %s', (version, reasonPattern) => {
    const verdict = evaluateNodeVersion(version);

    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toMatch(reasonPattern);
  });
});
