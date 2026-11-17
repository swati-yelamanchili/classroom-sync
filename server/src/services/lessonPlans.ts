import { execFile } from 'node:child_process';
import type { LessonPlan, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  LESSON_PLAN_PARTS,
  youtubeVideoId,
  type LessonPlanDTO,
  type LessonPlanPart,
  type StudentLessonDTO,
  type StudentLessonListItem,
  type TranscriptDTO,
} from '@classroom/shared';
import type { AppConfig } from '../config';
import { conflict, notFound } from '../lib/errors';
import { toTopicView } from './sessions';

export type Transcript = TranscriptDTO;

export const transcriptText = (transcript: Transcript) => transcript.segments.map((segment) => segment.text).join(' ');

export interface PlanRequest {
  title: string;
  subject: string | null;
  transcript: Transcript;
}

export interface PlanWriter {
  model: string;
  write(request: PlanRequest): Promise<LessonPlanPart[]>;
}

export interface LessonPlanDeps {
  fetchTranscript(videoId: string, preferredLanguage: string | null): Promise<Transcript>;
  /** Null when no Gemini key is configured. */
  writer: PlanWriter | null;
}

/** A failure whose message is written for the teacher and stored on the plan. */
export class PlanError extends Error {}

const NO_KEY_MESSAGE = 'Lesson plans need a Gemini API key. Add GEMINI_API_KEY to the .env file and restart the server.';

const transcriptSchema = z.object({
  language: z.string(),
  generated: z.boolean(),
  segments: z.array(z.object({ start: z.number(), duration: z.number(), text: z.string() })).min(1),
});

/** Runs scripts/youtube_transcript.py, which uses the youtube-transcript-api Python package. */
export function pythonTranscripts(config: AppConfig['lessonPlans']): LessonPlanDeps['fetchTranscript'] {
  return (videoId, preferredLanguage) =>
    new Promise((resolve, reject) => {
      execFile(
        config.pythonBin,
        [config.transcriptScript, videoId, preferredLanguage ?? ''],
        { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
        (error, stdout, stderr) => {
          if (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              reject(new PlanError(`Python was not found ("${config.pythonBin}"). Install Python 3, run "pip install youtube-transcript-api", or set PYTHON_BIN.`));
            } else if (stderr.includes('ModuleNotFoundError')) {
              reject(new PlanError('The youtube-transcript-api Python package is not installed. Run "pip install youtube-transcript-api".'));
            } else {
              reject(new PlanError(`The video's transcript could not be fetched. ${stderr.trim() || error.message}`.slice(0, 400)));
            }
            return;
          }
          const parsed = transcriptSchema.safeParse(JSON.parse(stdout || 'null'));
          if (parsed.success) resolve(parsed.data);
          else reject(new PlanError('The transcript helper returned something unexpected.'));
        },
      );
    });
}

// About an hour of speech; longer transcripts are cut rather than refused.
const MAX_TRANSCRIPT_CHARS = 40_000;

export function buildPlanPrompt({ title, subject, transcript }: PlanRequest): string {
  return [
    'You are helping a teacher at Ashray Akruti, a school for deaf and hard-of-hearing children in India.',
    `Below is the ${transcript.generated ? 'automatically generated ' : ''}transcript (language code "${transcript.language}") of the sign language lesson video "${title}"${subject ? ` (${subject})` : ''}.`,
    transcript.generated ? 'Automatic transcripts contain recognition errors; work out the intended meaning where it is clear.' : '',
    '',
    `Write a lesson plan in English that follows the video, divided into exactly ${LESSON_PLAN_PARTS} parts in the order the video covers them.`,
    'For each part give a short title (without "Part N") and content: what to teach, the key words to sign and show in writing, and one quick question to check understanding.',
    'Write the content as short lines, each starting with "- ". Keep each part under 120 words.',
    'Use only what the transcript covers. Do not add facts that are not in it.',
    'If the transcript is too garbled or too short to tell what the lesson teaches, set "usable" to false, explain why in "reason", and return no parts.',
    '',
    'Transcript:',
    transcriptText(transcript).slice(0, MAX_TRANSCRIPT_CHARS),
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n');
}

const planResponseSchema = z.object({
  usable: z.boolean(),
  reason: z.string().optional(),
  parts: z.array(z.object({ title: z.string().trim().min(1).max(160), content: z.string().trim().min(1).max(6000) })).default([]),
});

/** Checks Gemini's JSON reply; returns exactly LESSON_PLAN_PARTS parts or throws a PlanError. */
export function readPlanResponse(text: string): LessonPlanPart[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PlanError('Gemini replied with something that is not a lesson plan. Try again.');
  }
  const parsed = planResponseSchema.safeParse(json);
  if (!parsed.success) throw new PlanError('Gemini replied with something that is not a lesson plan. Try again.');
  if (!parsed.data.usable) {
    const reason = parsed.data.reason?.trim();
    throw new PlanError(`The video's automatic transcript is too unclear to make a plan from${reason ? `: ${reason}` : '.'}`);
  }
  if (parsed.data.parts.length !== LESSON_PLAN_PARTS) {
    throw new PlanError(`Gemini returned ${parsed.data.parts.length} parts instead of ${LESSON_PLAN_PARTS}. Try again.`);
  }
  return parsed.data.parts;
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    usable: { type: 'BOOLEAN' },
    reason: { type: 'STRING' },
    parts: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, content: { type: 'STRING' } }, required: ['title', 'content'] },
    },
  },
  required: ['usable', 'parts'],
};

