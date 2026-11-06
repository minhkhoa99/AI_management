import { Suspense } from 'react';
import { OrgScreen } from '../../features/org/components/org-screen';

export default function OrgChartPage() {
  // useSearchParams needs a Suspense boundary in a static export.
  return (
    <Suspense fallback={null}>
      <OrgScreen />
    </Suspense>
  );
}
