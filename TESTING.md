# Testing

## Latest results

Run on 2026-11-14 on Windows 11 with Node 24 and Google Chrome.

| Suite | Command | Result |
| --- | --- | --- |
| Types (all packages and E2E) | `npm run typecheck` | No errors |
| Production build | `npm run build` | Succeeds |
| Shared logic | `npm run test -w shared` | 91 passed |
| Server, including real HTTP, sockets and SQLite | `npm run test -w server` | 128 passed (see note below) |
| Client components and speech services | `npm run test -w client` | 68 passed |
| End to end in Chrome | `npm run test:e2e` | 25 passed |
| Measurements: emulated Android devices, slow networks, reconnection | `npm run evaluate` | 8 passed, run before lesson plans and search were added; results in [EVALUATION.md](EVALUATION.md) |

**Note on the server suite on Windows:** about one run in three, a Vitest worker exits with a native error (`0xC0000409`) part-way through a file, so some tests are not counted. It happens on the code from before these changes too, every server test file passes when run on its own, and no assertion has failed. Re-run if you see `Worker exited unexpectedly`.

## What is real in the tests

- **Server tests** run a real server on a real port with a real temporary SQLite database, and real `socket.io-client` connections. Timer tests use real elapsed time, with durations of 1 to 2 seconds, so the suite takes about 25 seconds.
- **E2E tests** run the production build against a fresh database, with teacher and student in separate browser contexts. Nothing is stubbed except the browser's `SpeechRecognition` object in voice tests.

## Coverage

| Area | Where | Checks |
| --- | --- | --- |
| Matching | `server/test/matching.test.ts` | Exact, case-insensitive, alias, typo, no match, no fabrication, duplicates, deterministic ties |
| Sequencing | `matching.test.ts`, `lessons.test.ts` | Order preserved, reordering, replacement, numbering, persistence, prerequisites, curriculum order, contradictory metadata |
| Resources | `server/test/resources.test.ts` | Validation, unsafe URLs, exact script preservation, CSV and JSON, partial failure, duplicates, dry run, provenance rule |
| Access | `resources.test.ts`, `sessions.test.ts`, E2E | Anonymous 401s, forged cookie, cookie flags, socket watch auth, student read-only, rate limit |
| Sync | `server/test/sessions.test.ts`, `shared/src/sync.test.ts`, `e2e/sync.spec.ts` | Initial state, push updates, multiple students, isolation between sessions, reconnection, invalid indices, ended sessions, repeated commands, concurrent commands, out-of-order events |
| Timestamp | `sessions.test.ts`, `sync.test.ts`, E2E | Progression, per-topic durations, pause and resume, override, end stops progression, no timer in Voice mode, restart recovery |
| Voice grammar | `shared/src/voice.test.ts` | All specified phrases, number words, ordinary speech rejected, wake phrase, cooldown, joined commands, engine spellings |
| Speech service | `client/test/speech.test.ts` | Enable and disable, dispatch, rejection, restart, backoff, denied, unsupported, duplicate delivery, joined commands, testing log |
| Student UI | `client/test/components.test.tsx`, E2E | Layout, script fidelity, XSS, autoplay, embed rules, states, announcements, no teacher controls |
| Accessibility | `e2e/lessons-and-resources.spec.ts` | axe WCAG 2.1 A/AA on 13 page states, keyboard reach, 375 px phone with no sideways scroll |
| Required demo | `e2e/demo-flow.spec.ts` | All 14 steps, asserting the student page never reloads |
| Lesson plans | `server/test/lessonPlans.test.ts`, `e2e/lesson-plans.spec.ts` | Gemini reply validation (exactly 5 parts, unusable transcripts refused), key never in the URL, queueing and reuse, failure reasons, Try again, recovery once a key is added, non-YouTube resources, teacher-only endpoints, students see confirmed lessons only, transcripts downloaded once |
| Student self-paced mode | `client/test/studentPlans.test.tsx`, `e2e/lesson-plans.spec.ts` | "Part 3" mid-sentence, going back, out-of-range parts, topic commands, listener restart and permission denial, transcript with timestamp links, lesson search |
| Search | `server/test/search.test.ts`, E2E | Typos, word order, language names, grade, ranking, numbers exact, no poor matches |

## What the tests do not prove

**Voice tests use a scripted recognition engine.** They prove that a transcript flows correctly through the adapter, parser, API, database, sockets and student page. They do **not** prove that any real microphone or speech engine produces those transcripts, or how accurately.

Automated accessibility checks catch only some issues. They do not replace testing with students who use these features, or with screen readers.

## Real microphone test: 2026-11-08

One informal run, in Google Chrome 146 on Linux, with one person's voice and the laptop's built-in microphone.

- **Brave:** failed with the speech engine's `network` error, although the internet connection worked. Use Google Chrome for the teacher's page.
- **Chrome:** three spoken commands changed the session through the server (Topic 1 to 3, Topic 3 to 2, pause). Eight changes were expected from the phrase list, so **this is not yet reliable**.
- **Cause unknown.** Spoken phrases and rejected commands are not recorded, so the run cannot show which phrase produced which change. The first change went to Topic 3 when the first phrase was "Start Topic 2": either a misheard number or a missed phrase. A misheard number would put the student on the wrong topic, so this needs resolving before classroom use. Phrases running together are another possible cause.
- **Not assessed:** phrases 9 to 11 (rejections and ordinary speech), recovery after silence, and whether the student window followed each change.

## Manual verification still needed

1. **Real voice, most important.** Run the protocol in [EVALUATION.md](EVALUATION.md#voice-accuracy) with testing mode on; its log shows why any command was lost. In desktop Chrome on `localhost`: allow the microphone, then say each command in the README, several times. Record how often each is recognised, in a realistic room, with the real teacher's voice and accent. Try each of the English language settings.
2. **Ordinary speech.** Teach naturally for 10 minutes with the microphone on, and confirm nothing changes unintentionally. If it does, require the wake phrase.
3. **Long sessions.** Leave the microphone on through a full lesson with silences, and confirm that listening recovers on its own.
4. **Microphone denied for real.** Block the permission in the browser and confirm the message.
5. **Two real devices.** Connect both to the same network. On the teacher's computer open `localhost`, then open the Student link from the dashboard on a phone or tablet. If nothing loads, check the computer's firewall allows the port. This was checked with two browser contexts on one machine through the LAN address, not with a second device.
6. **Wi-Fi loss.** Turn off Wi-Fi on the student device, change topic, turn it back on, and confirm it catches up. (Automated tests simulate this by severing the socket.)
7. **Other browsers.** Safari, Firefox, Edge and mobile browsers have not been run.
8. **Real resources.** Ashray Akruti's YouTube lessons are imported and one played in the page on an emulated phone, and a sample of 41 allow embedding. Still to check: playback on a real phone over the school's internet.
9. **Screen reader.** Try NVDA or VoiceOver on the student page, including topic-change announcements.
10. **Docker.** Build and run the image; it has only been linted.
