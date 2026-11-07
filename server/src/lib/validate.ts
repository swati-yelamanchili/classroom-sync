import type { z } from 'zod';
import { ApiError } from './errors';

export function parseBody<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
    throw new ApiError(400, 'invalid_request', details[0]?.message ?? 'Invalid request.', details);
  }
  return result.data;
}
