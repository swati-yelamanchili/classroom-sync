import type {
  ApiErrorBody,
  ChangeTopicRequest,
  ChangeTopicResponse,
  ImportReport,
  LessonDTO,
  LessonListItem,
  ResourceDTO,
  ResourceStats,
  SessionEventDTO,
  SessionSummary,
  StudentSnapshot,
  SyncMode,
  TeacherSnapshot,
} from '@classroom/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiRequestError(0, 'network_error', 'Could not reach the server. Check the connection and try again.');
  }
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as ({ data: T } & Partial<ApiErrorBody>) | null;
  if (!response.ok || !payload) {
    const error = payload?.error;
    if (response.status === 401 && !path.startsWith('/auth/') && !window.location.pathname.startsWith('/teacher/login')) {
      window.location.assign(`/teacher/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ApiRequestError(response.status, error?.code ?? 'error', error?.message ?? 'The server could not be reached or gave an unexpected response. Check that it is running.', error?.details);
  }
  return payload.data;
}

export type ResourceDraft = {
  title: string;
  subject?: string | null;
  topic?: string | null;
  description?: string | null;
  keywords?: string[] | string;
  aliases?: string[] | string;
  videoUrl?: string | null;
  scriptText?: string | null;
  language?: string | null;
  gradeLevel?: string | null;
  sourceOrganisation?: string | null;
  sourceReference?: string | null;
  provenance?: ResourceDTO['provenance'];
  curriculumOrder?: number | string | null;
  prerequisites?: string[] | string;
};

export type LessonTopicPatch = {
  id?: string;
  requestedTopic?: string;
  displayTitle?: string;
  resourceId?: string | null;
  estimatedDurationSeconds?: number;
};

export const api = {
  me: () => request<{ authenticated: boolean }>('/auth/me'),
  login: (passcode: string) => request<{ authenticated: boolean }>('/auth/login', { method: 'POST', body: { passcode } }),
  logout: () => request<{ authenticated: boolean }>('/auth/logout', { method: 'POST' }),

  network: () => request<{ publicBaseUrl: string | null; lanAddresses: string[] }>('/network'),

  resources: (q?: string) => request<ResourceDTO[]>(`/resources${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  resourceStats: () => request<ResourceStats>('/resources/stats'),
  createResource: (draft: ResourceDraft) => request<ResourceDTO>('/resources', { method: 'POST', body: draft }),
  updateResource: (id: string, draft: ResourceDraft) => request<ResourceDTO>(`/resources/${id}`, { method: 'PATCH', body: draft }),
  deleteResource: (id: string) => request<void>(`/resources/${id}`, { method: 'DELETE' }),
  importResources: (format: 'csv' | 'json', content: string, dryRun: boolean) =>
    request<ImportReport>('/resources/import', { method: 'POST', body: { format, content, dryRun } }),

  lessons: () => request<LessonListItem[]>('/lessons'),
  lesson: (id: string) => request<LessonDTO>(`/lessons/${id}`),
  createLesson: (topics: string[], title?: string) => request<LessonDTO>('/lessons', { method: 'POST', body: { topics, title } }),
  patchLesson: (id: string, patch: { title?: string; topics?: LessonTopicPatch[] }) =>
    request<LessonDTO>(`/lessons/${id}`, { method: 'PATCH', body: patch }),
  rematchLesson: (id: string) => request<LessonDTO>(`/lessons/${id}/match-resources`, { method: 'POST' }),
  confirmLesson: (id: string) => request<LessonDTO>(`/lessons/${id}/confirm`, { method: 'POST' }),
  duplicateLesson: (id: string) => request<LessonDTO>(`/lessons/${id}/duplicate`, { method: 'POST' }),
  deleteLesson: (id: string) => request<void>(`/lessons/${id}`, { method: 'DELETE' }),

  openSessions: () => request<(SessionSummary & { lessonId: string; lessonTitle: string })[]>('/sessions?open=true'),
  createSession: (lessonId: string, syncMode: SyncMode) => request<TeacherSnapshot>('/sessions', { method: 'POST', body: { lessonId, syncMode } }),
  session: (id: string) => request<TeacherSnapshot>(`/sessions/${id}`),
  sessionEvents: (id: string) => request<SessionEventDTO[]>(`/sessions/${id}/events`),
  startSession: (id: string) => request<TeacherSnapshot>(`/sessions/${id}/start`, { method: 'POST', body: {} }),
  pauseSession: (id: string, source: 'manual' | 'voice' = 'manual') => request<TeacherSnapshot>(`/sessions/${id}/pause`, { method: 'POST', body: { source } }),
  resumeSession: (id: string, source: 'manual' | 'voice' = 'manual') => request<TeacherSnapshot>(`/sessions/${id}/resume`, { method: 'POST', body: { source } }),
  endSession: (id: string) => request<TeacherSnapshot>(`/sessions/${id}/end`, { method: 'POST', body: {} }),
  changeTopic: (id: string, change: ChangeTopicRequest) => request<ChangeTopicResponse>(`/sessions/${id}/topic`, { method: 'POST', body: change }),
  setSessionMode: (id: string, syncMode: SyncMode) => request<TeacherSnapshot>(`/sessions/${id}/mode`, { method: 'POST', body: { syncMode } }),

  studentSession: (code: string) => request<StudentSnapshot>(`/student/session/${encodeURIComponent(code)}`),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