/** Gemini's REST API with structured JSON output. */
export function geminiWriter(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): PlanWriter {
  return {
    model,
    async write(request) {
      let response: Response;
      try {
        response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: buildPlanPrompt(request) }] }],
            generationConfig: { temperature: 0.3, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
          }),
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        throw new PlanError('Gemini could not be reached. Check the internet connection and try again.');
      }
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      } | null;
      if (!response.ok) {
        throw new PlanError(`Gemini returned an error (${response.status}): ${body?.error?.message ?? response.statusText}`.slice(0, 400));
      }
      const candidate = body?.candidates?.[0];
      const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (!text) throw new PlanError(`Gemini returned no plan${candidate?.finishReason ? ` (${candidate.finishReason})` : ''}. Try again.`);
      return readPlanResponse(text);
    },
  };
}

export function lessonPlanDeps(config: AppConfig['lessonPlans']): LessonPlanDeps {
  return {
    fetchTranscript: pythonTranscripts(config),
    writer: config.geminiApiKey ? geminiWriter(config.geminiApiKey, config.geminiModel) : null,
  };
}

export function toPlanDTO(row: LessonPlan): LessonPlanDTO {
  return {
    status: row.status as LessonPlanDTO['status'],
    parts: row.status === 'ready' ? (JSON.parse(row.parts) as LessonPlanPart[]) : [],
    transcriptLanguage: row.transcriptLanguage,
    error: row.error,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * One plan per video, made once and reused by every lesson. Generation runs in the background, one
 * at a time, so a lesson with many topics does not hit Gemini's rate limits.
 */
export class LessonPlanService {
  private queue: Promise<void> = Promise.resolve();
  private readonly inFlight = new Set<string>();
  /** One download per video at a time, however many students ask at once. */
  private readonly downloads = new Map<string, Promise<Transcript>>();

  constructor(
    private readonly db: PrismaClient,
    private readonly deps: LessonPlanDeps,
  ) {}

  /** The plan for a resource, starting it if needed. Null if the resource has no YouTube video. */
  async get(resourceId: string): Promise<LessonPlanDTO | null> {
    const resource = await this.db.resource.findUnique({ where: { id: resourceId }, include: { lessonPlan: true } });
    if (!resource) throw notFound('Resource');
    if (resource.lessonPlan) {
      // Still pending after a server restart: nothing is working on it, so start again.
      if (resource.lessonPlan.status === 'pending') this.enqueue(resourceId);
      // Failed only for want of a key, and a key has since been added.
      if (resource.lessonPlan.status === 'failed' && resource.lessonPlan.error === NO_KEY_MESSAGE && this.deps.writer) return this.regenerate(resourceId);
      return toPlanDTO(resource.lessonPlan);
    }
    if (!resource.videoUrl || !youtubeVideoId(resource.videoUrl)) return null;
    const created = await this.db.lessonPlan.upsert({ where: { resourceId }, create: { resourceId }, update: {} });
    this.enqueue(resourceId);
    return toPlanDTO(created);
  }

  /** Called whenever a lesson selects videos. Failures are stored on the plan, never thrown. */
  async ensure(resourceIds: (string | null | undefined)[]): Promise<void> {
    for (const id of new Set(resourceIds)) {
      if (id) await this.get(id).catch(() => undefined);
    }
  }

  async regenerate(resourceId: string): Promise<LessonPlanDTO> {
    const resource = await this.db.resource.findUnique({ where: { id: resourceId } });
    if (!resource) throw notFound('Resource');
    if (!resource.videoUrl || !youtubeVideoId(resource.videoUrl)) {
      throw conflict('no_youtube_video', 'Lesson plans can only be made for resources with a YouTube video.');
    }
    const fresh = { status: 'pending', parts: '[]', error: null, transcriptLanguage: null, model: null };
    const row = await this.db.lessonPlan.upsert({ where: { resourceId }, create: { resourceId }, update: fresh });
    this.enqueue(resourceId);
    return toPlanDTO(row);
  }

  /** The video's timestamped transcript, downloaded once and then kept with its plan. */
  async transcript(resourceId: string): Promise<Transcript> {
    const resource = await this.db.resource.findUnique({ where: { id: resourceId }, include: { lessonPlan: true } });
    if (!resource) throw notFound('Resource');
    if (resource.lessonPlan?.transcript) return JSON.parse(resource.lessonPlan.transcript) as Transcript;
    const videoId = resource.videoUrl ? youtubeVideoId(resource.videoUrl) : null;
    if (!videoId) throw conflict('no_youtube_video', 'This topic has no YouTube video, so there is no transcript.');
    try {
      return await this.download(resourceId, videoId, resource.language);
    } catch (error) {
      throw conflict('no_transcript', error instanceof PlanError ? error.message : "The video's transcript could not be fetched. Try again later.");
    }
  }

  private download(resourceId: string, videoId: string, language: string | null): Promise<Transcript> {
    const running = this.downloads.get(resourceId);
    if (running) return running;
    const download = (async () => {
      const transcript = await this.deps.fetchTranscript(videoId, language);
      const stored = { transcript: JSON.stringify(transcript), transcriptLanguage: transcript.language };
      await this.db.lessonPlan.upsert({ where: { resourceId }, create: { resourceId, ...stored }, update: stored });
      return transcript;
    })().finally(() => this.downloads.delete(resourceId));
    this.downloads.set(resourceId, download);
    return download;
  }

  /** Resolves when everything queued so far has finished. For tests and shutdown. */
  idle(): Promise<void> {
    return this.queue;
  }

  private enqueue(resourceId: string) {
    if (this.inFlight.has(resourceId)) return;
    this.inFlight.add(resourceId);
    this.queue = this.queue.then(() => this.generate(resourceId)).finally(() => this.inFlight.delete(resourceId));
  }

  private async generate(resourceId: string): Promise<void> {
    try {
      const resource = await this.db.resource.findUnique({ where: { id: resourceId }, include: { lessonPlan: true } });
      const videoId = resource?.videoUrl ? youtubeVideoId(resource.videoUrl) : null;
      if (!resource || !videoId) return;
      // The transcript comes first, so students can read it even when no plan can be written.
      const transcript = resource.lessonPlan?.transcript
        ? (JSON.parse(resource.lessonPlan.transcript) as Transcript)
        : await this.download(resourceId, videoId, resource.language);
      if (!this.deps.writer) throw new PlanError(NO_KEY_MESSAGE);
      const parts = await this.deps.writer.write({ title: resource.title, subject: resource.subject, transcript });
      await this.db.lessonPlan.updateMany({
        where: { resourceId },
        data: { status: 'ready', parts: JSON.stringify(parts), transcriptLanguage: transcript.language, model: this.deps.writer.model, error: null },
      });
    } catch (error) {
      if (!(error instanceof PlanError)) console.error('Lesson plan failed', error);
      const message = error instanceof PlanError ? error.message : 'Something went wrong while making the lesson plan. Try again.';
      await this.db.lessonPlan.updateMany({ where: { resourceId }, data: { status: 'failed', error: message } }).catch(() => undefined);
    }
  }

  // Student browsing: confirmed lessons only, as the teacher left them.

  async listStudentLessons(): Promise<StudentLessonListItem[]> {
    const lessons = await this.db.lesson.findMany({
      where: { status: 'confirmed' },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { topics: true } } },
    });
    return lessons.map((lesson) => ({ id: lesson.id, title: lesson.title, topicCount: lesson._count.topics }));
  }

  async getStudentTranscript(lessonId: string, topicNumber: number): Promise<Transcript> {
    const topic = await this.db.lessonTopic.findFirst({ where: { lessonId, position: topicNumber - 1, lesson: { status: 'confirmed' } } });
    if (!topic) throw notFound('Topic');
    if (!topic.resourceId) throw conflict('no_youtube_video', 'This topic has no video, so there is no transcript.');
    return this.transcript(topic.resourceId);
  }

  async getStudentLesson(id: string): Promise<StudentLessonDTO> {
    const lesson = await this.db.lesson.findFirst({
      where: { id, status: 'confirmed' },
      include: { topics: { orderBy: { position: 'asc' }, include: { resource: true } } },
    });
    if (!lesson) throw notFound('Lesson');
    const topics = await Promise.all(
      lesson.topics.map(async (topic, index) => ({
        number: index + 1,
        displayTitle: topic.displayTitle,
        resource: toTopicView(topic, index).resource,
        plan: topic.resourceId ? await this.get(topic.resourceId) : null,
      })),
    );
    return { id: lesson.id, title: lesson.title, topics };
  }
}
