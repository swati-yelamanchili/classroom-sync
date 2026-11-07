import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_VOICE_GRAMMAR, type TeacherSnapshot } from '@classroom/shared';
import { api } from '@/lib/api';
import { readPreference, writePreference } from '@/lib/utils';
import { BrowserSpeechAdapter } from './browserAdapter';
import { SpeechRecognitionService, type CommandRequest, type VoiceStatus } from './SpeechRecognitionService';

const WAKE_PREF = 'classroom-sync.require-wake-phrase';
const LANGUAGE_PREF = 'classroom-sync.voice-language';

export const VOICE_LANGUAGES = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
] as const;

function newCommandId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Connects the speech service to a live session: every command goes to the backend for validation. */
export function useVoiceControl(snapshot: TeacherSnapshot | null, onSnapshot: (s: TeacherSnapshot) => void) {
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [requireWake, setRequireWakeState] = useState(() => readPreference(WAKE_PREF) === 'true');
  const [language, setLanguageState] = useState(() => readPreference(LANGUAGE_PREF) ?? 'en-IN');
  const [status, setStatus] = useState<VoiceStatus>({ state: 'off', message: null, lastCommand: null, heardNonCommand: false });

  const dispatch = useCallback(
    async (request: CommandRequest): Promise<string> => {
      const id = snapshotRef.current?.id;
      if (!id) throw new Error('The session is not loaded yet.');
      if (request.kind === 'pause') {
        onSnapshot(await api.pauseSession(id, 'voice'));
        return 'Session paused';
      }
      if (request.kind === 'resume') {
        onSnapshot(await api.resumeSession(id, 'voice'));
        return 'Session resumed';
      }
      const { session, changed } = await api.changeTopic(id, { ...request.change, commandId: newCommandId() });
      onSnapshot(session);
      const topic = session.currentTopic;
      const label = topic ? `Topic ${topic.number}: ${topic.displayTitle}` : 'the topic';
      return changed ? `Switched to ${label}` : `Already on ${label}`;
    },
    [onSnapshot],
  );

  const grammar = useMemo(() => ({ ...DEFAULT_VOICE_GRAMMAR, requireWakePhrase: requireWake }), [requireWake]);

  const service = useMemo(
    () =>
      new SpeechRecognitionService({
        adapter: new BrowserSpeechAdapter(language),
        grammar,
        getContext: () => ({
          status: snapshotRef.current?.status ?? 'created',
          currentTopicIndex: snapshotRef.current?.currentTopicIndex ?? 0,
          totalTopics: snapshotRef.current?.totalTopics ?? 0,
        }),
        dispatch,
        onStatus: setStatus,
      }),
    // A new engine is needed only when the language changes; grammar is updated in place below.
    [language, dispatch],
  );

  useEffect(() => {
    setStatus(service.currentStatus);
    return () => service.destroy();
  }, [service]);

  useEffect(() => service.setGrammar(grammar), [service, grammar]);

  // Automatic advancement modes are mutually exclusive: the microphone stops outside Voice mode.
  const voiceAllowed = snapshot?.syncMode === 'voice' && snapshot.status !== 'ended';
  useEffect(() => {
    if (!voiceAllowed) service.disable();
  }, [voiceAllowed, service]);

  return {
    status,
    supported: service.supported,
    voiceAllowed,
    enable: () => service.enable(),
    disable: () => service.disable(),
    requireWake,
    setRequireWake: (value: boolean) => {
      writePreference(WAKE_PREF, String(value));
      setRequireWakeState(value);
    },
    language,
    setLanguage: (value: string) => {
      writePreference(LANGUAGE_PREF, value);
      setLanguageState(value);
    },
  };
}
