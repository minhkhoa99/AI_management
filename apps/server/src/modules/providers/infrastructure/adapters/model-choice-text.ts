/** Limits for model choices read from a CLI (text the CLI controls, shown in the picker). */
export const MAX_MODEL_CHOICES = 30;
const MAX_LENGTH = { label: 60, note: 160 } as const;

export function clipCatalogText(text: string, kind: keyof typeof MAX_LENGTH): string {
  const maxLength = MAX_LENGTH[kind];
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}
