import { Suspense } from 'react';
import { MonitorScreen } from '../../features/monitor/components/monitor-screen';

export default function MonitorPage() {
  // useSearchParams needs a Suspense boundary in a static export.
  return (
    <Suspense fallback={null}>
      <MonitorScreen />
    </Suspense>
  );
}
