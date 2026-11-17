# Classroom Sync: our briefing notes

Everything we need to present the project and answer questions. The README is the reference for setup; this file is for explaining.

## The pitch, in 30 seconds

Hearing-impaired students in Ashray Akruti's schools struggle to follow spoken lessons, and teachers have no time to prepare sign language material. Ashray Akruti already has hundreds of sign language lesson videos. **Classroom Sync puts those videos in front of the student at the moment the topic is taught.** The teacher types the lesson's topics; the app finds the matching videos. In class, the teacher says "Start Topic 3" and every student's phone switches to Topic 3's video, live, with no refresh. For each video the app also writes a 5-part lesson plan from the video's transcript, and a student can follow it alone: when the teacher says "Part 3", the student's page jumps to Part 3.

## The problem we were given

- Ashray Akruti has sign language videos and scripts, but they are not organised around lessons.
- Students fall behind in verbal lessons that have little sign language support, and depend on the teacher's individual attention.
- Teachers lack the time and resources to adapt lessons in advance.
- Rural classrooms: Android phones, weak or slow connections.

Our original roadmap had three stages: **Stage 1** timestamp sync (topics move on a timer), **Stage 2** explicit voice triggers ("Start Topic 3"), **Stage 3** automatic topic recognition from ordinary speech. Stages 1 and 2 are built. Stage 3 is designed for but deliberately not built.

## What the app does

| Who | Feature | Where |
| --- | --- | --- |
| Teacher | Type topics, get matched videos and a suggested order; preview, replace, reorder, rename | Lessons → New lesson |
| Teacher | Read the AI lesson plan for each topic; Try again if it failed | Lesson review → **Lesson plan** |
| Teacher | Live session: voice commands, Next/Previous buttons, topic list, pause, timer mode | Live session page |
| Teacher | Testing mode: see everything the microphone heard and how long updates took | Live session → Commands and settings |
| Teacher | Search 528 resources with typos, any word order, by grade or language | Resource library, Replace dialog |
| Teacher | Import resources from CSV or JSON | Resource library → Import |
| Student (live) | Join with a 6-letter code; screen follows the teacher; video and script together | `/join` |
| Student (self-paced) | Pick any lesson; see each video with its 5-part plan; phone listens for "Part 3" | `/lessons` |
| Student (self-paced) | Raw transcript with timestamps; tap a time to open the video there | `/lessons/...` → **Show transcript** |

## Demo script (about 5 minutes)

Before presenting: `npm run build`, `npm start`, open `http://localhost:4000` in **Google Chrome** on the laptop (microphone needs `localhost`), sign in with the passcode in `.env`, and check the phone is on the same Wi-Fi, can open the student link, and can play YouTube.

1. **New lesson** → type `Waste Management`, `Traffic Rules`, `Air` → **Find resources**. Point out: exact matches, "Verified Ashray Akruti Resource", grade and language shown.
2. Press **Lesson plan** on Traffic Rules: 5 parts, labelled AI-written. (Needs `GEMINI_API_KEY`.)
3. **Replace** on one topic: the search opens pre-filled; type "traffic rules marathi" to show narrowing.
4. **Confirm sequence** → the phone opens the student link → "Waiting for your teacher".
5. **Start session**, **Enable microphone**, say **"Start Topic 2"** → the phone shows Traffic Rules.
6. Say **"Today we will start topic three"** → nothing changes. (Ordinary speech is ignored.)
7. Turn the phone's Wi-Fi off, press Next, turn it on → it catches up by itself.
8. Second phone: `/lessons` → choose the lesson → **Listen for my teacher** → say "now look at part 3" → the page jumps to Part 3. **Show transcript** → tap a time.

**If voice fails on the day:** every step works with the buttons. Say so calmly; it is the designed fallback.

## How it works

### Architecture

```
Teacher browser ── speech → parser → validation ──REST (authenticated)──▶ Express API
                                                                            │
                                         SessionService: validate, save, revision + 1 → SQLite (Prisma)
                                                                            │
                                         Socket.IO: complete snapshot with revision number
                                         ┌──────────────┬───────────────┐
                                     Student         Student      Teacher dashboard
```

- **The server is the only source of truth.** Clients never decide the current topic; they display what the server says.
- **Commands go up over REST, state comes down over Socket.IO.** Students have no way to change anything.
- **Full snapshots, not changes.** Every broadcast contains the whole state, so a missed message cannot leave a phone inconsistent.
- **Revision numbers.** Each change increments a counter; a phone ignores any snapshot older than the one it has, so late or duplicated messages cannot move it backwards.
- **Reconnection.** On reconnect, the phone asks for the current state and catches up. A dropped connection shows a red warning within about 10 seconds.
- **Safety under load.** Each command has an ID, so a retried command is not applied twice. Commands for one session are processed one at a time.

