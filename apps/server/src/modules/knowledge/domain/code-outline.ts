import path from 'node:path';

/**
 * What the code index keeps of one file: the names it exports and the modules it imports.
 * Read with regular expressions (no parser): good enough to link files, never executed.
 */
export interface CodeOutline {
  exportedNames: string[];
  importSpecifiers: string[];
}

/** Paths of the repository's code files and its workspace packages (name → directory). */
export interface CodePathIndex {
  paths: ReadonlySet<string>;
  packageDirectories: ReadonlyMap<string, string>;
}

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs'];
const COMPILED_EXTENSION_PATTERN = /\.(?:js|mjs|cjs)$/;

const SCRIPT_DECLARATION_EXPORT =
  /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|(?:const\s+)?enum|const|let|var|interface|type|namespace)\s+([\w$]+)/gm;
const SCRIPT_LIST_EXPORT = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g;
const SCRIPT_IMPORT_PATTERNS = [
  /\bfrom\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*['"]([^'"\n]+)['"]/g,
  /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

const PYTHON_DEFINITION = /^(?:async\s+def|def|class)\s+(\w+)/gm;
const PYTHON_IMPORT = /^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/gm;
const PYTHON_FROM_IMPORT = /^\s*from\s+(\.*[\w.]*)\s+import\b/gm;

export function extractCodeOutline(filePath: string, text: string): CodeOutline {
  if (filePath === 'package.json' || filePath.endsWith('/package.json')) {
    return { exportedNames: readPackageName(text), importSpecifiers: [] };
  }
  if (filePath.endsWith('.py')) {
    return {
      exportedNames: sortedUnique(captureAll(text, PYTHON_DEFINITION)),
      importSpecifiers: sortedUnique([
        ...captureAll(text, PYTHON_IMPORT).flatMap((list) =>
          list.split(',').map((entry) => entry.trim().split(/\s+/)[0] ?? ''),
        ),
        ...captureAll(text, PYTHON_FROM_IMPORT),
      ]),
    };
  }
  const listedNames = captureAll(text, SCRIPT_LIST_EXPORT).flatMap((list) =>
    list.split(',').map((entry) => {
      const words = entry
        .replace(/^\s*type\s+/, '')
        .trim()
        .split(/\s+as\s+/);
      return (words.at(-1) ?? '').trim();
    }),
  );
  return {
    exportedNames: sortedUnique([
      ...captureAll(text, SCRIPT_DECLARATION_EXPORT),
      ...listedNames.filter((name) => name !== 'default'),
    ]),
    importSpecifiers: sortedUnique(
      SCRIPT_IMPORT_PATTERNS.flatMap((pattern) => captureAll(text, pattern)),
    ),
  };
}

/**
 * The indexed file an import points to, or null for anything outside the repository
 * (npm packages, the standard library, paths climbing above the root). Only looks the
 * candidates up in `index`; never touches the file system.
 */
export function resolveImportPath(
  fromPath: string,
  specifier: string,
  index: CodePathIndex,
): string | null {
  const candidates = fromPath.endsWith('.py')
    ? pythonCandidates(fromPath, specifier)
    : scriptCandidates(fromPath, specifier, index.packageDirectories);
  return candidates.find((candidate) => index.paths.has(candidate)) ?? null;
}

function scriptCandidates(
  fromPath: string,
  specifier: string,
  packageDirectories: ReadonlyMap<string, string>,
): string[] {
  if (specifier === '.' || specifier === '..' || /^\.\.?\//.test(specifier)) {
    const target = path.posix.join(path.posix.dirname(fromPath), specifier);
    return isInsideRepository(target) ? expandScriptPath(target) : [];
  }
  const packageName = [...packageDirectories.keys()]
    .filter((name) => specifier === name || specifier.startsWith(`${name}/`))
    .sort((left, right) => right.length - left.length)[0];
  if (packageName === undefined) {
    return [];
  }
  const directory = packageDirectories.get(packageName) ?? '';
  const subPath = specifier.slice(packageName.length + 1);
  const bases =
    subPath === ''
      ? [joinPath(directory, 'src/index'), joinPath(directory, 'index')]
      : [joinPath(directory, subPath), joinPath(directory, `src/${subPath}`)];
  return bases.filter(isInsideRepository).flatMap(expandScriptPath);
}

/** `./b` → b, b.ts, b.tsx…, b/index.ts…; `./c.js` is tried as c.ts first (TypeScript ESM). */
function expandScriptPath(base: string): string[] {
  const normalized = base === '.' ? '' : base;
  const candidates: string[] = [];
  if (COMPILED_EXTENSION_PATTERN.test(normalized)) {
    const withoutExtension = normalized.replace(COMPILED_EXTENSION_PATTERN, '');
    candidates.push(`${withoutExtension}.ts`, `${withoutExtension}.tsx`);
  }
  candidates.push(normalized);
  for (const extension of SCRIPT_EXTENSIONS) {
    candidates.push(`${normalized}${extension}`);
  }
  for (const extension of SCRIPT_EXTENSIONS) {
    candidates.push(joinPath(normalized, `index${extension}`));
  }
  return candidates.filter((candidate) => candidate !== '');
}

/** `a.b` → a/b.py | a/b/__init__.py from the root; `.x` from the file's own package. */
function pythonCandidates(fromPath: string, specifier: string): string[] {
  const leadingDots = /^\.*/.exec(specifier)?.[0].length ?? 0;
  const modulePath = specifier.slice(leadingDots).split('.').filter(Boolean).join('/');
  let base = '';
  if (leadingDots > 0) {
    // One dot is the file's own directory; each extra dot climbs one level.
    const directories = fromPath.split('/').slice(0, -1);
    const kept = directories.length - (leadingDots - 1);
    if (kept < 0) {
      return [];
    }
    base = directories.slice(0, kept).join('/');
  }
  const target = modulePath === '' ? base : joinPath(base, modulePath);
  return modulePath === ''
    ? [joinPath(target, '__init__.py')]
    : [`${target}.py`, joinPath(target, '__init__.py')];
}

function joinPath(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`;
}

function isInsideRepository(repositoryPath: string): boolean {
  return (
    repositoryPath !== '..' && !repositoryPath.startsWith('../') && !repositoryPath.startsWith('/')
  );
}

const NPM_NAME = /^(?:@[a-z0-9~-][\w.~-]*\/)?[a-z0-9~-][\w.~-]*$/i;
const NPM_NAME_MAX_LENGTH = 214;

function readPackageName(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text);
    const name = (parsed as { name?: unknown } | null)?.name;
    // Agent-written file: only an npm package name ever reaches the code map.
    return typeof name === 'string' && name.length <= NPM_NAME_MAX_LENGTH && NPM_NAME.test(name)
      ? [name]
      : [];
  } catch {
    // A broken package.json only means the package has no name to resolve imports with.
    return [];
  }
}

function captureAll(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1] ?? '').filter(Boolean);
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}
