'use client';

import { PARALLEL_AGENT_LIMITS } from '@aiteam/contracts';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { StrokeIcon } from '../../../shared/ui/stroke-icon';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { loadWorkspaceSettings, pickLocalDirectory, updateWorkspaceSettings } from '../tasks-api';
import styles from './tasks.module.css';

const FOLDER_ICON = 'M3 6h6l2 2h10v11H3z';
const REMOVE_ICON = 'M6 6l12 12M18 6L6 18';
const PARALLEL_CHOICES = Array.from(
  { length: PARALLEL_AGENT_LIMITS.max - PARALLEL_AGENT_LIMITS.min + 1 },
  (_unused, offset) => PARALLEL_AGENT_LIMITS.min + offset,
);

/** Settings: folders tasks may work in, and how many agents run at the same time. */
export function WorkspaceSettingsSection({ sectionClassName }: { sectionClassName: string }) {
  const settings = useApiQuery('workspace-settings', loadWorkspaceSettings);
  const { outcome, isPending, performAction } = useActionOutcome();

  return (
    <section aria-labelledby="workspace-heading" className={sectionClassName}>
      <div>
        <h2 id="workspace-heading" className={controlStyles.panelTitle}>
          Thư mục làm việc và số agent chạy song song
        </h2>
        <p className={styles.hint}>
          Task chỉ được làm trong các thư mục bạn chọn từ máy (và thư mục con của chúng). Thêm thư
          mục bằng hộp chọn thư mục của hệ điều hành; gõ tay không thêm được.
        </p>
      </div>
      {settings.status === 'loading' && <p className={styles.hint}>Đang tải…</p>}
      {settings.status === 'error' && (
        <StatusNotice outcome={{ tone: 'error', error: settings.error }} />
      )}
      {settings.status === 'success' && (
        <>
          {settings.result.allowedDirectories.length === 0 ? (
            <p className={styles.hint}>Chưa có thư mục nào được cho phép.</p>
          ) : (
            settings.result.allowedDirectories.map((directoryPath) => (
              <div key={directoryPath} className={styles.fileRow}>
                <span className={`${styles.fileText} ${styles.monoValue}`}>{directoryPath}</span>
                <button
                  type="button"
                  className={styles.iconAction}
                  aria-label={`Bỏ cho phép ${directoryPath}`}
                  disabled={isPending}
                  onClick={() =>
                    void performAction(
                      () =>
                        updateWorkspaceSettings({
                          allowedDirectories: settings.result.allowedDirectories.filter(
                            (other) => other !== directoryPath,
                          ),
                        }),
                      () => 'Đã bỏ thư mục khỏi danh sách cho phép.',
                    )
                  }
                >
                  <StrokeIcon path={REMOVE_ICON} size={14} strokeWidth={2.2} />
                </button>
              </div>
            ))
          )}
          <div className={controlStyles.buttonRow}>
            <button
              type="button"
              className={controlStyles.secondaryButton}
              disabled={isPending}
              onClick={() =>
                void performAction(pickLocalDirectory, (pick) =>
                  pick.path === null ? null : `Đã cho phép ${pick.path}.`,
                )
              }
            >
              <StrokeIcon path={FOLDER_ICON} size={16} /> Thêm thư mục
            </button>
          </div>
          <label className={`${controlStyles.field} ${styles.narrowField}`}>
            Số agent chạy cùng lúc
            <select
              value={settings.result.maxParallelAgents}
              disabled={isPending}
              onChange={(event) => {
                const maxParallelAgents = Number(event.target.value);
                void performAction(
                  () => updateWorkspaceSettings({ maxParallelAgents }),
                  () => `Tối đa ${maxParallelAgents} agent chạy cùng lúc.`,
                );
              }}
              className={controlStyles.fieldInput}
            >
              {PARALLEL_CHOICES.map((count) => (
                <option key={count} value={count}>
                  {count} agent
                </option>
              ))}
            </select>
          </label>
          <p className={styles.hint}>
            Nhiều agent cùng lúc dùng nhanh hết hạn mức gói Claude / ChatGPT; mặc định 2.
          </p>
        </>
      )}
      <StatusNotice outcome={outcome} />
    </section>
  );
}
