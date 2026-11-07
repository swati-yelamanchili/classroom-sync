# Ashray Akruti Classroom Sync

A teacher's device and a student's device stay on the same lesson topic. The teacher says "Start Topic 3", and the student's screen changes to that topic's existing sign language video and script, with no refresh.

**This platform does not create educational content.** It organises, maps, retrieves and displays existing resources. It never generates scripts or videos, never rewrites scripts, and never invents links.

> **Current data:** no authentic Ashray Akruti resources were supplied during development. The library ships with five clearly labelled **Demo Resources**: title-card clips and placeholder text with no teaching content. See [Resource import](#resource-import).

## Contents

[Problem](#problem-statement) · [Stack](#technology-stack) · [Architecture](#system-architecture) · [Install](#installation) · [Environment](#environment-variables) · [Database](#database) · [Demo data](#demo-data) · [Import](#resource-import) · [Teacher](#teacher-workflow) · [Student](#student-workflow) · [Sync](#real-time-synchronisation) · [Timestamp mode](#timestamp-mode) · [Voice](#voice-recognition) · [Browsers](#browser-compatibility-and-limitations) · [Testing](#testing) · [Deployment](#deployment) · [Limitations](#known-limitations) · [Future](#future-scope)

## Problem statement

Ashray Akruti has sign language videos and matching scripts, but they are hard to weave into live teaching. This platform lets a teacher arrange existing resources into a sequence, then shows the right one on the student's device as the lesson moves on, with as little change to normal teaching as possible.

## Technology stack

| Layer | Choice |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui-style components (Radix, CVA), Lucide, React Router |
| Backend | Node.js, Express 5, TypeScript, Zod |
| Database | SQLite through Prisma (PostgreSQL migration notes in `server/prisma/schema.prisma`) |
| Real time | Socket.IO |
| Voice | Browser Web Speech API behind a replaceable adapter |
| Matching | Deterministic rules, then Fuse.js |
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

The backend is the only source of truth. Details in [ARCHITECTURE.md](ARCHITECTURE.md).

```
shared/   Typed contract: socket events, state machine, revision rule, timing, voice grammar, video URLs
server/   Express API, session service, matching, sequencing, import, Socket.IO hub, Prisma schema and seed
client/   React app: teacher pages, student pages, speech service, demo clips, import templates
e2e/      Playwright tests with teacher and student in separate browser contexts
```

## Installation

Requires Node.js 20 or newer.

```bash
npm run setup
```

This creates `.env` from `.env.example` if it is missing, installs dependencies, applies migrations and seeds the demo resources.

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

## Resource import

Resource library → **Import** accepts CSV or JSON, or use **Add resource** for manual entry. Files are checked first and nothing is saved until you confirm. Malformed rows and duplicates are reported with row numbers. Scripts are stored byte for byte. Templates are downloadable on the page.

Full schema, and how to move from demo to real resources: [RESOURCE_IMPORT.md](RESOURCE_IMPORT.md).

## Teacher workflow

1. **Create:** Lessons → New lesson, one topic per line.
2. **Review:** each topic shows its matched resource, video and script availability, and match type. Preview, replace, remove, rename, reorder or add topics. A topic with no match says "No matching resource found in the current library." and nothing is attached.
3. **Choose a mode:** Voice Trigger (recommended) or Timestamp, then confirm. This creates the session and its code and link. The numbers on screen are the numbers voice commands use.
4. **Teach:** Start session, enable the microphone, and teach. Previous, Next and the sequence list work in both modes.
5. **Finish:** End session. An ended session cannot restart, but the lesson stays saved: run it again, or **Reuse** it as a new draft. History is on the ended session's page.

The sequence is locked while a session is open, so topic numbers cannot change mid-lesson.

## Student workflow

Open the link, or go to `/join` and enter the code. No account or personal details are needed. The student waits until the lesson starts, then sees the current topic with its video and script together. Everything updates automatically. Playback stays in the student's control and nothing autoplays.

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
- Invalid topic numbers are rejected on screen, and the backend validates everything again.
- An optional wake phrase ("Classroom, start Topic 3") can be required in Commands and settings.
- The dashboard always shows the microphone state and the last command with its outcome. Other speech is not displayed or stored.

### Privacy

- The app never stores audio and never sends transcripts to its backend. The backend receives only the resulting command. History records commands only.
- **However, in Chrome and Edge the browser's speech engine sends microphone audio to the browser vendor's cloud service** to transcribe it, under that vendor's terms. This app does not control that. Consider this before use with minors, and get the consent your institution requires.

## Browser compatibility and limitations

| Browser | Voice | Everything else |
| --- | --- | --- |
| Chrome, Edge (desktop) | Expected to work; needs internet | Yes |
| Safari | Partial, varies by version | Yes |
| Firefox | Not available by default | Yes |
| Chrome on Android | Works with quirks; may beep or stop | Yes |

This table reflects general platform knowledge; **only Chrome on Linux has been run**, and only briefly with a real voice. In Brave on Linux, recognition failed with a `network` error, so use Google Chrome as the teacher's browser. See [TESTING.md](TESTING.md).

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

## Deployment

```bash
docker build -t classroom-sync .
```

```bash
docker run -p 4000:4000 -v classroom-data:/data -e TEACHER_PASSCODE=choose-one -e AUTH_SECRET=long-random-string -e COOKIE_SECURE=true -e PUBLIC_BASE_URL=https://your.domain classroom-sync
```

To seed demo resources in a container, run `npx tsx prisma/seed.ts` inside it. Put HTTPS in front, as voice needs it, and make sure the proxy forwards WebSocket upgrades. Run one instance only: timers, presence and the per-session command queue live in process. **The image has not been built or run:** the Dockerfile passes `docker build --check`, but the development machine lacked the disk space for a full build.

## Known limitations

- Authentic Ashray Akruti resources have not been integrated; provenance must be established by whoever imports them.
- **Voice is not yet reliable.** In one informal test with a real voice and microphone in Google Chrome on Linux, commands reached the server, but only 3 of 8 expected changes were recorded, and the cause is unknown. See TESTING.md. Keep the manual controls ready.
- One shared teacher passcode; no individual accounts. Suitable for a prototype, not for public hosting without review.
- Single server instance. If the server restarts during a Timestamp session, wall-clock time keeps counting, so topics catch up immediately on restart.
- Student devices are counted per open page, so two tabs count as two.
- Rate limits are per IP, and a classroom behind one router shares them. Limits are generous and configurable (`RATE_LIMIT_*`).
- A strict grammar means commands embedded in a sentence are ignored by design.
- `npm audit` reports 3 high-severity advisories, all one issue: `deepmerge-ts` inside the Prisma CLI's config loader (`prisma` → `@prisma/config`). npm counts it under production because `prisma` is a peer dependency, but the running server does not import it, and it only processes the project's own Prisma config. The fix is the Prisma 7 major upgrade, which changes the database driver setup, so it was left as a separate decision.

## Future scope

Model-based topic recognition is designed for but not implemented. No AI model exists in this codebase. See [FUTURE_SCOPE.md](FUTURE_SCOPE.md).
