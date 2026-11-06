/** Command output and tool details are capped so one noisy step cannot flood memory or the UI. */
const DEFAULT_TEXT_LIMIT = 4_000;
const DETAIL_KEYS = [
  'file_path',
  'path',
  'command',
  'pattern',
  'url',
  'query',
  'description',
] as const;

export function truncateEngineText(text: string, maxLength = DEFAULT_TEXT_LIMIT): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}… (đã cắt bớt)`;
}

/** Short, human-readable summary of a tool call input (the most telling field). */
export function describeToolInput(input: Record<string, unknown> | undefined): string {
  if (input === undefined) {
    return '';
  }
  for (const key of DETAIL_KEYS) {
    const candidate = input[key];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return truncateEngineText(candidate, 300);
    }
  }
  return truncateEngineText(JSON.stringify(input), 300);
}
