import { Suspense } from 'react';
import { WorkflowsScreen } from '../../features/workflows/components/workflows-screen';

export default function WorkflowsPage() {
  // useSearchParams needs a Suspense boundary in a static export.
  return (
    <Suspense fallback={null}>
      <WorkflowsScreen />
    </Suspense>
  );
}
