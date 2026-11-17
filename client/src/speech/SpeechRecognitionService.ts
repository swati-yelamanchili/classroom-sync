import {
  CommandCooldown,
  DEFAULT_VOICE_GRAMMAR,
  describeCommand,
  parseVoiceCommands,
  validateCommand,
  type CommandContext,
  type CommandDecision,
  type VoiceCommand,
  type VoiceGrammar,
} from '@classroom/shared';
import type { SpeechErrorCode, SpeechRecognitionAdapter } from './types';

export type VoiceState =
  | 'off'
  | 'listening'
  | 'processing'
  | 'recognised'
  | 'rejected'
  | 'permission-denied'
  | 'unavailable'
  | 'error';

export interface LastCommand {
  heard: string;
  outcome: 'recognised' | 'rejected';
  action: string;
}

/** One line of the opt-in testing log. Kept in memory on the teacher's device only. */
export interface HeardEntry {
  at: number;
  heard: string;
  result: string;
  /** From the final transcript to the server's answer, for commands that were sent. */
  latencyMs?: number;
}

export interface VoiceStatus {
  state: VoiceState;
  message: string | null;
  lastCommand: LastCommand | null;
  /** True briefly after speech that was not a command. The words themselves are not retained. */
  heardNonCommand: boolean;
  /** Everything heard, while testing mode is on. Empty otherwise. */
  log: HeardEntry[];
}

const LOG_LIMIT = 50;

export type CommandRequest = Extract<CommandDecision, { ok: true }>['request'];

export interface SpeechServiceOptions {
  adapter: SpeechRecognitionAdapter;
  grammar?: VoiceGrammar;
  cooldownMs?: number;
  /** How long a recognised/rejected state stays up before returning to "listening". */
  resultHoldMs?: number;
  restartDelayMs?: number;
  maxConsecutiveFailures?: number;
  now?: () => number;
  getContext(): CommandContext;
  /** Sends the validated command to the backend; resolves with a description of what happened. */
  dispatch(request: CommandRequest): Promise<string>;
  onStatus(status: VoiceStatus): void;
}

export const UNSUPPORTED_MESSAGE = 'Speech recognition is not available in this browser. Use the manual controls.';

const MESSAGES: Partial<Record<SpeechErrorCode, string>> = {
  'audio-capture': 'No working microphone was found.',
  network: 'The speech service could not be reached. Check the internet connection. Some browsers, such as Brave, block this service; if so, use Google Chrome or Microsoft Edge.',
  'language-not-supported': 'This browser cannot recognise speech in the selected language.',
  unknown: 'Speech recognition stopped unexpectedly.',
};

export class SpeechRecognitionService {
  private status: VoiceStatus = { state: 'off', message: null, lastCommand: null, heardNonCommand: false, log: [] };
  private logging = false;
  private enabled = false;
  private fatal = false;
  private consecutiveFailures = 0;
  private startedAt = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly cooldown: CommandCooldown;
  private queue: Promise<void> = Promise.resolve();
  private grammar: VoiceGrammar;

  constructor(private readonly options: SpeechServiceOptions) {
    this.cooldown = new CommandCooldown(options.cooldownMs ?? 2500);
    this.grammar = options.grammar ?? DEFAULT_VOICE_GRAMMAR;
    if (!options.adapter.supported) {
      this.status = { ...this.status, state: 'unavailable', message: UNSUPPORTED_MESSAGE };
    }
  }

  get supported(): boolean {
    return this.options.adapter.supported;
  }

  get currentStatus(): VoiceStatus {
    return this.status;
  }

  setGrammar(grammar: VoiceGrammar): void {
    this.grammar = grammar;
  }

  /** Testing mode: records every transcript, command or not, so recognition accuracy can be measured. */
  setLogging(on: boolean): void {
    this.logging = on;
    if (!on && this.status.log.length) this.update({ log: [] });
  }

