export const SKILL_FILE_STORE = Symbol('SKILL_FILE_STORE');

export interface SkillFileContent {
  /** "/" separated, relative; SKILL.md at the root. */
  path: string;
  content: Buffer;
}

/** The files of each skill, in a folder of their own under the data directory. */
export interface SkillFileStore {
  /** Replaces every file of the skill. */
  writeSkillFiles(skillId: string, files: readonly SkillFileContent[]): void;
  readSkillManifest(skillId: string): string;
  writeSkillManifest(skillId: string, text: string): void;
  listSkillFiles(skillId: string): Array<{ path: string; size: number }>;
  /** One file listed by listSkillFiles. */
  readSkillFile(skillId: string, relativePath: string): Buffer;
  removeSkillFiles(skillId: string): void;
  /** Absolute folder of the skill (copied into worktrees). */
  locateSkillFolder(skillId: string): string;
}
