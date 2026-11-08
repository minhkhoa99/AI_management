import type { SkillFileContent } from './skill-file-store.port';

export const SKILL_ARCHIVE_READER = Symbol('SKILL_ARCHIVE_READER');
export const GITHUB_SKILL_DOWNLOADER = Symbol('GITHUB_SKILL_DOWNLOADER');

/** Where the skill sits inside an archive (GitHub link folder) and how the archive is wrapped. */
export interface ArchiveSelection {
  folder: string | null;
  stripTopFolder: boolean;
}

export interface SkillArchiveReader {
  /** The files of the one skill in a .zip, SKILL.md first; refuses unsafe or oversized archives. */
  extractSkillFiles(archive: Buffer, selection: ArchiveSelection): SkillFileContent[];
}

export type GithubSkillSource =
  | { kind: 'archive'; archive: Buffer; selection: ArchiveSelection }
  | { kind: 'markdown'; text: string };

export interface GithubSkillDownloader {
  /** Downloads a repository folder (as a zip) or a single .md file from github.com. */
  downloadGithubSkill(url: string): Promise<GithubSkillSource>;
}
