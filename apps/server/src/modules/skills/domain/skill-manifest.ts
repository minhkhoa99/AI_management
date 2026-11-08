/** The file every skill has at its root, as in Claude Code / Agent Skills. */
export const SKILL_MANIFEST_FILE = 'SKILL.md';

export interface SkillManifest {
  name: string | null;
  description: string | null;
  /** Instructions after the front matter. */
  body: string;
}

const FRONT_MATTER_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Reads the `name` and `description` of a SKILL.md front matter (a small YAML subset: one-line
 * values, quoted or not, and `>`/`|` blocks). Other keys are ignored. No front matter: the whole
 * text is the body.
 */
export function parseSkillManifest(text: string): SkillManifest {
  const normalised = text.replace(/^\uFEFF/, '');
  const match = FRONT_MATTER_PATTERN.exec(normalised);
  if (match === null) return { name: null, description: null, body: normalised.trim() };
  const values = readFrontMatterValues(match[1] ?? '');
  return {
    name: values.get('name') ?? null,
    description: values.get('description') ?? null,
    body: normalised.slice(match[0].length).trim(),
  };
}

/** SKILL.md with a front matter Claude Code and Codex both understand. */
export function buildSkillManifest(manifest: {
  name: string;
  description: string;
  body: string;
}): string {
  // JSON strings are valid YAML scalars: any character in a name or description stays safe.
  return [
    '---',
    `name: ${JSON.stringify(manifest.name)}`,
    `description: ${JSON.stringify(manifest.description)}`,
    '---',
    '',
    manifest.body.trim(),
    '',
  ].join('\n');
}

function readFrontMatterValues(frontMatter: string): Map<string, string> {
  const values = new Map<string, string>();
  const lines = frontMatter.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(lines[index] ?? '');
    if (match === null) continue;
    const key = match[1]!.toLowerCase();
    let value = (match[2] ?? '').trim();
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const block: string[] = [];
      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1] ?? '')) {
        index += 1;
        block.push((lines[index] ?? '').trim());
      }
      value = block.join(value.startsWith('>') ? ' ' : '\n');
    } else {
      value = unquote(value);
    }
    values.set(key, value);
  }
  return values;
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      return String(JSON.parse(value));
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

/** Folder name of a skill in the agent's worktree: ASCII, lower case, dashes. */
export function toSkillSlug(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug === '' ? 'skill' : slug;
}
