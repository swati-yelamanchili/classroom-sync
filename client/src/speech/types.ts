export type SpeechErrorCode =
  | 'not-allowed'
  | 'service-not-allowed'
  | 'no-speech'
  | 'aborted'
  | 'audio-capture'
  | 'network'
  | 'language-not-supported'
  | 'unknown';

export interface SpeechHandlers {
  onStart(): void;
  /** One finalised utterance: the engine's alternative transcripts, most likely first. */
  onFinalResult(alternatives: string[]): void;
  onError(code: SpeechErrorCode): void;
  onEnd(): void;
}

/** Swap this to use another recognition provider; nothing above it knows about the browser API. */
export interface SpeechRecognitionAdapter {
  readonly supported: boolean;
  start(handlers: SpeechHandlers): void;
  stop(): void;
}
