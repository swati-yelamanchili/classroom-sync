import { ArrowRight, GraduationCap, Presentation } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SkipLink, Wordmark } from '@/components/TeacherShell';
import { usePageTitle } from '@/hooks/useAsync';

const STEPS = [
  ['List your topics', 'Type what you plan to teach. The app finds the matching videos and scripts already in your library.'],
  ['Confirm the order', 'Review the sequence, swap or remove anything, and share a code with your student.'],
  ['Teach as usual', 'Say "Start Topic 3". Your student\'s screen changes to that video and script, with no refreshing.'],
];

export function Landing() {
  usePageTitle('Welcome');
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="mx-auto w-full max-w-5xl px-4 py-5 md:px-6">
        <Wordmark />
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-12 md:px-6 md:pt-14">
        <h1 className="max-w-3xl text-4xl md:text-5xl">Teach as you normally do. Your student's screen keeps up.</h1>
        <p className="mt-5 max-w-2xl text-xl text-ink-soft">
          Classroom Sync puts existing Ashray Akruti sign language videos and scripts in lesson order, and shows the right one on the student's device as you move through the lesson.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Link to="/teacher" className="group flex items-center gap-4 rounded-lg bg-teal p-6 text-white no-underline hover:bg-teal-dark">
            <Presentation className="size-9 shrink-0" aria-hidden />
            <span className="flex-1">
              <span className="block text-2xl font-bold">I'm teaching</span>
              <span className="block">Plan a lesson or open a session</span>
            </span>
            <ArrowRight className="size-6 shrink-0 transition-transform group-hover:translate-x-1" aria-hidden />
          </Link>
          <Link to="/join" className="group flex items-center gap-4 rounded-lg border-2 border-ink bg-surface p-6 text-ink no-underline hover:bg-neutral-tint">
            <GraduationCap className="size-9 shrink-0" aria-hidden />
            <span className="flex-1">
              <span className="block text-2xl font-bold">I'm a student</span>
              <span className="block">Join with a session code</span>
            </span>
            <ArrowRight className="size-6 shrink-0 transition-transform group-hover:translate-x-1" aria-hidden />
          </Link>
        </div>

        <ol className="mt-14 grid gap-8 border-t border-line pt-8 md:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <li key={title}>
              <p className="font-bold text-teal-dark">Step {i + 1}</p>
              <h2 className="mt-1 text-xl">{title}</h2>
              <p className="mt-2 text-ink-soft">{body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-10 max-w-2xl text-ink-soft">
          This platform does not create educational content. It only organises and displays resources that already exist in the library.
        </p>
      </main>
    </div>
  );
}
