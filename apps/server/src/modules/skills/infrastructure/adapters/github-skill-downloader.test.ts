import { describe, expect, it } from 'vitest';
import { parseGithubSkillUrl } from './github-skill-downloader';

describe('parseGithubSkillUrl', () => {
  it.each([
    [
      'https://github.com/anthropics/skills',
      { owner: 'anthropics', repository: 'skills', ref: 'HEAD', path: '', kind: 'folder' },
    ],
    [
      'https://github.com/anthropics/skills/tree/main/skills/pdf',
      {
        owner: 'anthropics',
        repository: 'skills',
        ref: 'main',
        path: 'skills/pdf',
        kind: 'folder',
      },
    ],
    [
      'https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md',
      {
        owner: 'anthropics',
        repository: 'skills',
        ref: 'main',
        path: 'skills/pdf',
        kind: 'folder',
      },
    ],
    [
      'https://github.com/me/notes/blob/v1/guides/review.md',
      { owner: 'me', repository: 'notes', ref: 'v1', path: 'guides/review.md', kind: 'markdown' },
    ],
  ])('reads %s', (url, expected) => {
    expect(parseGithubSkillUrl(url)).toEqual(expected);
  });

  it.each([
    'https://gitlab.com/a/b',
    'https://github.com/a/b/blob/main/script.sh',
    'https://github.com/a/b/tree/main/../../etc',
    'http://github.com/a/b',
  ])('refuses %s', (url) => {
    expect(() => parseGithubSkillUrl(url)).toThrow();
  });
});
