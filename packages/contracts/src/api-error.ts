import { z } from 'zod';

/** JSON body returned by the server for every failed API request. */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
    traceId: z.string().min(1),
    retryAfterMs: z.number().int().nonnegative().optional(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
