import { ValidationError } from '../errors/app-error';

/**
 * Human-entered name: trimmed, Unicode-normalised (NFC) and length-checked. Comparison ignores
 * case with Vietnamese rules, so "Phòng Dev" and "PHÒNG DEV" are the same name.
 */
export class DisplayName {
  private constructor(readonly text: string) {}

  static parse(rawText: string, maxLength: number, errorCode: string): DisplayName {
    const text = rawText.normalize('NFC').trim();
    if (text.length === 0 || text.length > maxLength) {
      throw new ValidationError(`Tên phải có từ 1 đến ${maxLength} ký tự.`, { code: errorCode });
    }
    return new DisplayName(text);
  }

  isSameNameAs(other: DisplayName): boolean {
    return this.comparisonKey() === other.comparisonKey();
  }

  private comparisonKey(): string {
    return this.text.toLocaleLowerCase('vi');
  }
}
