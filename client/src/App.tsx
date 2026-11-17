import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { Loading } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Join } from '@/pages/Join';
import { Landing } from '@/pages/Landing';
import { StudentLesson } from '@/pages/StudentLesson';

// Teacher pages load on demand, so a student's phone on a slow connection downloads only what it uses.
const TeacherShell = lazy(() => import('@/components/TeacherShell').then((m) => ({ default: m.TeacherShell })));
const TeacherLogin = lazy(() => import('@/pages/TeacherLogin').then((m) => ({ default: m.TeacherLogin })));
const TeacherHome = lazy(() => import('@/pages/TeacherHome').then((m) => ({ default: m.TeacherHome })));
const NewLesson = lazy(() => import('@/pages/NewLesson').then((m) => ({ default: m.NewLesson })));
const LessonReview = lazy(() => import('@/pages/LessonReview').then((m) => ({ default: m.LessonReview })));
const LiveSession = lazy(() => import('@/pages/LiveSession').then((m) => ({ default: m.LiveSession })));
const ResourceLibrary = lazy(() => import('@/pages/ResourceLibrary').then((m) => ({ default: m.ResourceLibrary })));
const ResourceImport = lazy(() => import('@/pages/ResourceImport').then((m) => ({ default: m.ResourceImport })));
const StudentLessonList = lazy(() => import('@/pages/StudentBrowse').then((m) => ({ default: m.StudentLessonList })));
const StudentSelfPaced = lazy(() => import('@/pages/StudentBrowse').then((m) => ({ default: m.StudentSelfPaced })));

function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-3xl">Page not found</h1>
      <p className="mt-2 text-ink-soft">That address doesn't exist.</p>
      <Button asChild className="mt-6"><Link to="/">Go to the home page</Link></Button>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading label="Loading…" />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/join" element={<Join />} />
          <Route path="/student/:code" element={<StudentLesson />} />
          <Route path="/lessons" element={<StudentLessonList />} />
          <Route path="/lessons/:id" element={<StudentSelfPaced />} />
          <Route path="/teacher/login" element={<TeacherLogin />} />
          <Route path="/teacher" element={<TeacherShell />}>
            <Route index element={<TeacherHome />} />
            <Route path="lessons/new" element={<NewLesson />} />
            <Route path="lessons/:id" element={<LessonReview />} />
            <Route path="sessions/:id" element={<LiveSession />} />
            <Route path="resources" element={<ResourceLibrary />} />
            <Route path="resources/import" element={<ResourceImport />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