Code layout: `shared/` (types and logic used by both sides), `server/` (API, services, database), `client/` (React app), `e2e/` (browser tests), `resources/` (the Ashray Akruti CSV).

### Matching a typed topic to a video

In order, stopping at the first that finds something:

1. Exact title or topic.
2. Same title ignoring case and punctuation.
3. An alias or keyword.
4. A conservative fuzzy match (Fuse.js, threshold 0.3), only for queries of 4+ letters that cover at least 60% of the title.

If nothing qualifies: **"No matching resource found in the current library."** The app never attaches a doubtful video by itself. Ties go to verified resources, then curriculum order, then title. If several are equally good, the others are offered as alternatives.

### Searching the library (separate from matching)

Matching is strict because it attaches videos automatically. Search is for a person choosing, so it is generous:

- Every typed word must appear somewhere (title, topic, grade, subject, **language name**, description), in any order.
- A word can match a whole word, the start of a word, or with a small typo (1 edit for 4–7 letters, 2 for longer). Numbers must be exact, so "grade 4" never finds Grade 5.
- Ranked: exact title first, then titles starting with the search, then by where the words were found.
- "Perimeter" finds 5 videos (none before), "waste managment" and "rules for traffic" work, "traffic rules marathi" finds only the Marathi one. About 50 ms over 528 resources.
- The Replace dialog opens already searching for the topic's name.

### Voice commands (teacher)

- The browser's Web Speech API turns speech into text (in Chrome, Google does this in the cloud).
- A **strict whole-phrase grammar**: the text must be only commands. "Start Topic 3" works; "Topic three is very important" does not.
- Recognised: start / go to / switch to / repeat topic N, next topic, previous topic, pause session, resume session. Number words ("three") and common mishearings ("tree", "to", "for", "goto") are accepted inside a complete command.
- Chrome sometimes joins two commands said close together ("start topic 2 next topic"); each is carried out.
- The same command within 2.5 seconds is ignored (engines sometimes deliver it twice).
- Checked on the teacher's device for a friendly message, and checked again on the server.
- Optional wake word: "Classroom, start Topic 3".
- Testing mode logs every phrase heard, the result and the time to update, and copies it as a table.

### Timestamp mode (Stage 1)

Each topic runs for a set duration, and the **server** holds the only timer. Pause stops it; a manual jump restarts the clock for that topic. Voice and timer modes cannot both drive a session.

### Ashray Akruti's resources

- Their YouTube channel (@ashray1996) has about 30 playlists by grade, subject and language. We collected 534 videos from those playlists, removed duplicates, and got **523 lessons**: EVS and Maths for grades 1–5 in Tamil, Marathi, Hindi, English and Telugu, Grade 6 Science, Grade 10 Social Studies, and a 24-video Indian Sign Language course.
- Titles were cleaned: "EVS_ 4 | Tamil | Traffic Rules | Lessons in Sign Language for H.I" becomes "Traffic Rules", with grade "Grade 4 EVS" and language "ta". The original title is kept in the description.
- Stored as `resources/ashray-akruti-youtube.csv`, loaded with the same import the teacher uses (`npm run db:import`). Videos play through YouTube's own player inside the page.
- Labelled "Verified Ashray Akruti Resource" because they come from the NGO's own channel.

### Lesson plans

1. When a lesson selects a video, the server queues a plan for it. One plan per video, reused by every lesson that uses it.
2. A Python script (`server/scripts/youtube_transcript.py`, using the `youtube-transcript-api` library) downloads the video's transcript **with timestamps**, preferring the video's own language. It is saved.
3. Google **Gemini** (`gemini-2.5-flash`, temperature 0.3) gets the transcript and is asked for **JSON with exactly 5 parts**, each with a title and content: what to teach, key words to sign and show, and one check question. Written in English. Told to use only what the transcript covers.
4. The reply is checked: exactly 5 parts with a title and content, or it is rejected. If the transcript is garbled, Gemini is allowed to answer "unusable" and the app says so instead of showing an invented plan.
5. Plans are made one at a time in the background, so the teacher never waits and Gemini's rate limits are respected.
6. Every failure gets a reason a teacher can act on: no key, Python missing, no transcript, transcript too unclear, Gemini error. **Try again** reruns it. Plans that failed only for lack of a key retry themselves once one is added.
7. Every plan is labelled "Written by AI (Gemini) from the video's automatic transcript. Check it before teaching."

