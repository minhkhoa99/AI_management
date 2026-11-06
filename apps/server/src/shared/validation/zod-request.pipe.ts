import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ValidationError } from '../errors/app-error';

export interface ValidationIssue {
  path: string;
  message: string;
}

/** Parses untrusted input with a shared contract schema; failures become a 400 with details. */
export function parseWithSchema<Schema extends z.ZodType>(
  schema: Schema,
  untrustedInput: unknown,
  inputLabel: string,
): z.infer<Schema> {
  const parsed = schema.safeParse(untrustedInput);
  if (!parsed.success) {
    const issues: ValidationIssue[] = parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));
    throw new ValidationError(`${inputLabel} không hợp lệ.`, { details: issues });
  }
  return parsed.data;
}

/** Nest pipe wrapper: `@Body(new ZodRequestPipe(schema, 'Dữ liệu'))`. */
export class ZodRequestPipe<Schema extends z.ZodType> implements PipeTransform {
  constructor(
    private readonly schema: Schema,
    private readonly inputLabel = 'Dữ liệu gửi lên',
  ) {}

  transform(untrustedInput: unknown): z.infer<Schema> {
    return parseWithSchema(this.schema, untrustedInput, this.inputLabel);
  }
}
