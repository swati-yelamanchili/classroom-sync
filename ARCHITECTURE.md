# Architecture

## Principles

1. **The backend is authoritative.** No client state or browser storage decides the current topic. `localStorage` holds only per-device preferences: script text size, wake phrase, speech language.
2. **Commands go up over REST; state comes down over Socket.IO.** Students have no write path at all.
3. **Snapshots, not deltas.** Every broadcast is complete, so one missed event cannot leave a client inconsistent.
4. **Nothing is invented.** Matching returns only rows from the database. Sequencing uses only stated metadata.

## Components

| Path | Responsibility |
| --- | --- |
| `shared/src/events.ts` | Typed socket contract |
| `shared/src/stateMachine.ts` | Permitted session transitions |
| `shared/src/revision.ts` | `newerSnapshot`, the client convergence rule |
| `shared/src/timing.ts` | Pure elapsed-time and timer-advance calculations |
| `shared/src/voice.ts` | Grammar, number parsing, validation, cooldown |
| `shared/src/video.ts` | URL safety and embed classification |
| `server/src/services/matching.ts` | Topic to resource matching |
| `server/src/services/sequence.ts` | Suggested order |
| `server/src/services/resources.ts`, `resourceSchema.ts` | Library, validation, CSV and JSON import |
| `server/src/services/lessons.ts` | Drafts, editing, confirmation, reuse |
| `server/src/services/sessions.ts` | **Core:** lifecycle, topic changes, timer, snapshots |
| `server/src/realtime/hub.ts` | Rooms, join and watch, presence, broadcasting |
| `client/src/hooks/useSessionChannel.ts` | Socket subscription, revision guard, connection state |
| `client/src/speech/` | Speech adapter, service, React binding |

## Voice to student

```
Speech → SpeechRecognitionAdapter (final results only; each index once)
       → SpeechRecognitionService
           parseVoiceCommand   strict grammar, tries each alternative transcript
           CommandCooldown     drops repeats within 2.5 s
           validateCommand     range and status, for an immediate on-screen answer
       → POST /api/sessions/:id/topic { action, index, source: "voice", commandId }
       → requireTeacher → Zod → SessionService.changeTopic (per-session queue)
           duplicate commandId?  return the current state, unchanged
           ended / not started / voice in timestamp mode / bad index?  reject
           transaction: update session (revision + 1) + insert SessionEvent
       → hub: students room gets a StudentSnapshot, teachers room a TeacherSnapshot
       → client: newerSnapshot, then render and announce through an aria-live region
```

## Session states

```
created ──start──► active ◄──resume/pause──► paused
   │                  │                         │
   └───────end────────┴───────────end───────────┘──► ended (terminal)
```

Topic changes are allowed in `active` and `paused`. Sessions cannot be restarted once ended.

## Socket events

All state events carry a full snapshot.

| Event | Direction | Notes |
| --- | --- | --- |
| `session:join` `{code}` | student → server | Acknowledged with the current `StudentSnapshot` |
| `session:watch` `{sessionId}` | teacher → server | Requires the auth cookie |
| `session:leave` | client → server | |
| `session:started`, `session:paused`, `session:resumed`, `session:ended` | server → room | Lifecycle |
| `topic:changed` | server → room | |
| `session:mode-changed` | server → room | |
| `session:presence` `{connectedStudents}` | server → teachers | From real room membership |

Students receive only the current topic. They get no session ID, sequence or device count, and no content before the start or after the end.

## Convergence

The room is joined **before** the state is read for the acknowledgement, so no change can fall between them. Any push that overtakes the acknowledgement has a higher revision and wins. The client keeps the higher revision regardless of arrival order. `synced` is only reported after an acknowledgement, so the interface cannot claim to be in sync when it is not.

## Timing

`elapsed = elapsedActiveSeconds + (now - activeSince)`, with `activeSince` set only while active. Each session has at most one server `setTimeout`, armed for the next boundary and re-armed after any change. When it fires, it recalculates under the per-session queue, so a stale timer can do nothing wrong. Clients only display time and never move topics. `recover()` re-arms running sessions on boot.

## Matching order

1. Exact title or topic (confidence 1.0)
2. Normalised title or topic: case, punctuation, diacritics (0.95)
3. Alias or keyword (0.85)
4. Fuse.js similarity over title, topic and aliases: threshold 0.3, query of at least 4 characters and at least 60% of the matched term's length. Flagged "Possible match: please check".

Otherwise there is no match, and no resource is attached. Subject is deliberately not a match field, as it would attach an arbitrary video to a heading like "Mathematics". Ties prefer verified, then unverified, then demo, then curriculum order, title and ID, so results are deterministic. The rest stay available under Replace.

## Sequencing

Stable topological sort. The baseline and tie-breaker is the teacher's order. Constraints come from explicit `prerequisites` present in the lesson, and `curriculumOrder` within one subject. Topics with no resource move to the end, with a stated reason. Contradictory metadata falls back to the teacher's order. Teachers can restore their order with one button.

## Security

- HMAC-signed, `httpOnly`, `SameSite=Strict` cookie; timing-safe passcode check; login rate limit.
- Every teacher route and socket watch is authorised server-side. Input is validated with Zod; Prisma parameterises queries.
- Scripts render as React text, never as HTML. Helmet CSP limits scripts to same origin and frames to the YouTube and Vimeo players. Video URLs allow only http(s) and local demo assets.
- No student data collected. No audio or transcripts stored or sent to the backend.

## Moving to PostgreSQL

Change `provider` in `schema.prisma`, set `DATABASE_URL`, delete the SQLite migrations and run `prisma migrate dev`. List metadata is stored as JSON strings, so no application changes are needed; `Json` columns would be a later refinement.
