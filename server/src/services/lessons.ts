import type { Lesson, LessonTopic, PrismaClient, Resource, ClassroomSession } from '@prisma/client';
import type { LessonDTO, LessonListItem, LessonStatus, MatchStatus, SessionStatus, SessionSummary, SyncMode } from '@classroom/shared';
import { z } from 'zod';
import { ApiError, conflict, notFound } from '../lib/errors';
import { matchTopic, normalizeTitle, NO_MATCH_MESSAGE, type MatchResult } from './matching';
import { toResourceDTO } from './resources';
import { suggestSequence } from './sequence';

export const DEFAULT_TOPIC_DURATION_SECONDS = 60;

const topicText = z.string().trim().min(1, 'Topic cannot be empty.').max(200);
const duration = z.number().int().min(1, 'Duration must be at least 1 second.').max(86_400);

export const createLessonSchema = z.object({
  title: z.string().trim().max(200).optional(),
  topics: z.array(z.string().max(200)).min(1, 'Enter at least one topic.').max(100),
});

export const patchLessonSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  topics: z
    .array(
      z.object({
        id: z.string().optional(),
        requestedTopic: topicText.optional(),
        displayTitle: topicText.optional(),
        resourceId: z.string().nullable().optional(),
        estimatedDurationSeconds: duration.optional(),
      }),
    )
    .max(100)
    .optional(),
});

type LessonWithRelations = Lesson & {
  topics: (LessonTopic & { resource: Resource | null })[];
  sessions: ClassroomSession[];
};

const lessonInclude = {
  topics: { orderBy: { position: 'asc' }, include: { resource: true } },
  sessions: { orderBy: { createdAt: 'desc' } },
} as const;

export function toSessionSummary(s: ClassroomSession): SessionSummary {
  return {
    id: s.id,
    sessionCode: s.sessionCode,
    status: s.status as SessionStatus,
    syncMode: s.syncMode as SyncMode,
    createdAt: s.createdAt.toISOString(),
    startedAt: s.startedAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
  };
}

function toLessonDTO(lesson: LessonWithRelations, notices?: string[]): LessonDTO {
  return {
    id: lesson.id,
    title: lesson.title,
    status: lesson.status as LessonStatus,
    confirmedAt: lesson.confirmedAt?.toISOString() ?? null,
    createdAt: lesson.createdAt.toISOString(),
    updatedAt: lesson.updatedAt.toISOString(),
    topics: lesson.topics.map((t) => ({
      id: t.id,
      requestedTopic: t.requestedTopic,
      displayTitle: t.displayTitle,
      position: t.position,
      enteredPosition: t.enteredPosition,
      estimatedDurationSeconds: t.estimatedDurationSeconds,
      matchStatus: t.matchStatus as MatchStatus,
      matchConfidence: t.matchConfidence,
      matchExplanation: t.matchExplanation,
      sequenceNote: t.sequenceNote,
      resource: t.resource ? toResourceDTO(t.resource) : null,
    })),
    sessions: lesson.sessions.map(toSessionSummary),
    ...(notices?.length ? { notices } : {}),
  };
}

function matchFields(match: MatchResult<ReturnType<typeof toResourceDTO>>) {
  let explanation = match.explanation;
  if (match.equallyGood.length) {
    explanation += ` ${match.equallyGood.length} other equally good ${match.equallyGood.length === 1 ? 'resource is' : 'resources are'} available under Replace.`;
  }
  return {
    resourceId: match.resource?.id ?? null,
    matchStatus: match.status,
    matchConfidence: match.confidence,
    matchExplanation: explanation,
  };
}

export class LessonService {
  constructor(private readonly db: PrismaClient) {}

  private async load(id: string): Promise<LessonWithRelations> {
    const lesson = await this.db.lesson.findUnique({ where: { id }, include: lessonInclude });
    if (!lesson) throw notFound('Lesson');
    return lesson;
  }

  private async assertNoOpenSession(id: string): Promise<void> {
    const open = await this.db.classroomSession.findFirst({ where: { lessonId: id, status: { not: 'ended' } } });
    if (open) {
      throw conflict('session_open', `This lesson has an open classroom session (${open.sessionCode}). End it before changing the lesson.`);
    }
  }

