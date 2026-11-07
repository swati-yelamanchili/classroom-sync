import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { TeacherShell } from '@/components/TeacherShell';
import { Button } from '@/components/ui/button';
import { Join } from '@/pages/Join';
import { Landing } from '@/pages/Landing';
import { LessonReview } from '@/pages/LessonReview';
import { LiveSession } from '@/pages/LiveSession';
import { NewLesson } from '@/pages/NewLesson';
import { ResourceImport } from '@/pages/ResourceImport';
import { ResourceLibrary } from '@/pages/ResourceLibrary';
import { StudentLesson } from '@/pages/StudentLesson';
import { TeacherHome } from '@/pages/TeacherHome';
import { TeacherLogin } from '@/pages/TeacherLogin';

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
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/join" element={<Join />} />
        <Route path="/student/:code" element={<StudentLesson />} />
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
    </BrowserRouter>
  );
}