### Students following on their own (`/lessons`)

- Lists every confirmed lesson; a search box filters by name.
- Each topic shows the video and its 5-part plan. Arrows and tapping a part move between parts.
- **Listen for my teacher** uses the student's own phone microphone:
  - "Part 3" is recognised **anywhere in a sentence** ("now look at part 3"), plus "next part" and "previous part". Going back ("part 1" after part 4) works.
  - "Start Topic 2" changes topic, using the same strict rule as the teacher.
  - The page highlights the part, scrolls to it, and tells screen readers.
- **Show transcript with timestamps**: YouTube's captions line by line; each time opens the video at that second. Loaded only when asked, saved after the first download.

### Making it work on slow rural connections

| Change | Why |
| --- | --- |
| Server compresses responses | The app's code is about a third the size over the network |
| Built files cached on the phone for a year | Their names change when the code changes, so a phone downloads each version once |
| Teacher pages load only for teachers | A student's phone downloads only the student pages (main bundle 471 KB → 371 KB; 119 KB compressed) |

Result: a student's first load on emulated Slow 3G went from **12.2 s to 5.3 s**, and on Fast 3G from 3.7 s to 1.9 s.

## Results (emulated, `npm run evaluate`)

20 topic changes per setup, measured from the teacher's action to the moment the title changes on the student's screen.

| Setup | Page load | Median delay | Slowest | Correct |
| --- | --- | --- | --- | --- |
| Desktop | 0.26 s | 40 ms | 80 ms | 20/20 |
| Pixel 7 phone | 0.24 s | 45 ms | 63 ms | 20/20 |
| Galaxy Tab S4 tablet | 0.23 s | 42 ms | 78 ms | 20/20 |
| Phone on Fast 3G | 1.9 s | 146 ms | 164 ms | 20/20 |
| Phone on Slow 3G | 5.3 s | 295 ms | 433 ms | 20/20 |
| Voice path (scripted speech) | – | 23 ms | 36 ms | 20/20 |
| Reconnecting after going offline | – | 756 ms | 1.2 s | 5/5 |

- **140 of 140** topic changes correct. Worst delay 0.43 s, well under our 2-second target.
- No sideways scrolling on phone or tablet.
- **Not measured: voice accuracy with a real person.** An early informal test got 3 of 8. We fixed the two likely causes (joined commands and mishearings) and wrote a 20-command protocol in `EVALUATION.md`, but have not run it with a real voice. Target: 18 of 20.

## Testing

| Suite | Count | What it covers |
| --- | --- | --- |
| Shared logic | 91 | Voice and part grammar, state machine, revisions, timing, video URLs |
| Server | 128 | Real HTTP server, real SQLite, real sockets: matching, search, import, sessions, timers, security, lesson plans |
| Client | 68 | Components, speech services, student listening, transcript panel |
| End to end (Chrome) | 25 | Full flows with teacher and student in separate browsers, accessibility (axe WCAG A/AA), phone layout |
| Measurements | 8 | Delays, devices, networks, reconnection |

**What is faked in tests, and why:** the browser's speech engine (we cannot speak into an automated test, so a scripted engine feeds the same text a real one would), and Gemini's reply (tests must not call a paid API). Everything after those points runs for real.

## Why we made these choices

| Decision | Reason |
| --- | --- |
| Server is the single source of truth | A phone can drop off and come back; only one place can be right. Students cannot change anything. |
| Full snapshots with revision numbers | Simpler and safer than sending changes: a lost or late message cannot corrupt a phone's state. |
| Strict voice grammar for topics | A wrong topic change disrupts a whole class. Missing a command is cheaper: the teacher says it again or presses Next. |
| Loose grammar for "Part 3" on a student's phone | A wrong jump only scrolls one student's page, and teachers say "part 3" mid-sentence. |
| Matching is strict, search is generous | Matching attaches videos automatically; search shows choices to a person. |
| Manual buttons always available | Voice depends on the room, the microphone and the internet. |
| SQLite | One file, no database server to install on a school laptop. Prisma makes moving to PostgreSQL a config change. |
| Web Speech API behind an adapter | Free and built into Chrome; the adapter lets another engine replace it without touching the rest. |
| YouTube's player, not downloading videos | The videos stay Ashray Akruti's, on their channel, with YouTube adapting quality to slow connections. |
| One lesson plan per video, made in the background | Gemini is called once per video, not per lesson, and teachers never wait. |
| Plans in English, as JSON with exactly 5 parts | One language for teachers and for the "Part N" commands; validated structure means a bad reply is caught, not shown. |
| Python for transcripts | `youtube-transcript-api` is the established library; the server calls it as a small script. |
| Self-paced student mode added alongside the live mode | Nothing already built and measured is lost. |
| Stage 3 not built | Reliability first. If built, it should only suggest ("Move to Topic 3?") and need the teacher's confirmation. |

