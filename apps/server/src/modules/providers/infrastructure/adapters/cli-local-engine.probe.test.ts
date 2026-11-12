import { describe, expect, it } from 'vitest';
import { readAntigravitySignIn } from './cli-local-engine.probe';

describe('readAntigravitySignIn', () => {
  it('treats a model list that came back as signed in', () => {
    expect(readAntigravitySignIn({ succeeded: true, output: 'agy-flash\nagy-pro' })).toEqual({
      signedIn: true,
      accountDetail: null,
      problem: null,
    });
  });

  it('reports a missing sign-in, whatever the letter case', () => {
    expect(
      readAntigravitySignIn({ succeeded: false, output: 'Error: Authentication Required' }),
    ).toEqual({ signedIn: false, accountDetail: null, problem: 'Chưa đăng nhập. Chạy: agy' });
  });

  it('keeps the first line of any other failure as the problem', () => {
    expect(
      readAntigravitySignIn({ succeeded: false, output: '\n  network unreachable\nmore' }),
    ).toEqual({ signedIn: null, accountDetail: null, problem: 'network unreachable' });
  });
});
