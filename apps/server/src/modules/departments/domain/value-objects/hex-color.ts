import { ValidationError } from '../../../../shared/errors/app-error';

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Department colour as #RRGGBB, stored upper-case. */
export function parseHexColor(rawColor: string): string {
  if (!HEX_COLOR_PATTERN.test(rawColor)) {
    throw new ValidationError('Màu phải có dạng #RRGGBB.', { code: 'COLOR_INVALID' });
  }
  return rawColor.toUpperCase();
}
