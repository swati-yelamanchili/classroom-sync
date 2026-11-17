# Evaluation Report

What we measured, how, and what still has to be measured with real devices and a real voice.

| Target from our plan | Result | Status |
| --- | --- | --- |
| Student screen updates within 2 seconds of a command | Under 0.5 s in every emulated setup, including Slow 3G (worst case 433 ms) | **Met** (emulated) |
| Every command reaches the student correctly | 140 of 140 topic changes correct across 7 scenarios | **Met** (emulated) |
| Student interface works on Android phones and tablets | No sideways scrolling; video above script; works by touch | **Met** (emulated); real devices still to test |
| Usable on slow connections | First load on Slow 3G cut from 12.2 s to 5.3 s | **Improved** |
| Uses Ashray Akruti's real resources | 523 lessons from their YouTube channel imported; a lesson built from typed topic names matched them and played on an emulated phone | **Met**; scripts not yet available |
| At least 18 of 20 spoken commands take effect | Needs a real microphone: see [Voice accuracy](#voice-accuracy) | **Not yet measured** |

## How we measured

`npm run evaluate` runs [e2e/evaluation.spec.ts](e2e/evaluation.spec.ts). It starts the production build, creates a 5-topic lesson as the teacher, joins as a student in a separate browser, and moves between topics 20 times per scenario. A script in the student's page records the exact moment the topic title changes, and the delay is measured from the teacher's click (or voice command) to that moment.

- **Devices** are emulated in Google Chrome: the Pixel 7 and Galaxy Tab S4 profiles set screen size, pixel density, touch input and the Android user agent.
- **Networks** use Chrome's throttling: Fast 3G (150 ms latency, 1.6 Mbit/s down) and Slow 3G (400 ms latency, 400 kbit/s). Chrome does not throttle live connections (WebSockets), so the test adds the same latency to every real-time message itself.
- **Loss of connection** is simulated by switching the student's browser offline, changing topic, then switching it back on.

Results are written to [evaluation/results.md](evaluation/results.md), and screenshots to [evaluation/screenshots/](evaluation/screenshots/).

## Results

Run on 2026-11-14, Windows 11, Node 24, Google Chrome. Times in milliseconds; 20 topic changes per row.

| Scenario | Student page load | Downloaded | Delay median | Delay p95 | Delay max | Correct |
| --- | --- | --- | --- | --- | --- | --- |
| Desktop | 261 | 180 KB | 40 | 71 | 80 | 20/20 |
| Android phone (Pixel 7) | 241 | 180 KB | 45 | 54 | 63 | 20/20 |
| Android tablet (Galaxy Tab S4) | 229 | 180 KB | 42 | 60 | 78 | 20/20 |
| Android phone on Fast 3G | 1,893 | 162 KB | 146 | 161 | 164 | 20/20 |
| Android phone on Slow 3G | 5,327 | 147 KB | 295 | 324 | 433 | 20/20 |
| Voice command to student screen (phone) | – | – | 23 | 29 | 36 | 20/20 |
| Reconnection after going offline (5 trials) | – | – | 756 | 1,175 | 1,175 | 5/5 |

- **Topic changes are fast even on poor connections.** On Slow 3G the student saw each change in about 0.3 s, well inside the 2-second target.
- **The voice row starts after the speech engine.** It covers parsing the command, the server and the student's screen. The engine's own time to produce text is not included, because it needs a real microphone.
- **A dropped connection repairs itself.** The student caught up with the current topic about 1 second after coming back online, with no refresh. The red "Connection lost" bar appeared each time.

## Improvements made during the hackathon

| Problem found | Fix | Effect |
| --- | --- | --- |
| The student page took **12.2 s** to load on Slow 3G | The server now compresses its responses, built files are cached on the device, and teacher-only pages are no longer sent to students | **5.3 s** on Slow 3G (−56%); Fast 3G 3.7 s → 1.9 s. App code sent to a student: 471 KB → 119 KB |
| Chrome joins commands spoken close together into one transcript, such as "start topic 2 next topic", and these were ignored | Each command in such a transcript is now carried out, provided the transcript contains nothing but commands | Ordinary speech is still ignored; tested with new unit and service tests |
| The speech engine writes some words differently: "goto topic 3", "next topics", "start topic tree" | These spellings are accepted | Only inside an otherwise complete command |
| No way to tell why voice commands were missed in the earlier real-microphone test (3 of 8) | A **testing mode** on the live page lists everything the microphone heard, what it did, and how long it took, and copies it as a table | Makes the voice accuracy test below possible |
| End-to-end tests failed on Windows from the second run (Unix-only `mkdir -p` and `rm -f`) | Replaced with a Node command | Tests run on Windows, macOS and Linux |

## Voice accuracy

**Not yet measured.** It needs a person speaking into a real microphone, which an automated test cannot do. Run this protocol once per speaker and room.

**Setup:** Google Chrome on the teacher's laptop, opened at `localhost`, in a normal classroom. Create a lesson with 5 topics in Voice Trigger mode, for example Waste Management, Traffic Rules, Air, Birds, Weather and Climate. Start the session, open a student page on a phone, and enable the microphone. In **Commands and settings**, tick **Testing mode**.

**Say each line once, pausing about 2 seconds between lines:**

| # | Say | Student should show | # | Say | Student should show |
| --- | --- | --- | --- | --- | --- |
| 1 | Start Topic 2 | Subtraction | 11 | Previous Topic | Division |
| 2 | Next Topic | Multiplication | 12 | Repeat Topic 1 | Addition |
| 3 | Go to Topic 5 | Fractions | 13 | Switch to Topic 3 | Multiplication |
| 4 | Previous Topic | Division | 14 | Start Topic 2 | Subtraction |
| 5 | Start Topic 1 | Addition | 15 | Next Topic | Multiplication |
| 6 | Next Topic | Subtraction | 16 | Go to Topic 1 | Addition |
| 7 | Pause Session | Paused | 17 | Start Topic 5 | Fractions |
| 8 | Resume Session | Subtraction | 18 | Previous Topic | Division |
| 9 | Switch to Topic 4 | Division | 19 | Repeat Topic 2 | Subtraction |
| 10 | Next Topic | Fractions | 20 | Start Topic 4 | Division |

**Then say these five sentences.** None of them should change anything:

1. "Today we will start topic three."
2. "Topic two is very important."
3. "Let us go to the next topic after lunch."
4. "Please pause and think."
5. "Who can tell me the answer?"

**Record:** press **Copy log** and paste it into a spreadsheet. Count:

| Measure | Target | Result |
| --- | --- | --- |
| Commands that took the student to the right topic | 18 of 20 or more | |
| Commands that took the student to a **wrong** topic | 0 | |
| Ordinary sentences that changed anything | 0 of 5 | |
| Average time to update (shown above the log) | Under 2 s | |

If commands are missed, the log shows whether the engine misheard the words (the "Heard" column is wrong) or heard them correctly but did not act (the "Result" column explains why). If ordinary speech triggers changes, tick "Only respond after the word Classroom" and repeat the test.

## Still to test with real hardware

| Check | Why it matters | How |
| --- | --- | --- |
| Voice accuracy | The main remaining risk | The protocol above |
| A real Android phone and tablet on classroom Wi-Fi | Emulation does not cover real browsers, firewalls or Wi-Fi drop-outs | Open the student link on each device; follow steps 5 and 6 in [TESTING.md](TESTING.md#manual-verification-still-needed) |
| Ashray Akruti's videos on the classroom connection | They are imported and play in the page (checked on an emulated Pixel 7: the YouTube player loaded with no blocked content, see `evaluation/screenshots/student-phone-real-video.png`), but they stream from YouTube, so playback depends on the school's internet, not only its Wi-Fi | Play a few lessons on a student phone over the classroom connection |
| A screen going to sleep on the student's phone | Reconnection is tested, but not on a real phone waking from sleep | Let the phone lock during a session, change topic, unlock |

## Reproducing

```bash
npm run evaluate
```

Takes about 3 minutes and needs Google Chrome. The numbers vary from machine to machine; the pattern should not.
