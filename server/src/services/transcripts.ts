import { execFile } from 'node:child_process';
import type { PrismaClient, VideoTranscript } from '@prisma/client';
import { z } from 'zod';
import { youtubeVideoId, type StudentLessonDTO, type StudentLessonListItem, type TranscriptDTO } from '@classroom/shared';
import type { AppConfig } from '../config';
import { conflict, notFound } from '../lib/errors';
import { normalizeSessionCode, toTopicView } from './sessions';

const segmentsSchema = z.array(z.object({ start: z.number(), duration: z.number(), text: z.string() })).min(1);
const downloadSchema = z.object({ language: z.string(), generated: z.boolean(), segments: segmentsSchema });

export type DownloadedTranscript = z.infer<typeof downloadSchema>;
export type FetchTranscript = (videoId: string, preferredLanguage: string | null) => Promise<DownloadedTranscript>;

/** A failure whose message is written for a teacher or student and stored with the transcript. */
export class TranscriptError extends Error {}

/** Runs scripts/youtube_transcript.py, which uses the youtube-transcript-api Python package. */
export function pythonTranscripts(config: AppConfig['transcripts']): FetchTranscript {
  return (videoId, preferredLanguage) =>
    new Promise((resolve, reject) => {
      execFile(
        config.pythonBin,
        [config.transcriptScript, videoId, preferredLanguage ?? ''],
        { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
        (error, stdout, stderr) => {
          if (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              reject(new TranscriptError(`Python was not found ("${config.pythonBin}"). Install Python 3, run "pip install -r server/requirements.txt", or set PYTHON_BIN.`));
            } else if (stderr.includes('ModuleNotFoundError')) {
              reject(new TranscriptError('The youtube-transcript-api Python package is not installed. Run "pip install -r server/requirements.txt".'));
            } else {
              reject(new TranscriptError(`The video's transcript could not be fetched. ${stderr.trim() || error.message}`.slice(0, 400)));
            }
            return;
          }
          let json: unknown = null;
          try {
            json = JSON.parse(stdout);
          } catch {
            // Reported below as unexpected output.
          }
          const parsed = downloadSchema.safeParse(json);
          if (parsed.success) resolve(parsed.data);
          else reject(new TranscriptError('The transcript helper returned something unexpected.'));
        },
      );
    });
}

export function toTranscriptDTO(row: VideoTranscript): TranscriptDTO {
  return {
    status: row.status === 'ready' ? 'ready' : 'failed',
    language: row.language,
    generated: row.generated,
    segments: row.status === 'ready' ? (JSON.parse(row.segments) as TranscriptDTO['segments']) : [],
    error: row.error,
  };
}

// A failure may be temporary (network, YouTube), so it is tried again after this long.
const RETRY_FAILED_AFTER_MS = 10 * 60_000;

/**
 * Timestamped YouTube transcripts, one per resource, downloaded once and kept. Choosing a video in a
 * lesson downloads its transcript in the background, so it is usually ready before a student asks.
 */
export class TranscriptService {
  private queue: Promise<void> = Promise.resolve();
  private readonly downloads = new Map<string, Promise<TranscriptDTO>>();

