import { Injectable } from '@nestjs/common';
import { SKILL_MAX_FILES, SKILL_TOTAL_MAX_BYTES } from '@aiteam/contracts';
import type { SkillFileContent } from '../../application/ports/skill-file-store.port';
import type {
  ArchiveSelection,
  SkillArchiveReader,
} from '../../application/ports/skill-sources.ports';
import { selectSkillFiles } from '../../domain/skill-bundle';
import { listZipFiles, readZipFile } from './zip-archive';

/** Lists the archive, picks the skill's files (limits checked on declared sizes), inflates them. */
@Injectable()
export class ZipSkillArchiveReader implements SkillArchiveReader {
  extractSkillFiles(archive: Buffer, selection: ArchiveSelection): SkillFileContent[] {
    const entries = listZipFiles(archive);
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    const selected = selectSkillFiles(
      entries.map((entry) => ({ path: entry.path, size: entry.size })),
      selection,
      { maxFiles: SKILL_MAX_FILES, maxTotalBytes: SKILL_TOTAL_MAX_BYTES },
    );
    return selected.map((file) => ({
      path: file.targetPath,
      content: readZipFile(archive, byPath.get(file.sourcePath)!),
    }));
  }
}
