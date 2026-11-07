import { DisabledTopicRecognitionProvider, type TopicRecognitionProvider } from '@classroom/shared';

/**
 * Stage 3 feature flag. "disabled" is the only provider that exists; naming any other fails at start-up
 * rather than appearing to run a model that is not there. See FUTURE_SCOPE.md.
 */
export function createTopicRecognitionProvider(name: string): TopicRecognitionProvider {
  if (name === 'disabled') return new DisabledTopicRecognitionProvider();
  throw new Error(`Unknown TOPIC_RECOGNITION_PROVIDER "${name}". No model-based provider is implemented; use "disabled".`);
}