  constructor(
    private readonly db: PrismaClient,
    private readonly fetchTranscript: FetchTranscript,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The transcript, downloading it first if needed. Throws 409 if the resource has no YouTube video. */
  async get(resourceId: string, { refresh = false } = {}): Promise<TranscriptDTO> {
    const resource = await this.db.resource.findUnique({ where: { id: resourceId }, include: { transcript: true } });
    if (!resource) throw notFound('Resource');
    const videoId = resource.videoUrl ? youtubeVideoId(resource.videoUrl) : null;
    if (!videoId) throw conflict('no_youtube_video', 'This resource has no YouTube video, so there is no transcript.');
    const stored = resource.transcript;
    const stale = stored?.status === 'failed' && this.now() - stored.updatedAt.getTime() > RETRY_FAILED_AFTER_MS;
    if (stored && !refresh && !stale) return toTranscriptDTO(stored);
    return this.download(resourceId, videoId, resource.language);
  }

  /** Called when a lesson selects videos: downloads missing transcripts one at a time, in the background. */
  async prefetch(resourceIds: (string | null | undefined)[]): Promise<void> {
    const ids = [...new Set(resourceIds.filter((id): id is string => !!id))];
    if (!ids.length) return;
    const missing = await this.db.resource.findMany({ where: { id: { in: ids }, transcript: null }, select: { id: true, videoUrl: true } });
    for (const { id, videoUrl } of missing) {
      if (!videoUrl || !youtubeVideoId(videoUrl)) continue;
      this.queue = this.queue.then(() => this.get(id).then(() => undefined, () => undefined));
    }
  }

  /** Resolves when background downloads queued so far have finished. For tests and shutdown. */
  idle(): Promise<void> {
    return this.queue;
  }

  private download(resourceId: string, videoId: string, language: string | null): Promise<TranscriptDTO> {
    const running = this.downloads.get(resourceId);
    if (running) return running;
    const task = (async () => {
      let data: { status: string; language: string | null; generated: boolean; segments: string; error: string | null };
      try {
        const transcript = await this.fetchTranscript(videoId, language);
        data = { status: 'ready', language: transcript.language, generated: transcript.generated, segments: JSON.stringify(transcript.segments), error: null };
      } catch (error) {
        if (!(error instanceof TranscriptError)) console.error('Transcript download failed', error);
        const message = error instanceof TranscriptError ? error.message : "The video's transcript could not be fetched. Try again later.";
        data = { status: 'failed', language: null, generated: true, segments: '[]', error: message };
      }
      const row = await this.db.videoTranscript.upsert({ where: { resourceId }, create: { resourceId, ...data }, update: data });
      return toTranscriptDTO(row);
    })().finally(() => this.downloads.delete(resourceId));
    this.downloads.set(resourceId, task);
    return task;
  }

  // Students: by lesson and topic number, or by live session code and topic number.

  async listStudentLessons(): Promise<StudentLessonListItem[]> {
    const lessons = await this.db.lesson.findMany({
      where: { status: 'confirmed' },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { topics: true } } },
    });
    return lessons.map((lesson) => ({ id: lesson.id, title: lesson.title, topicCount: lesson._count.topics }));
  }

  async getStudentLesson(id: string): Promise<StudentLessonDTO> {
    const lesson = await this.db.lesson.findFirst({
      where: { id, status: 'confirmed' },
      include: { topics: { orderBy: { position: 'asc' }, include: { resource: true } } },
    });
    if (!lesson) throw notFound('Lesson');
    void this.prefetch(lesson.topics.map((topic) => topic.resourceId));
    return {
      id: lesson.id,
      title: lesson.title,
      topics: lesson.topics.map((topic, index) => ({ number: index + 1, displayTitle: topic.displayTitle, resource: toTopicView(topic, index).resource })),
    };
  }

  async forLessonTopic(lessonId: string, topicNumber: number): Promise<TranscriptDTO> {
    const topic = await this.db.lessonTopic.findFirst({ where: { lessonId, position: topicNumber - 1, lesson: { status: 'confirmed' } } });
    if (!topic) throw notFound('Topic');
    if (!topic.resourceId) throw conflict('no_youtube_video', 'This topic has no video, so there is no transcript.');
    return this.get(topic.resourceId);
  }

  async forSessionTopic(code: string, topicNumber: number): Promise<TranscriptDTO> {
    const session = await this.db.classroomSession.findUnique({ where: { sessionCode: normalizeSessionCode(code) } });
    if (!session) throw notFound('Session');
    const topic = await this.db.lessonTopic.findFirst({ where: { lessonId: session.lessonId, position: topicNumber - 1 } });
    if (!topic) throw notFound('Topic');
    if (!topic.resourceId) throw conflict('no_youtube_video', 'This topic has no video, so there is no transcript.');
    return this.get(topic.resourceId);
  }
}
