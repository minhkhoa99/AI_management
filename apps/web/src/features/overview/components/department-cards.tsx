import Link from 'next/link';
import type { DepartmentSummary } from '@aiteam/contracts';
import { AgentAvatar } from '../../organization/components/agent-identity';
import { buildOrgHref, TEAM_MODE_PRESENTATION } from '../../organization/organization-labels';
import styles from './overview.module.css';

export function DepartmentCards({ summaries }: { summaries: DepartmentSummary[] }) {
  return (
    <section aria-label="Thẻ phòng ban" className={styles.cardGrid}>
      {summaries.map((summary) => (
        <article key={summary.id} className={styles.departmentCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitleBlock}>
              <h3 className={styles.cardTitle}>
                <span
                  aria-hidden="true"
                  className={styles.cardColor}
                  style={{ background: summary.color }}
                />
                {summary.name}
              </h3>
              <span className={styles.cardMeta}>
                Trưởng phòng: {summary.headAgentName ?? 'chưa có'} ·{' '}
                {TEAM_MODE_PRESENTATION[summary.teamMode].label}
              </span>
            </div>
            <span className={summary.enabled ? styles.cardStateOn : styles.cardStateOff}>
              {summary.enabled ? 'Đang bật' : 'Đang tắt'}
            </span>
          </div>
          <div className={styles.cardStats}>
            <div className={styles.cardStat}>
              <span className={styles.cardStatLabel}>Agent</span>
              <span className={styles.cardStatValue}>{summary.agentCount}</span>
            </div>
          </div>
          <div className={styles.cardFooter}>
            <span className={styles.faces}>
              {summary.memberPreview.map((member) => (
                <span key={member.agentId} title={member.name} className={styles.face}>
                  <AgentAvatar
                    name={member.name}
                    provider={member.provider}
                    available={member.enabled && summary.enabled}
                    size={28}
                  />
                </span>
              ))}
            </span>
            <Link href={buildOrgHref(summary.id)} className={styles.openChartLink}>
              Mở sơ đồ
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}