  private async libraryDTOs() {
    return (await this.db.resource.findMany()).map(toResourceDTO);
  }

  async list(): Promise<LessonListItem[]> {
    const lessons = await this.db.lesson.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { topics: { select: { resourceId: true } }, sessions: { orderBy: { createdAt: 'desc' } } },
    });
    return lessons.map((l) => ({
      id: l.id,
      title: l.title,
      status: l.status as LessonStatus,
      topicCount: l.topics.length,
      unresolvedCount: l.topics.filter((t) => t.resourceId === null).length,
      updatedAt: l.updatedAt.toISOString(),
      sessions: l.sessions.map(toSessionSummary),
    }));
  }

  async get(id: string): Promise<LessonDTO> {
    return toLessonDTO(await this.load(id));
  }

  /** Matches each requested topic against the library and stores a draft with the suggested order. */
  async create(input: z.output<typeof createLessonSchema>): Promise<LessonDTO> {
    const notices: string[] = [];
    const seen = new Set<string>();
    const requested: string[] = [];
    for (const raw of input.topics) {
      const topic = raw.trim();
      if (!topic) continue;
      const key = normalizeTitle(topic) || topic;
      if (seen.has(key)) {
        notices.push(`"${topic}" was entered more than once, so only the first was kept.`);
        continue;
      }
      seen.add(key);
      requested.push(topic);
    }
    if (!requested.length) throw new ApiError(400, 'invalid_request', 'Enter at least one topic.');

    const library = await this.libraryDTOs();
    const matched = requested.map((topic, enteredPosition) => {
      const match = matchTopic(topic, library);
      return { enteredPosition, displayTitle: topic, requestedTopic: topic, resource: match.resource, match };
    });
    const sequenced = suggestSequence(matched);
    notices.push(...sequenced.notices);

    const resourceUse = new Map<string, string>();
    for (const { item } of sequenced.items) {
      if (!item.resource) continue;
      const first = resourceUse.get(item.resource.id);
      if (first) notices.push(`"${item.displayTitle}" and "${first}" both use the resource "${item.resource.title}".`);
      else resourceUse.set(item.resource.id, item.displayTitle);
    }

    const title = input.title || requested.slice(0, 3).join(', ') + (requested.length > 3 ? ` and ${requested.length - 3} more` : '');
    const lesson = await this.db.lesson.create({
      data: {
        title,
        topics: {
          create: sequenced.items.map(({ item, note }, position) => ({
            requestedTopic: item.requestedTopic,
            displayTitle: item.displayTitle,
            position,
            enteredPosition: item.enteredPosition,
            estimatedDurationSeconds: DEFAULT_TOPIC_DURATION_SECONDS,
            sequenceNote: note,
            ...matchFields(item.match),
          })),
        },
      },
      include: lessonInclude,
    });
    return toLessonDTO(lesson, notices);
  }

  /** The array order is the new sequence. Any change returns the lesson to draft for re-confirmation. */
  async patch(id: string, input: z.output<typeof patchLessonSchema>): Promise<LessonDTO> {
    const lesson = await this.load(id);
    if (input.topics) await this.assertNoOpenSession(id);

    const data: { title?: string; status?: string; confirmedAt?: null } = {};
    if (input.title) data.title = input.title;

    if (!input.topics) {
      await this.db.lesson.update({ where: { id }, data });
      return this.get(id);
    }

    const existing = new Map(lesson.topics.map((t) => [t.id, t]));
    const library = await this.libraryDTOs();
    const libraryIds = new Set(library.map((r) => r.id));
    let nextEntered = Math.max(-1, ...lesson.topics.map((t) => t.enteredPosition)) + 1;

    const rows = input.topics.map((topic, position) => {
      const previous = topic.id ? existing.get(topic.id) : undefined;
      if (topic.id && !previous) throw new ApiError(400, 'invalid_request', 'A topic does not belong to this lesson.');
      if (topic.resourceId && !libraryIds.has(topic.resourceId)) {
        throw new ApiError(422, 'unknown_resource', 'That resource does not exist in the library.');
      }
      const requestedTopic = topic.requestedTopic ?? previous?.requestedTopic ?? topic.displayTitle;
      if (!requestedTopic) throw new ApiError(400, 'invalid_request', 'A new topic needs a name.');

      let matching: ReturnType<typeof matchFields>;
      if (!previous && topic.resourceId === undefined) {
        matching = matchFields(matchTopic(requestedTopic, library));
      } else if (topic.resourceId === undefined || topic.resourceId === previous?.resourceId) {
        matching = {
          resourceId: previous!.resourceId,
          matchStatus: previous!.matchStatus as MatchStatus,
          matchConfidence: previous!.matchConfidence,
          matchExplanation: previous!.matchExplanation ?? '',
        };
      } else if (topic.resourceId === null) {
        matching = { resourceId: null, matchStatus: 'unresolved', matchConfidence: null, matchExplanation: 'Left without a resource by the teacher.' };
      } else {
        matching = { resourceId: topic.resourceId, matchStatus: 'manual', matchConfidence: null, matchExplanation: 'Chosen by the teacher.' };
      }

      return {
        requestedTopic,
        displayTitle: topic.displayTitle ?? previous?.displayTitle ?? requestedTopic,
        position,
        enteredPosition: previous?.enteredPosition ?? nextEntered++,
        estimatedDurationSeconds: topic.estimatedDurationSeconds ?? previous?.estimatedDurationSeconds ?? DEFAULT_TOPIC_DURATION_SECONDS,
        sequenceNote: previous && previous.position === position ? previous.sequenceNote : null,
        ...matching,
      };
    });

    await this.db.$transaction([
      this.db.lessonTopic.deleteMany({ where: { lessonId: id } }),
      this.db.lesson.update({
        where: { id },
        data: { ...data, status: 'draft', confirmedAt: null, topics: { create: rows } },
      }),
    ]);
    return this.get(id);
  }

  /** Re-runs matching (for example after importing resources). Teacher choices and order are kept. */
  async rematch(id: string): Promise<LessonDTO> {
    const lesson = await this.load(id);
    await this.assertNoOpenSession(id);
    const library = await this.libraryDTOs();
    const updates = lesson.topics
      .filter((t) => t.matchStatus !== 'manual')
      .map((t) =>
        this.db.lessonTopic.update({ where: { id: t.id }, data: matchFields(matchTopic(t.requestedTopic, library)) }),
      );
    await this.db.$transaction([
      ...updates,
      this.db.lesson.update({ where: { id }, data: { status: 'draft', confirmedAt: null } }),
    ]);
    return this.get(id);
  }

  async confirm(id: string): Promise<LessonDTO> {
    const lesson = await this.load(id);
    if (!lesson.topics.length) throw new ApiError(422, 'empty_lesson', 'Add at least one topic before confirming.');
    await this.db.lesson.update({ where: { id }, data: { status: 'confirmed', confirmedAt: new Date() } });
    return this.get(id);
  }

  /** Reuse: a new draft with the same topics and resources. Session history stays with the original. */
  async duplicate(id: string): Promise<LessonDTO> {
    const lesson = await this.load(id);
    const copy = await this.db.lesson.create({
      data: {
        title: `${lesson.title} (copy)`,
        topics: {
          create: lesson.topics.map((t) => ({
            resourceId: t.resourceId,
            requestedTopic: t.requestedTopic,
            displayTitle: t.displayTitle,
            position: t.position,
            enteredPosition: t.enteredPosition,
            estimatedDurationSeconds: t.estimatedDurationSeconds,
            matchStatus: t.matchStatus,
            matchConfidence: t.matchConfidence,
            matchExplanation: t.matchExplanation,
            sequenceNote: t.sequenceNote,
          })),
        },
      },
      include: lessonInclude,
    });
    return toLessonDTO(copy);
  }

  async remove(id: string): Promise<void> {
    await this.load(id);
    await this.assertNoOpenSession(id);
    await this.db.lesson.delete({ where: { id } });
  }
}

export { NO_MATCH_MESSAGE };
