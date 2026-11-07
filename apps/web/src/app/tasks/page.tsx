import { Suspense } from 'react';
import { TasksScreen } from '../../features/tasks/components/tasks-screen';

export default function TasksPage() {
  // useSearchParams needs a Suspense boundary in a static export.
  return (
    <Suspense fallback={null}>
      <TasksScreen />
    </Suspense>
  );
}