## Limitations (say these before anyone asks)

- **Voice accuracy with a real voice is unmeasured**, as above. The buttons always work.
- **All device and network results are emulated** in Chrome, not on real Android phones or school Wi-Fi.
- **Videos stream from YouTube**, so student devices need internet, not just the classroom network. Voice also needs internet (Chrome sends audio to Google).
- **Lesson plans are AI-written** from YouTube's automatic captions and have not been reviewed by Ashray Akruti. Some captions are wrong: the Tamil "Waste Management" video's captions were detected as English nonsense, so it gets no plan.
- **Plans need a Gemini API key**; without one, the transcript still works.
- **No scripts** for the YouTube lessons; students see "No script is available".
- **Matching ignores language**: if a topic exists in Tamil and Marathi, the teacher may need to press Replace to pick the right one.
- Some YouTube titles and playlists disagree on language or subject, so a few labels may be wrong.
- One shared teacher passcode, no individual accounts. `/lessons` is open to anyone on the network.
- The Docker image has not been built (Docker is not installed on our machine); every step of its start command was tested on the host.
- On Windows, the server test suite sometimes crashes a worker with a native error; it happens on the original code too, and every test passes when run again.

## Questions we might be asked

**What problem does this solve, in one sentence?**
It shows a hearing-impaired student the right sign language video at the moment the teacher reaches that topic, without the teacher stopping to find it.

**Your plan said you would not create content. Why do you generate lesson plans?**
The videos and scripts, the actual teaching material, are never created or changed. The lesson plan is a teacher's aid made only from Ashray Akruti's own video, labelled as AI-written everywhere, and meant to be checked before use. We added it after the hackathon plan because a video alone gives the student no structure to follow; the plan gives "Part 1 to Part 5" that the teacher can refer to by voice. The next step is Ashray Akruti reviewing the plans.

**What happens if the AI makes something up?**
Gemini is told to use only the transcript, with low randomness, and to refuse unusable transcripts. The reply must be exactly 5 parts or it is rejected. It is labelled AI-written, and the transcript is available for checking. It is not verified content, and we say so.

**Why is the voice not always reliable?**
Speech recognition depends on the microphone, room noise and accent, and Chrome's engine sometimes joins phrases or mishears numbers. We handled joined phrases and common mishearings, and kept the grammar strict so ordinary speech never triggers a change. The buttons are always there.

**How do you know the student's screen updates in time?**
We measured it: 140 changes across 7 setups, median 40–300 ms, worst 0.43 s on emulated Slow 3G, against a 2-second target.

**What if a student's phone loses connection?**
A red bar appears. When it reconnects it asks the server for the current state and catches up, in under about 1.2 s in our tests. The student never has to refresh.

**What if two commands arrive at once, or one arrives twice?**
Commands for a session are processed one at a time, and each has an ID so a retry is not applied twice. Phones keep only the newest revision.