  private addLog(entry: Omit<HeardEntry, 'at'>): void {
    if (!this.logging) return;
    this.update({ log: [{ at: this.now(), ...entry }, ...this.status.log].slice(0, LOG_LIMIT) });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private update(partial: Partial<VoiceStatus>): void {
    this.status = { ...this.status, ...partial };
    this.options.onStatus(this.status);
  }

  /** Call from a user gesture: browsers tie the microphone permission prompt to one. */
  enable(): void {
    if (!this.supported || this.enabled) return;
    this.enabled = true;
    this.fatal = false;
    this.consecutiveFailures = 0;
    this.cooldown.reset();
    this.update({ state: 'listening', message: null });
    this.startEngine();
  }

  disable(): void {
    this.enabled = false;
    this.clearTimers();
    this.options.adapter.stop();
    if (this.supported) this.update({ state: 'off', message: null, heardNonCommand: false });
  }

  private clearTimers(): void {
    for (const timer of [this.restartTimer, this.holdTimer, this.hintTimer]) if (timer) clearTimeout(timer);
    this.restartTimer = this.holdTimer = this.hintTimer = null;
  }

  private startEngine(): void {
    try {
      this.options.adapter.start({
        onStart: () => {
          this.startedAt = this.now();
        },
        onFinalResult: (alternatives) => this.handleResult(alternatives),
        onError: (code) => this.handleError(code),
        onEnd: () => this.handleEnd(),
      });
    } catch {
      this.handleError('unknown');
      this.handleEnd();
    }
  }

  private handleError(code: SpeechErrorCode): void {
    if (!this.enabled) return;
    if (code === 'no-speech' || code === 'aborted') return;
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      this.fatal = true;
      this.update({ state: 'permission-denied', message: 'Microphone permission was denied. Allow it in the browser settings, or use the manual controls.' });
      return;
    }
    if (code === 'language-not-supported') this.fatal = true;
    this.consecutiveFailures += 1;
    this.update({ state: 'error', message: MESSAGES[code] ?? MESSAGES.unknown! });
  }

  /** Browsers end continuous recognition on their own (silence, time limits), so restart it. */
  private handleEnd(): void {
    if (!this.enabled) return;
    if (this.fatal) {
      this.enabled = false;
      return;
    }
    if (this.startedAt && this.now() - this.startedAt > 5000) this.consecutiveFailures = 0;
    const limit = this.options.maxConsecutiveFailures ?? 5;
    if (this.consecutiveFailures >= limit) {
      this.enabled = false;
      this.update({
        state: 'error',
        message: `${this.status.message ?? 'Speech recognition keeps stopping.'} Voice control has stopped. Use the manual controls, or enable the microphone again to retry.`,
      });
      return;
    }
    const base = this.options.restartDelayMs ?? 300;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.enabled) return;
      if (this.status.state === 'error') this.update({ state: 'listening', message: null });
      this.startEngine();
    }, base * 2 ** this.consecutiveFailures);
  }

  private handleResult(alternatives: string[]): void {
    if (!this.enabled) return;
    const heardAt = this.now();
    for (const transcript of alternatives) {
      const commands = parseVoiceCommands(transcript, this.grammar);
      if (commands.length) {
        for (const command of commands) this.handleCommand(command, transcript.trim(), heardAt);
        return;
      }
    }
    this.addLog({ heard: alternatives[0]?.trim() ?? '', result: 'Not a command: ignored' });
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.update({ heardNonCommand: true });
    this.hintTimer = setTimeout(() => this.update({ heardNonCommand: false }), this.options.resultHoldMs ?? 3000);
  }

  private handleCommand(command: VoiceCommand, heard: string, heardAt: number): void {
    if (!this.cooldown.allow(command, this.now())) {
      this.addLog({ heard, result: `${describeCommand(command)}: ignored as a repeat` });
      return;
    }
    this.queue = this.queue.then(() => this.process(command, heard, heardAt));
  }

  private async process(command: VoiceCommand, heard: string, heardAt: number): Promise<void> {
    if (!this.enabled) return;
    const decision = validateCommand(command, this.options.getContext());
    if (!decision.ok) {
      this.addLog({ heard, result: `Rejected: ${decision.reason}` });
      this.finish(heard, 'rejected', decision.reason);
      return;
    }
    this.clearHold();
    this.update({ state: 'processing', message: `${describeCommand(command)}…`, heardNonCommand: false });
    try {
      const action = await this.options.dispatch(decision.request);
      this.addLog({ heard, result: action, latencyMs: this.now() - heardAt });
      this.finish(heard, 'recognised', action);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'The server rejected the command.';
      this.addLog({ heard, result: `Rejected by server: ${reason}`, latencyMs: this.now() - heardAt });
      this.finish(heard, 'rejected', reason);
    }
  }

  private clearHold(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  private finish(heard: string, outcome: LastCommand['outcome'], action: string): void {
    this.clearHold();
    this.update({ state: outcome, message: null, lastCommand: { heard, outcome, action }, heardNonCommand: false });
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      if (this.enabled && (this.status.state === 'recognised' || this.status.state === 'rejected')) {
        this.update({ state: 'listening' });
      }
    }, this.options.resultHoldMs ?? 3000);
  }

  destroy(): void {
    this.enabled = false;
    this.clearTimers();
    this.options.adapter.stop();
  }
}
