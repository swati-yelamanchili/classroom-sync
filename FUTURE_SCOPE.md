# Future scope: model-based topic recognition (Stage 3)

**Nothing here is implemented, and no AI model exists in this codebase.** Today the extension point is an interface, a disabled provider and a feature flag that refuses any other value.

## The idea

Rather than an explicit "Start Topic 3", a model could notice from the teacher's ongoing speech that the lesson has moved to another topic in the sequence.

## Extension point

`shared/src/topicRecognition.ts`:

```ts
interface TopicRecognitionProvider {
  readonly id: string;
  readonly enabled: boolean;
  suggest(input: { transcript; topics; currentTopicIndex }): Promise<{ topicIndex; confidence; reason } | null>;
}
```

`server/src/services/topicRecognition.ts` selects a provider from `TOPIC_RECOGNITION_PROVIDER`. Add a real one there.

## Non-negotiable rules

1. **Closed set.** A model may only nominate a topic in the confirmed lesson. Validate the returned index and discard anything else. It never generates or rewrites content.
2. **No automatic advance on uncertainty.** Start with suggest-only: show "Move to Topic 3?" and require a tap or spoken confirmation. Only consider auto-advance after measurement in real classrooms, and keep a clear off switch.
3. **Same pipeline.** Accepted suggestions become ordinary `POST /topic` calls, with a new `source` value recorded in history. The server stays authoritative.
4. **Explicit commands always win.** Add a cool-down so a suggestion cannot immediately undo what the teacher just did.
5. **Privacy first.** Continuous transcripts are far more sensitive than commands. Prefer a local model; require explicit consent and documented data handling for any remote one. Do not log transcripts by default.

## Likely path

1. Add a transcript stream with an opt-in setting. The current service keeps only commands.
2. Baseline with embeddings over each topic's title, aliases and script, using a small local model and no paid API.
3. Build a labelled evaluation set from consented classroom recordings, and tune for few false positives: a wrong switch disrupts a student far more than a late one.
4. Add smoothing: require sustained evidence over several utterances before suggesting.
5. Pilot in suggest-only mode, comparing with explicit commands.

## Other ideas

Individual teacher accounts; PostgreSQL and horizontal scaling (Socket.IO Redis adapter, moving timers to a shared scheduler); offline-capable local speech recognition; on-device caching of videos for poor connections; curriculum metadata import from Ashray Akruti; drag-and-drop reordering.
