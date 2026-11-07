/**
 * Stage 3 extension point (see FUTURE_SCOPE.md). No model is implemented. A provider may only ever
 * nominate a topic already in the confirmed lesson, and suggestions are never auto-applied.
 */
export interface TopicCandidate {
  topicIndex: number;
  confidence: number;
  reason: string;
}

export interface TopicRecognitionInput {
  transcript: string;
  topics: readonly { index: number; displayTitle: string }[];
  currentTopicIndex: number;
}

export interface TopicRecognitionProvider {
  readonly id: string;
  readonly enabled: boolean;
  suggest(input: TopicRecognitionInput): Promise<TopicCandidate | null>;
}

export class DisabledTopicRecognitionProvider implements TopicRecognitionProvider {
  readonly id = 'disabled';
  readonly enabled = false;
  async suggest(): Promise<null> {
    return null;
  }
}
