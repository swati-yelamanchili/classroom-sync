# Ashray Akruti Classroom Sync

A teacher's device and a student's device stay on the same lesson topic. The teacher says "Start Topic 3", and the student's screen changes to that topic's existing sign language video and script, with no refresh. For each video, the app also writes a 5-part lesson plan from the video's YouTube transcript, and students can follow it on their own phone: when the teacher says "Part 3", the page moves to Part 3.

**Videos and scripts are never created or changed.** They come only from the library, which holds 523 of Ashray Akruti's own YouTube lessons (see [Ashray Akruti resources](#ashray-akruti-resources)). The one thing the app writes is the **lesson plan**, made by Google Gemini from the video's transcript and labelled everywhere as AI-written, so a teacher should check it before use. The transcript itself is shown exactly as YouTube has it.

> **Data:** the 523 resources link to Ashray Akruti's public YouTube channel and play from there, so devices need internet access. Five clearly labelled **Demo Resources** (local title-card clips and placeholder text) are also seeded, for testing without internet.

## Contents

[Problem](#problem-statement) · [Stack](#technology-stack) · [Architecture](#system-architecture) · [Install](#installation) · [Environment](#environment-variables) · [Database](#database) · [Demo data](#demo-data) · [Search](#searching-resources) · [Import](#resource-import) · [Teacher](#teacher-workflow) · [Student](#student-workflow) · [Lesson plans](#lesson-plans) · [Sync](#real-time-synchronisation) · [Timestamp mode](#timestamp-mode) · [Voice](#voice-recognition) · [Browsers](#browser-compatibility-and-limitations) · [Testing](#testing) · [Deployment](#deployment) · [Limitations](#known-limitations) · [Future](#future-scope)

## Problem statement

Ashray Akruti has sign language videos and matching scripts, but they are hard to weave into live teaching. This platform lets a teacher arrange existing resources into a sequence, then shows the right one on the student's device as the lesson moves on, with as little change to normal teaching as possible.

## Technology stack

| Layer | Choice |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui-style components (Radix, CVA), Lucide, React Router |
| Backend | Node.js, Express 5, TypeScript, Zod |
| Database | SQLite through Prisma (PostgreSQL migration notes in `server/prisma/schema.prisma`) |
| Real time | Socket.IO |
| Voice | Browser Web Speech API behind a replaceable adapter (teacher's device, and optionally each student's) |
| Matching and search | Deterministic matching rules, then Fuse.js; a ranked, typo-tolerant search for the library |
| Lesson plans | Python `youtube-transcript-api` for transcripts, Google Gemini (`gemini-2.5-flash`) for the 5-part plan |
| Testing | Vitest, React Testing Library, Playwright, axe-core |

## System architecture

```
Teacher browser ── speech → parser → validation
      │  authenticated REST (commands)
      ▼
Express API → SessionService (validates, persists, revision + 1) → SQLite
                     │
                     ▼ Socket.IO: full snapshot with revision
      ┌──────────────┼──────────────┐
  Student        Student        Teacher dashboard
```

The backend is the only source of truth. Lesson plans run alongside, in the background:

```
Lesson selects a YouTube video → LessonPlanService queue → python youtube_transcript.py → transcript stored
                                                         → Gemini → 5 parts stored → teacher review, student /lessons
```

Details in [ARCHITECTURE.md](ARCHITECTURE.md).

```
shared/          Typed contract: socket events, state machine, revision rule, timing, voice and part grammar, video URLs, plan types
server/          Express API, session service, matching, search, sequencing, import, lesson plans, Socket.IO hub, Prisma schema, seed
server/scripts/  youtube_transcript.py, the transcript helper
client/          React app: teacher pages, student pages (live and self-paced), speech services, demo clips, import templates
resources/       ashray-akruti-youtube.csv, the 523 Ashray Akruti lessons
e2e/             Playwright tests with teacher and student in separate browser contexts
```

## Installation

Requires Node.js 20 or newer. Lesson plans also need Python 3 and a Gemini API key (see [Lesson plans](#lesson-plans)).

```bash
npm run setup
```

```bash
pip install -r server/requirements.txt
```

`npm run setup` creates `.env` from `.env.example` if it is missing, installs dependencies, applies migrations, seeds the demo resources and imports the 523 Ashray Akruti lessons. The `pip` line installs the transcript package. For lesson plans, put a Gemini key (<https://aistudio.google.com/apikey>) in `.env` as `GEMINI_API_KEY`.

```bash
npm run dev
```

Open <http://localhost:5173>. The teacher passcode is `TEACHER_PASSCODE` in `.env`.

To run the production build on one port (<http://localhost:4000>):

```bash
npm run build
```

```bash
npm start
```

## Environment variables

| Variable | Purpose | Default in `.env.example` |
| --- | --- | --- |
| `DATABASE_URL` | Prisma connection string; SQLite paths are relative to `server/prisma/` | `file:./dev.db` |
| `API_PORT` | API and Socket.IO port. `PORT` is used if this is unset | `4000` |
| `TEACHER_PASSCODE` | Teacher sign-in. **Change outside local demos** | `classroom-demo` |
| `AUTH_SECRET` | Signs teacher cookies. The server refuses to start with the default when `NODE_ENV=production` | development value |
| `CLIENT_ORIGINS` | Comma-separated origins allowed cross-origin. Not needed when same-origin | `http://localhost:5173` |
| `COOKIE_SECURE` | `true` when served over HTTPS | `false` |
| `PUBLIC_BASE_URL` | Base address for student links. Empty means detect the computer's network address | empty |
| `TOPIC_RECOGNITION_PROVIDER` | Stage 3 flag. Only `disabled` exists | `disabled` |
| `GEMINI_API_KEY` | Writes lesson plans. Without it, plans fail with a message saying so | empty |
| `GEMINI_MODEL` | Gemini model for lesson plans | `gemini-2.5-flash` |
| `PYTHON_BIN` | Python 3 with `youtube-transcript-api` installed | `python` on Windows, `python3` elsewhere |

## Database

```bash
npm run db:migrate
```

Applies committed migrations. After changing `schema.prisma`, create a new one with `npm run db:migrate:dev -w server`.

## Demo data

```bash
npm run db:seed
```

Re-running is safe and leaves non-demo resources alone. Each record has provenance `demo`, a source of "Demo dataset (not Ashray Akruti)", and shows a **Demo Resource** badge everywhere it appears. The five records deliberately cover different cases: three local clips, one external page that cannot be embedded, and one script with no video.

## Searching resources

The library and the Replace dialog share one ranked search (`server/src/services/search.ts`). Every typed word must appear in the title, topic, aliases, subject, grade, language name, keywords or description, in any order: as a whole word, the start of a word, or with a small typo (one for 4 to 7 letters, two for longer words; numbers must be exact). Best matches come first: an exact title, then titles starting with the search, then by where the words were found. "traffic rules marathi", "waste managment" and "grade 5 fractions" all work. Results show grade, subject and language, so versions of the same topic can be told apart. Students can filter the lesson list by name.

## Resource import

Resource library → **Import** accepts CSV or JSON, or use **Add resource** for manual entry. Files are checked first and nothing is saved until you confirm. Malformed rows and duplicates are reported with row numbers. Scripts are stored byte for byte. Templates are downloadable on the page.

Full schema, and how to move from demo to real resources: [RESOURCE_IMPORT.md](RESOURCE_IMPORT.md).

## Ashray Akruti resources

[resources/ashray-akruti-youtube.csv](resources/ashray-akruti-youtube.csv) lists 523 sign language lessons from Ashray Akruti's YouTube channel ([@ashray1996](https://www.youtube.com/@ashray1996)): EVS and Maths for grades 1 to 5 in Tamil, Marathi, Hindi, English and Telugu, Grade 6 Science, Grade 10 Social Studies, and their Indian Sign Language training course. `npm run setup` imports it. To import it into an existing database:

```bash
npm run db:import -- resources/ashray-akruti-youtube.csv
```

Re-running is safe: rows already in the library are skipped. Each video plays in the page through YouTube's player and is labelled **Verified Ashray Akruti Resource**, with its playlist as the reference. The videos have no separate scripts, so students see "No script is available". **Videos stream from YouTube, so student devices need internet access**, not only the classroom network.

## Teacher workflow

1. **Create:** Lessons → New lesson, one topic per line.
2. **Review:** each topic shows its matched resource, video and script availability, and match type. Preview, replace, remove, rename, reorder or add topics. A topic with no match says "No matching resource found in the current library." and nothing is attached. **Replace** / **Choose resource** opens already searching for the topic's name, so the closest resources are listed first.
3. **Choose a mode:** Voice Trigger (recommended) or Timestamp, then confirm. This creates the session and its code and link. The numbers on screen are the numbers voice commands use.
4. **Teach:** Start session, enable the microphone, and teach. Previous, Next and the sequence list work in both modes.
5. **Finish:** End session. An ended session cannot restart, but the lesson stays saved: run it again, or **Reuse** it as a new draft. History is on the ended session's page.

The sequence is locked while a session is open, so topic numbers cannot change mid-lesson.

## Student workflow

Open the link, or go to `/join` and enter the code. No account or personal details are needed. The student waits until the lesson starts, then sees the current topic with its video and script together. Everything updates automatically. Playback stays in the student's control and nothing autoplays.

**Without a code** (`/lessons`, linked from the join page): the student chooses any confirmed lesson and sees each topic's video beside its 5-part lesson plan. **Listen for my teacher** turns on the microphone of the student's own device. When it hears "Part 3" (anywhere in a sentence), "next part" or "previous part", the page highlights and scrolls to that part; "Start Topic 2", "next topic" and "previous topic" change topic, using the same strict rule as the teacher's page. The arrows and tapping a part do the same by hand. **Show transcript with timestamps** lists the video's raw YouTube captions line by line; each time opens the video at that moment. This mode needs no session: each device follows what it hears.

## Lesson plans

When a lesson selects a resource with a YouTube video, the server makes a lesson plan for that video in the background, once, and reuses it in every lesson:

1. `server/scripts/youtube_transcript.py` downloads the transcript with the `youtube-transcript-api` Python package, preferring captions in the video's own language. It is stored with its timestamps, so students can read it even when no plan could be written (for example, without a Gemini key).
2. Gemini (`GEMINI_MODEL`) writes an English plan in exactly 5 parts (Part 1 to Part 5), each with what to teach, key words and a check question, using only what the transcript covers.

Teachers see it under **Lesson plan** on each topic in lesson review, with **Try again** if it failed. Students see the same plan. Every plan is labelled as written by AI from the automatic transcript.

Plans can fail, and say why: no Gemini key, Python or the package missing, no transcript, or a transcript too garbled to use. Most Ashray Akruti videos only have YouTube's automatic captions, and some are wrong (one Tamil video's captions were detected as English nonsense); Gemini is told to refuse those rather than guess.

## Real-time synchronisation

- All changes go through authenticated REST endpoints; students can only read.
- The server validates, persists, increments a **revision** and broadcasts a **complete snapshot**.
- Clients keep only the highest revision, so duplicate or late events cannot move a student backwards.
- Joining or reconnecting returns the current state from the database, so anything missed is repaired.
- A dropped connection is noticed within about 10 seconds and shows a warning until the state is resynchronised.
- A command ID makes retried commands idempotent. Commands per session are serialised, so concurrent ones cannot interleave.

## Timestamp mode

A demonstration mode. The **server** tracks active time and holds the one timer that moves topics.

- Each topic runs for its own configured duration (default 60 seconds), from the moment it becomes current.
- Pausing stops the clock and the timer. Resuming continues with the remaining time.
- A manual jump restarts the clock for the topic jumped to.
- The session stays on the final topic until the teacher ends it.
- The microphone is off in this mode. Voice-sourced commands are also rejected by the backend, and the timer never runs in Voice mode. Switching mode requires pausing and confirming.

## Voice recognition

The transcript is matched against a strict **whole-phrase** grammar:

| Say | Effect |
| --- | --- |
| "Start Topic 3", "Go to topic three", "Switch to topic 3" | Go to Topic 3 |
| "Repeat Topic 2" | Go to Topic 2 (the video is not replayed) |
| "Next Topic", "Previous Topic" | Move one topic |
| "Pause Session", "Resume Session" | Pause or resume |

- "Topic three is very important" and "Today we will start topic three" are **not** commands. Say a command on its own, with a brief pause either side. There is deliberately no voice command to end a session.
- Only final results are used. Each is processed once, and a repeated command within 2.5 seconds is dropped.
- Chrome sometimes joins commands spoken close together into one transcript ("start topic 2 next topic"). Each command is carried out, but only if the transcript contains nothing else.
- Common engine spellings are accepted inside a complete command: "goto", "topics", and "tree", "to", "for" for numbers.
- Invalid topic numbers are rejected on screen, and the backend validates everything again.
- An optional wake phrase ("Classroom, start Topic 3") can be required in Commands and settings.
- The dashboard always shows the microphone state and the last command with its outcome. Other speech is not displayed or stored.
- **Testing mode** (Commands and settings) lists everything the microphone hears, what it did and how long it took, and copies it as a table. It is for measuring accuracy: it stays on the teacher's device, is cleared when switched off, and is off after every page load. See [EVALUATION.md](EVALUATION.md#voice-accuracy).

### Privacy

- The app never stores audio and never sends transcripts to its backend. The backend receives only the resulting command. History records commands only.
- **However, in Chrome and Edge the browser's speech engine sends microphone audio to the browser vendor's cloud service** to transcribe it, under that vendor's terms. This app does not control that. Consider this before use with minors, and get the consent your institution requires.
- The same applies to **Listen for my teacher** on a student's device. It is off until the student turns it on, and what it hears stays on the device apart from that transcription.
- Lesson plans send the video's public transcript and title to Google's Gemini API. Nothing about teachers or students is sent.

## Browser compatibility and limitations

| Browser | Voice | Everything else |
| --- | --- | --- |
| Chrome, Edge (desktop) | Expected to work; needs internet | Yes |
| Safari | Partial, varies by version | Yes |
| Firefox | Not available by default | Yes |
| Chrome on Android | Works with quirks; may beep or stop | Yes |

This table reflects general platform knowledge. The app has been run in Chrome on Linux and Windows (automated tests, and emulated Android phones and tablets); **a real voice has only been tried briefly, on Linux**. In Brave on Linux, recognition failed with a `network` error, so use Google Chrome as the teacher's browser. See [TESTING.md](TESTING.md).

- Microphone access requires **HTTPS or localhost**. A teacher on `http://192.168.x.x` cannot use voice; run the teacher's browser on the host computer via `localhost`, or use HTTPS. Students do not need a microphone, so plain HTTP on the LAN works for them.
- Recognition can stop unexpectedly. The app restarts it with backoff and reports problems, but uninterrupted recognition is not guaranteed, and this is not offline recognition.
- Accuracy depends on the microphone, room noise and accent. Manual controls always work.

### External videos

Direct media files play in the page, and YouTube and Vimeo links use their official players. Any other link gets a clear "Open video in a new tab" button, because embedding cannot be assumed. Providers can still block a specific video, so an open-in-new-tab link is always shown. If real videos live on another host, either provide direct file URLs or add the host to `frame-src` in `server/src/app.ts` and to `classifyVideoUrl`.

## Testing

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

E2E uses the installed Google Chrome. Without it, run `npx playwright install chromium` and set `PLAYWRIGHT_CHANNEL=""`. Coverage and the manual checks still needed: [TESTING.md](TESTING.md).

To measure sync delay, emulated Android devices, slow networks and reconnection (about 3 minutes):

```bash
npm run evaluate
```

Results and method: [EVALUATION.md](EVALUATION.md). Teachers' one-page guide: [TEACHER_GUIDE.md](TEACHER_GUIDE.md).

## Deployment

One container serves the API, Socket.IO and the built client on port 4000, with Python and `youtube-transcript-api` included for lesson plans. On every start it applies migrations, imports the 523 Ashray Akruti lessons **if the library is empty**, then starts the server. Data lives in the `/data` volume. A health check calls `/api/health`.

With Docker Compose, set `TEACHER_PASSCODE`, `AUTH_SECRET` (a long random string) and optionally `GEMINI_API_KEY` and `PUBLIC_BASE_URL` in `.env`, then:

```bash
docker compose up --build
```

Or with plain Docker:

```bash
docker build -t classroom-sync .
```

```bash
docker run -p 4000:4000 -v classroom-data:/data -e TEACHER_PASSCODE=choose-one -e AUTH_SECRET=long-random-string -e GEMINI_API_KEY=your-key -e PUBLIC_BASE_URL=http://192.168.1.20:4000 classroom-sync
```

- **Set `PUBLIC_BASE_URL`** to the address students should use, such as the laptop's Wi-Fi address. Inside a container the app sees only the container's own network, so the student link it would detect is wrong.
- The teacher should open the app at `http://localhost:4000` on the host, because microphone access needs `localhost` or HTTPS. For other machines, put HTTPS in front (and set `COOKIE_SECURE=true`), with WebSocket upgrades forwarded.
- Run one instance only: timers, presence, the per-session command queue and the lesson-plan queue live in the process.
- Demo resources are not seeded in the container. Run `npx tsx prisma/seed.ts` inside it if you want them.

**The image has not been built here:** Docker is not installed on the development machine. Every step of its start command (migrations on an empty database, importing 523 lessons, skipping the import on the next start, serving the app in production mode, the health check) was run on the host instead, and the production secret check was confirmed to refuse the default `AUTH_SECRET`. Build it once before relying on it.

## Known limitations

- Ashray Akruti's videos come from their public YouTube channel, so students need internet access to watch them, and no scripts are included yet. Titles were tidied from the YouTube titles (the originals are kept in each resource's description); where a YouTube title and its playlist disagreed on language or subject, the title was followed.
- Matching does not consider language. When a topic exists in several languages, one is chosen and the others are offered as alternatives in lesson review.
- **Lesson plans are AI-written** from automatic transcripts and have not been reviewed by Ashray Akruti. They are labelled as such; a teacher should read each plan before using it. Quality depends on the transcript, and some videos have none that is usable.
- Students listening for "Part 3" on their own phones has only been tested with a scripted speech engine. A phone at a desk hears the teacher less clearly than the teacher's own microphone, so real accuracy is likely lower; tapping the parts always works.
- The student lesson list (`/lessons`) shows every confirmed lesson to anyone who can reach the app, without a code. Fine on a classroom network; review it before hosting publicly.
- **Voice accuracy is not yet measured.** In one earlier informal test with a real microphone, only 3 of 8 expected changes were recorded. Joined commands and common engine spellings are now handled, which are likely causes, but this has not been confirmed with a real voice. Run the protocol in [EVALUATION.md](EVALUATION.md#voice-accuracy), and keep the manual controls ready.
- One shared teacher passcode; no individual accounts. Suitable for a prototype, not for public hosting without review.
- Single server instance. If the server restarts during a Timestamp session, wall-clock time keeps counting, so topics catch up immediately on restart.
- Student devices are counted per open page, so two tabs count as two.
- Rate limits are per IP, and a classroom behind one router shares them. Limits are generous and configurable (`RATE_LIMIT_*`).
- A strict grammar means topic commands embedded in a sentence are ignored by design. "Part 3" on a student's device is the exception: it is recognised mid-sentence, because a wrong jump only scrolls that student's own page.
- `npm audit` reports 3 high-severity advisories, all one issue: `deepmerge-ts` inside the Prisma CLI's config loader (`prisma` → `@prisma/config`). npm counts it under production because `prisma` is a peer dependency, but the running server does not import it, and it only processes the project's own Prisma config. The fix is the Prisma 7 major upgrade, which changes the database driver setup, so it was left as a separate decision.

## Future scope

Model-based topic recognition (Stage 3: noticing from ordinary speech that the lesson has moved on) is designed for but not implemented. The only AI in the app is Gemini writing lesson plans, which is separate. See [FUTURE_SCOPE.md](FUTURE_SCOPE.md). Other next steps: Ashray Akruti reviewing the AI plans, choosing a topic's language automatically, and their scripts.
