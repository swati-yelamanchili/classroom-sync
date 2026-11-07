import type { SpeechErrorCode, SpeechHandlers, SpeechRecognitionAdapter } from './types';

interface BrowserRecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

interface BrowserRecognition {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: BrowserRecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => BrowserRecognition;

function findConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const KNOWN_ERRORS: readonly SpeechErrorCode[] = ['not-allowed', 'service-not-allowed', 'no-speech', 'aborted', 'audio-capture', 'network', 'language-not-supported'];

export class BrowserSpeechAdapter implements SpeechRecognitionAdapter {
  private recognition: BrowserRecognition | null = null;

  constructor(private readonly language: string) {}

  get supported(): boolean {
    return findConstructor() !== null;
  }

  start(handlers: SpeechHandlers): void {
    const Constructor = findConstructor();
    if (!Constructor) {
      handlers.onError('unknown');
      return;
    }
    const recognition = new Constructor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;
    recognition.lang = this.language;

    // Each index is handled once, even if the engine re-delivers earlier results.
    let nextIndex = 0;
    recognition.onstart = () => handlers.onStart();
    recognition.onresult = (event) => {
      for (let i = Math.max(event.resultIndex, nextIndex); i < event.results.length; i += 1) {
        const result = event.results[i]!;
        if (!result.isFinal) continue;
        nextIndex = i + 1;
        const alternatives: string[] = [];
        for (let a = 0; a < result.length; a += 1) alternatives.push(result[a]!.transcript);
        handlers.onFinalResult(alternatives);
      }
    };
    recognition.onerror = (event) => {
      const code = event.error as SpeechErrorCode;
      handlers.onError(KNOWN_ERRORS.includes(code) ? code : 'unknown');
    };
    recognition.onend = () => {
      if (this.recognition === recognition) this.recognition = null;
      handlers.onEnd();
    };
    this.recognition = recognition;
    recognition.start();
  }

  stop(): void {
    const recognition = this.recognition;
    this.recognition = null;
    recognition?.abort();
  }
}
