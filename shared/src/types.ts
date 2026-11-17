export const SESSION_STATUSES = ['created', 'active', 'paused', 'ended'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SYNC_MODES = ['voice', 'timestamp'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];

export const PROVENANCES = ['demo', 'unverified', 'verified'] as const;
export type Provenance = (typeof PROVENANCES)[number];

export type MatchStatus = 'exact' | 'normalized' | 'alias' | 'fuzzy' | 'manual' | 'unresolved';

export type CommandSource = 'manual' | 'voice' | 'timer' | 'system';

export interface ResourceDTO {
  id: string;
  title: string;
  subject: string | null;
  topic: string | null;
  description: string | null;
  keywords: string[];
  aliases: string[];
  videoUrl: string | null;
  scriptText: string | null;
  language: string | null;
  gradeLevel: string | null;
  sourceOrganisation: string | null;
  sourceReference: string | null;
  provenance: Provenance;
  curriculumOrder: number | null;
  prerequisites: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ResourceStats {
  total: number;
  demo: number;
  unverified: number;
  verified: number;
}

export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
}

export interface ImportDuplicate {
  row: number;
  title: string;
  reason: string;
}

export interface ImportReport {
  dryRun: boolean;
  totalRows: number;
  created: number;
  valid: { row: number; title: string }[];
  duplicates: ImportDuplicate[];
  errors: ImportRowError[];
}

export interface LessonTopicDTO {
  id: string;
  requestedTopic: string;
  displayTitle: string;
  position: number;
  enteredPosition: number;
  estimatedDurationSeconds: number;
  matchStatus: MatchStatus;
  matchConfidence: number | null;
  matchExplanation: string | null;
  sequenceNote: string | null;
  resource: ResourceDTO | null;
}

export type LessonStatus = 'draft' | 'confirmed';

export interface SessionSummary {
  id: string;
  sessionCode: string;
  status: SessionStatus;
  syncMode: SyncMode;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface LessonDTO {
  id: string;
  title: string;
  status: LessonStatus;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  topics: LessonTopicDTO[];
  sessions: SessionSummary[];
  notices?: string[];
}

export interface LessonListItem {
  id: string;
  title: string;
  status: LessonStatus;
  topicCount: number;
  unresolvedCount: number;
  updatedAt: string;
  sessions: SessionSummary[];
}

export const LESSON_PLAN_PARTS = 5;
export type LessonPlanStatus = 'pending' | 'ready' | 'failed';

export interface LessonPlanPart {
  title: string;
  content: string;
}

/** An AI-written plan for one video. Resources without a YouTube video have no plan (null). */
export interface LessonPlanDTO {
  status: LessonPlanStatus;
  /** Exactly LESSON_PLAN_PARTS when ready, empty otherwise. */
  parts: LessonPlanPart[];
  transcriptLanguage: string | null;
  error: string | null;
  updatedAt: string;
}

/** One caption line; times are seconds from the start of the video. */
export interface TranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

/** A video's YouTube transcript, as downloaded: usually YouTube's automatic captions. */
export interface TranscriptDTO {
  language: string;
  generated: boolean;
  segments: TranscriptSegment[];
}

export interface StudentLessonListItem {
  id: string;
  title: string;
  topicCount: number;
}

export interface StudentLessonTopic {
  number: number;
  displayTitle: string;
  resource: ResourceView | null;
  plan: LessonPlanDTO | null;
}

/** A confirmed lesson as a student browsing on their own sees it: every topic with its video and plan. */
export interface StudentLessonDTO {
  id: string;
  title: string;
  topics: StudentLessonTopic[];
}

/** Only what a device in the classroom needs to display a resource. */
export interface ResourceView {
  title: string;
  videoUrl: string | null;
  scriptText: string | null;
  language: string | null;
  provenance: Provenance;
  sourceOrganisation: string | null;
  sourceReference: string | null;
}

export interface TopicView {
  index: number;
  number: number;
  displayTitle: string;
  estimatedDurationSeconds: number;
  resource: ResourceView | null;
}

interface SnapshotBase {
  sessionCode: string;
  lessonTitle: string;
  /** Monotonically increasing. Clients must ignore any snapshot not newer than the one they hold. */
  revision: number;
  status: SessionStatus;
  syncMode: SyncMode;
  currentTopicIndex: number;
  totalTopics: number;
  elapsedActiveSeconds: number;
  topicStartedElapsedSeconds: number;
  /** Server clock when the snapshot was taken; lets clients display time without owning it. */
  serverTime: number;
}

export interface StudentSnapshot extends SnapshotBase {
  /** Null until the teacher starts and again once the session has ended. */
  currentTopic: TopicView | null;
}

export interface TeacherSnapshot extends SnapshotBase {
  id: string;
  lessonId: string;
  currentTopic: TopicView | null;
  topics: TopicView[];
  connectedStudents: number;
  createdAt: string;
  startedAt: string | null;
  pausedAt: string | null;
  endedAt: string | null;
}

export type TopicAction = 'goto' | 'next' | 'previous';

export interface ChangeTopicRequest {
  action: TopicAction;
  /** Zero-based position in the confirmed sequence; required when action is "goto". */
  index?: number;
  source?: 'manual' | 'voice';
  /** Client-generated id. A repeated id is applied once. */
  commandId?: string;
}

export interface ChangeTopicResponse {
  session: TeacherSnapshot;
  changed: boolean;
}

export interface SessionEventDTO {
  id: string;
  type: string;
  source: CommandSource;
  fromIndex: number | null;
  toIndex: number | null;
  topicTitle: string | null;
  createdAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
