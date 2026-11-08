import { Suspense } from 'react';
import { SkillsScreen } from '../../features/skills/components/skills-screen';

export default function SkillsPage() {
  // useSearchParams needs a Suspense boundary in a static export.
  return (
    <Suspense fallback={null}>
      <SkillsScreen />
    </Suspense>
  );
}
