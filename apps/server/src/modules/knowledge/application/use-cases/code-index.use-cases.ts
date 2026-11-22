import path from 'node:path';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { Inject, Injectable } from '@nestjs/common';
import { extractCodeOutline, resolveImportPath } from '../../domain/code-outline';
import {
  buildKnowledgeBriefing,
  scoreTokenOverlap,
  tokenizeSearchText,
  type BriefingFile,
  type BriefingLesson,
  type KnowledgeBriefing,
} from '../../domain/knowledge-briefing';
import {
  CODE_INDEX_REPOSITORY,
  type CodeIndexRepository,
  type IndexedCodeFile,
  type IndexedCodeFileUpdate,
} from '../../domain/repositories/code-index.repository';
import {
  KNOWLEDGE_LESSON_REPOSITORY,
  type KnowledgeLessonRepository,
} from '../../domain/repositories/knowledge-lesson.repository';

/** A source file of the repository's HEAD as orchestration read it from git. */
export interface CodeTreeEntry {
  path: string;
  blobSha: string;
  /** null: unchanged blob, or over this turn's byte budget (the old row stays). */
  text: string | null;
}

export type ReadCodeTree = (
  knownShas: ReadonlyMap<string, string>,
) => Promise<readonly CodeTreeEntry[]>;

const FILES_PER_YIELD = 200;
const MATCHED_LESSONS_MAX = 8;
const MATCHED_FILES_MAX = 10;
const IMPORTERS_PER_FILE_MAX = 10;

/** Brings the index of a repository up to date with its git tree. */
@Injectable()
export class RefreshCodeIndexUseCase {
  constructor(
    @Inject(CODE_INDEX_REPOSITORY) private readonly codeIndexRepository: CodeIndexRepository,
  ) {}

  async refreshCodeIndex(projectKey: string, readTree: ReadCodeTree): Promise<void> {
    const indexedFiles = this.codeIndexRepository.listFiles(projectKey);
    const knownShas = new Map(indexedFiles.map((file) => [file.path, file.blobSha]));
    const entries = await readTree(knownShas);
    const treePaths = new Set(entries.map((entry) => entry.path));
    const index = {
      paths: treePaths,
      packageDirectories: collectPackageDirectories(entries, indexedFiles),
    };
    const updates: IndexedCodeFileUpdate[] = [];
    for (const entry of entries) {
      if (entry.text === null) continue;
      const outline = extractCodeOutline(entry.path, entry.text);
      const importedPaths = new Set(
        outline.importSpecifiers
          .map((specifier) => resolveImportPath(entry.path, specifier, index))
          .filter((target): target is string => target !== null && target !== entry.path),
      );
      updates.push({
        path: entry.path,
        blobSha: entry.blobSha,
        exportedNames: outline.exportedNames,
        searchTerms: [...tokenizeSearchText([entry.path, ...outline.exportedNames].join(' '))],
        importedPaths: [...importedPaths],
      });
      // Up to 5000 files: give the event loop a turn now and then.
      if (updates.length % FILES_PER_YIELD === 0) await yieldToEventLoop();
    }
    // ponytail: imports of an unchanged file are not resolved again when the file they point to
    // appears later; they catch up the next time that file changes.
    const removedPaths = [...knownShas.keys()].filter((known) => !treePaths.has(known));
    this.codeIndexRepository.applyIndexChanges(projectKey, updates, removedPaths);
  }
}

/** Workspace package name -> directory, from package.json read now or kept from the index. */
function collectPackageDirectories(
  entries: readonly CodeTreeEntry[],
  indexedFiles: readonly IndexedCodeFile[],
): Map<string, string> {
  const namesByPath = new Map<string, string[]>();
  for (const file of indexedFiles) namesByPath.set(file.path, file.exportedNames);
  for (const entry of entries) {
    if (entry.text !== null && isPackageManifest(entry.path)) {
      namesByPath.set(entry.path, extractCodeOutline(entry.path, entry.text).exportedNames);
    }
  }
  const directories = new Map<string, string>();
  for (const entry of entries) {
    if (!isPackageManifest(entry.path)) continue;
    const directory = path.posix.dirname(entry.path);
    for (const name of namesByPath.get(entry.path) ?? []) {
      directories.set(name, directory === '.' ? '' : directory);
    }
  }
  return directories;
}

function isPackageManifest(filePath: string): boolean {
  return filePath === 'package.json' || filePath.endsWith('/package.json');
}

/** What a turn should know: relevant lessons and files for its prompt, everything for files. */
@Injectable()
export class DescribeTaskKnowledgeUseCase {
  constructor(
    @Inject(CODE_INDEX_REPOSITORY) private readonly codeIndexRepository: CodeIndexRepository,
    @Inject(KNOWLEDGE_LESSON_REPOSITORY)
    private readonly lessonRepository: KnowledgeLessonRepository,
  ) {}

  describeTaskKnowledge(input: {
    projectKey: string;
    keywords: readonly string[];
    relatedPaths: readonly string[];
  }): KnowledgeBriefing {
    const query = tokenizeSearchText(input.keywords.join(' '));
    const relatedPaths = new Set(input.relatedPaths);

    const lessons = this.lessonRepository.listProjectLessons(input.projectKey);
    const relevantLessons = pickRelevant(
      lessons,
      (lesson) => lesson.paths.some((lessonPath) => relatedPaths.has(lessonPath)),
      (lesson) => scoreTokenOverlap(query, tokenizeSearchText(lesson.body)),
      MATCHED_LESSONS_MAX,
    );

    const files = this.codeIndexRepository.listFiles(input.projectKey);
    const relevantFiles = pickRelevant(
      files,
      (file) => relatedPaths.has(file.path),
      (file) => scoreTokenOverlap(query, new Set(file.searchTerms)),
      MATCHED_FILES_MAX,
    );

    const importedBy = new Map<string, string[]>();
    const imports = new Map<string, string[]>();
    for (const edge of this.codeIndexRepository.listImports(input.projectKey)) {
      appendTo(importedBy, edge.toPath, edge.fromPath);
      appendTo(imports, edge.fromPath, edge.toPath);
    }
    const toBriefingFile = (file: IndexedCodeFile): BriefingFile => ({
      path: file.path,
      exportedNames: file.exportedNames,
      importedBy: (importedBy.get(file.path) ?? []).slice(0, IMPORTERS_PER_FILE_MAX),
      imports: imports.get(file.path) ?? [],
    });
    const toBriefingLesson = ({ body, occurrences, source }: BriefingLesson): BriefingLesson => ({
      body,
      occurrences,
      source,
    });

    return buildKnowledgeBriefing({
      relevantLessons: relevantLessons.map(toBriefingLesson),
      relevantFiles: relevantFiles.map(toBriefingFile),
      allLessons: lessons.map(toBriefingLesson),
      allFiles: files.map(toBriefingFile),
    });
  }
}

/** Every item tied to the task, then the best-scoring others (score > 0), in their order. */
function pickRelevant<Item>(
  items: readonly Item[],
  isTied: (item: Item) => boolean,
  score: (item: Item) => number,
  maxMatches: number,
): Item[] {
  const tied = items.filter(isTied);
  const tiedItems = new Set(tied);
  const matched = items
    .filter((item) => !tiedItems.has(item))
    .map((item) => ({ item, score: score(item) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxMatches)
    .map((entry) => entry.item);
  return [...tied, ...matched];
}

function appendTo(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key);
  if (values === undefined) map.set(key, [value]);
  else values.push(value);
}
