import type { CompletionGoal } from '@aiteam/contracts';
import styles from './tasks.module.css';

const GOAL_STYLE: Record<CompletionGoal['source'], string> = {
  qa: styles.goalQa ?? '',
  description: styles.goalDescription ?? '',
  none: styles.goalNone ?? '',
};

/** "Đích hoàn thành": what the agent works towards and QC checks against. */
export function CompletionGoalBox({
  goal,
  showItems,
}: {
  goal: CompletionGoal;
  showItems: boolean;
}) {
  return (
    <div role="status" className={`${styles.goalBox} ${GOAL_STYLE[goal.source]}`}>
      <span className={styles.goalTitle}>{goal.title}</span>
      {showItems && goal.items.length > 0 && (
        <ul className={styles.goalItems}>
          {goal.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      <span className={styles.goalNote}>{goal.note}</span>
    </div>
  );
}