**Does it work without internet?**
Topic sync works on a local network. Videos (YouTube), voice (Google's speech service) and lesson plans (Gemini) need internet. Demo resources and the buttons work offline.

**Is student data collected?**
No accounts, no names, nothing stored about students. No audio is stored. Chrome's speech engine does send microphone audio to Google to transcribe it, which needs consent, especially for minors. Lesson plans send only the video's public transcript and title to Gemini.

**Why not use the student's phone microphone for everything?**
For the live session, the teacher's laptop is closer to the teacher and one device decides for the whole class. In the self-paced mode, each phone listens for "Part N" because there is no session to follow.

**Why SQLite and not a "real" database?**
It is one file, needs no setup on a school laptop, and the app runs one server. Moving to PostgreSQL is a configuration change with Prisma.

**How does matching avoid attaching the wrong video?**
It tries strict rules first, uses fuzzy matching only when the typed topic covers most of a title, and otherwise attaches nothing and says so. The teacher confirms everything before class.

**How did you get the videos?**
From Ashray Akruti's public YouTube channel, by reading its playlists. We stored only links, titles, grade, subject and language in a CSV; the videos stay on YouTube.

**Why is a resource "Verified"?**
Because it comes from Ashray Akruti's own channel. The app cannot verify claims itself; whoever imports data is responsible, and the import refuses "verified" without a source organisation and reference.

**Why doesn't the app pick the right language automatically?**
Matching works on topic names, and the same topic exists in several languages. It is on our list; for now, results show the language and Replace searches by it ("traffic rules marathi").

**How would you do Stage 3 (automatic topic recognition)?**
A model would listen to the teacher's speech and suggest "Move to Topic 3?", choosing only among the lesson's existing topics, with the teacher confirming. The interface and a disabled flag are already in the code (`FUTURE_SCOPE.md`). We did not build it because a wrong automatic switch hurts more than a late one.

**How is it secure?**
Signed, `httpOnly` cookies with a passcode and rate limiting; every teacher action is checked on the server; inputs validated (Zod); scripts are shown as text, never HTML; a content security policy only allows YouTube and Vimeo players; the Gemini key stays on the server and is never sent in a URL.

**How is it accessible?**
Large text and adjustable size, screen-reader announcements when the topic or part changes, keyboard support, no autoplay, automated WCAG A/AA checks on 13 page states, and phone layouts without sideways scrolling.

**What would you do with more time?**
Run the voice protocol with a real teacher, test on real Android phones on school Wi-Fi, have Ashray Akruti review the plans, get their scripts, choose the class's language automatically, and build Stage 3 as suggest-only.

**What did you test, and what is faked?**
See Testing above: 312 automated tests. Only the speech engine and Gemini are faked, because a test cannot speak or should not call a paid API.

## Plan versus delivered

| Planned | Status |
| --- | --- |
| 1. Load real Ashray Akruti resources | **Done**: 523 lessons from their YouTube channel |
| 2. Voice reliable (18/20, under 2 s) | **Partly**: likely causes fixed, testing mode added, under 2 s measured; 18/20 with a real voice not yet run |
| 3. Classroom readiness (Android, slow networks) | **Done in emulation**: phone and tablet layouts, Slow 3G 12.2 s → 5.3 s; real devices still to test |
| 4. Teacher usability and guide | **Done**: `TEACHER_GUIDE.md`; a test with someone outside the team still to do |
| 5. NGO feedback | **Not yet** |
| Stretch: Stage 3 | **Not built**, by design |
| Added | Lesson plans, self-paced student mode with "Part N" listening, transcripts with timestamps, typo-tolerant search, Docker Compose |

## Numbers to remember

- 523 Ashray Akruti lessons (from 534 videos in about 30 playlists); 528 resources including 5 demo.
- 5 parts per lesson plan; one plan per video; `gemini-2.5-flash`.
- 140/140 correct updates; worst delay 0.43 s; target 2 s.
- Slow 3G first load 12.2 s → 5.3 s.
- Reconnection median 0.76 s.
- 312 automated tests (91 + 128 + 68 + 25).
- Repeated command ignored within 2.5 s; dropped connection shown within about 10 s.
- Session codes: 6 characters, without 0/O or 1/I so they are easy to read aloud.

## Commands

| Task | Command |
| --- | --- |
| First setup (installs, database, demo data, 523 lessons) | `npm run setup` then `pip install -r server/requirements.txt` |
| Run for development | `npm run dev` → <http://localhost:5173> |
| Run as in production | `npm run build` then `npm start` → <http://localhost:4000> |
| Import a resource file | `npm run db:import -- resources/ashray-akruti-youtube.csv` |
| Tests | `npm run typecheck`, `npm test`, `npm run test:e2e` |
| Measurements | `npm run evaluate` |
| Docker | `docker compose up --build` (set `TEACHER_PASSCODE`, `AUTH_SECRET`, `PUBLIC_BASE_URL`, `GEMINI_API_KEY` in `.env`) |

## Where things are

| What | File |
| --- | --- |
| Session logic, timer, snapshots | `server/src/services/sessions.ts` |
| Topic matching | `server/src/services/matching.ts` |
| Library search | `server/src/services/search.ts` |
| Lesson plans and student lesson views | `server/src/services/lessonPlans.ts` |
| Transcript download | `server/scripts/youtube_transcript.py` |
| API routes | `server/src/app.ts` |
| Voice and part grammar | `shared/src/voice.ts` |
| Teacher speech service | `client/src/speech/SpeechRecognitionService.ts` |
| Student listening | `client/src/speech/studentListener.ts` |
| Student pages (live / self-paced) | `client/src/pages/StudentLesson.tsx`, `client/src/pages/StudentBrowse.tsx` |
| Lesson plan display | `client/src/components/LessonPlan.tsx` |
| Database schema | `server/prisma/schema.prisma` |
| The 523 lessons | `resources/ashray-akruti-youtube.csv` |
| Teacher guide, evaluation, testing | `TEACHER_GUIDE.md`, `EVALUATION.md`, `TESTING.md` |
