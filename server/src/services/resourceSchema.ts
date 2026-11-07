import { z } from 'zod';
import { PROVENANCES, isAllowedVideoUrl } from '@classroom/shared';

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim())
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const stringList = z
  .union([z.array(z.string().max(200)), z.string().max(4000)])
  .optional()
  .transform((value) => {
    const items = typeof value === 'string' ? value.split(/[;|]/) : (value ?? []);
    return items.map((item) => item.trim()).filter(Boolean);
  });

/** Used by manual entry and by both import formats, so all resources meet the same rules. */
export const resourceInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required.').max(200),
    subject: optionalText(120),
    topic: optionalText(200),
    description: optionalText(2000),
    keywords: stringList,
    aliases: stringList,
    videoUrl: optionalText(2000).refine((v) => v === null || isAllowedVideoUrl(v), {
      message: 'Video URL must be a valid http(s) link.',
    }),
    // Deliberately not trimmed: script text is preserved exactly as supplied.
    scriptText: z
      .string()
      .max(200_000)
      .nullable()
      .optional()
      .transform((v) => (v === undefined || v === null || v.trim() === '' ? null : v)),
    language: optionalText(60),
    gradeLevel: optionalText(60),
    sourceOrganisation: optionalText(200),
    sourceReference: optionalText(1000),
    provenance: z.enum(PROVENANCES, { message: 'Provenance must be demo, unverified or verified.' }).default('unverified'),
    curriculumOrder: z
      .union([z.number(), z.string()])
      .nullable()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined || v === null || v === '') return null;
        const n = Number(v);
        if (!Number.isInteger(n)) {
          ctx.addIssue({ code: 'custom', message: 'Curriculum order must be a whole number.' });
          return z.NEVER;
        }
        return n;
      }),
    prerequisites: stringList,
  })
  .superRefine((value, ctx) => {
    if (!value.videoUrl && !value.scriptText) {
      ctx.addIssue({ code: 'custom', path: ['videoUrl'], message: 'A resource needs a video URL or a script.' });
    }
    if (value.provenance === 'verified' && (!value.sourceOrganisation || !value.sourceReference)) {
      ctx.addIssue({
        code: 'custom',
        path: ['provenance'],
        message: 'A verified resource must state its source organisation and source reference.',
      });
    }
  });

export type ResourceInput = z.output<typeof resourceInputSchema>;
