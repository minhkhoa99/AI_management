import { ValidationError } from '../../../shared/errors/app-error';
import { SKILL_MANIFEST_FILE } from './skill-manifest';

export interface BundleCandidate {
  /** "/" separated path inside the archive (already checked to be safe). */
  path: string;
  size: number;
}

export interface SelectedSkillFile {
  sourcePath: string;
  /** Path inside the skill folder; the manifest is always SKILL.md at the root. */
  targetPath: string;
}

export interface SkillBundleLimits {
  maxFiles: number;
  maxTotalBytes: number;
}

/**
 * Picks the files of one skill out of an archive: the folder holding SKILL.md (the shallowest
 * one; two at that depth is ambiguous), or, without any SKILL.md, the only Markdown file at the
 * top, which becomes SKILL.md. `folder` narrows the search (a GitHub /tree/<ref>/<folder> link).
 * GitHub archives wrap everything in one "<repo>-<ref>/" folder, which `stripTopFolder` removes.
 */
export function selectSkillFiles(
  candidates: readonly BundleCandidate[],
  options: { folder: string | null; stripTopFolder: boolean },
  limits: SkillBundleLimits,
): SelectedSkillFile[] {
  let files = candidates.map((candidate) => ({ ...candidate, relative: candidate.path }));
  if (options.stripTopFolder) {
    files = files
      .filter((file) => file.relative.includes('/'))
      .map((file) => ({ ...file, relative: file.relative.slice(file.relative.indexOf('/') + 1) }));
  }
  const folder = (options.folder ?? '').replace(/^\/+|\/+$/g, '');
  if (folder !== '') {
    files = files
      .filter((file) => file.relative.startsWith(`${folder}/`))
      .map((file) => ({ ...file, relative: file.relative.slice(folder.length + 1) }));
    if (files.length === 0) {
      throw new ValidationError(`Không tìm thấy thư mục "${folder}".`, {
        code: 'SKILL_FOLDER_NOT_FOUND',
      });
    }
  }

  const root = locateSkillRoot(files.map((file) => file.relative));
  const selected = files
    .filter((file) => root.prefix === '' || file.relative.startsWith(root.prefix))
    .map((file) => {
      const inside = file.relative.slice(root.prefix.length);
      return {
        sourcePath: file.path,
        size: file.size,
        targetPath: inside === root.manifest ? SKILL_MANIFEST_FILE : inside,
      };
    })
    // A loose Markdown file becomes SKILL.md; other top-level files of that archive are left out.
    .filter((file) => !root.loose || file.targetPath === SKILL_MANIFEST_FILE);

  if (selected.length > limits.maxFiles) {
    throw new ValidationError(`Skill có quá ${limits.maxFiles} file.`, {
      code: 'SKILL_TOO_MANY_FILES',
    });
  }
  const totalBytes = selected.reduce((total, file) => total + file.size, 0);
  if (totalBytes > limits.maxTotalBytes) {
    throw new ValidationError(
      `Skill quá lớn (${Math.round(totalBytes / 1024 / 1024)} MB, tối đa ${Math.round(limits.maxTotalBytes / 1024 / 1024)} MB).`,
      { code: 'SKILL_TOO_LARGE' },
    );
  }
  return selected
    .sort((first, second) =>
      first.targetPath === SKILL_MANIFEST_FILE
        ? -1
        : second.targetPath === SKILL_MANIFEST_FILE
          ? 1
          : 0,
    )
    .map(({ sourcePath, targetPath }) => ({ sourcePath, targetPath }));
}

/** Folder prefix ("" or "pdf/") of the skill and the name of its manifest in that folder. */
function locateSkillRoot(paths: readonly string[]): {
  prefix: string;
  manifest: string;
  /** No SKILL.md: a single Markdown file stands in for it. */
  loose: boolean;
} {
  const depth = (filePath: string) => filePath.split('/').length;
  const manifests = paths.filter(
    (filePath) => (filePath.split('/').at(-1) ?? '').toLowerCase() === 'skill.md',
  );
  if (manifests.length > 0) {
    const shallowest = Math.min(...manifests.map(depth));
    const top = manifests.filter((filePath) => depth(filePath) === shallowest);
    if (top.length > 1) {
      throw new ValidationError(
        `Gói có nhiều skill (${top.join(', ')}). Hãy chọn một thư mục, vd link …/tree/<nhánh>/<thư mục skill>.`,
        { code: 'SKILL_AMBIGUOUS' },
      );
    }
    const manifestPath = top[0]!;
    const slash = manifestPath.lastIndexOf('/');
    return {
      prefix: slash === -1 ? '' : manifestPath.slice(0, slash + 1),
      manifest: manifestPath.slice(slash + 1),
      loose: false,
    };
  }
  const markdown = paths.filter((filePath) => !filePath.includes('/') && /\.md$/i.test(filePath));
  if (markdown.length === 1) return { prefix: '', manifest: markdown[0]!, loose: true };
  throw new ValidationError('Không tìm thấy SKILL.md trong gói.', {
    code: 'SKILL_MANIFEST_MISSING',
  });
}
