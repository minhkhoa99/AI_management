import styles from './empty-state.module.css';

interface EmptyStateProps {
  heading: string;
  description: string;
  /** Roadmap phase (docs/IMPLEMENTATION_PLAN.md section 7) that delivers this screen. */
  deliveredInPhase: number;
}

export function EmptyState({ heading, description, deliveredInPhase }: EmptyStateProps) {
  return (
    <section className={styles.emptyState} aria-labelledby="empty-state-heading">
      <h2 id="empty-state-heading" className={styles.heading}>
        {heading}
      </h2>
      <p className={styles.description}>{description}</p>
      <span className={styles.phaseBadge}>Có ở Giai đoạn {deliveredInPhase}</span>
    </section>
  );
}
