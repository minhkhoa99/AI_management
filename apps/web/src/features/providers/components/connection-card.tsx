'use client';

import { useState } from 'react';
import type { ProviderConnection } from '@aiteam/contracts';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import {
  checkProviderConnection,
  deleteProviderConnection,
  startConnectionTestRun,
} from '../providers-api';
import { useEngineTestRun } from '../use-engine-test-run';
import { EngineTestRunLog } from './engine-test-run-log';
import styles from './settings.module.css';

interface ConnectionCardProps {
  connection: ProviderConnection;
  onEdit: () => void;
}

export function ConnectionCard({ connection, onEdit }: ConnectionCardProps) {
  const [testModel, setTestModel] = useState(connection.defaultModel ?? connection.models[0] ?? '');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const { outcome, isPending, performAction } = useActionOutcome();
  const testRun = useEngineTestRun();

  return (
    <article className={styles.connectionCard} aria-label={connection.name}>
      <div className={styles.engineHeader}>
        <span className={styles.engineTitle}>
          <span className={styles.engineName}>{connection.name}</span>
          <span className={`${styles.engineVia} ${styles.monoText}`}>{connection.baseUrl}</span>
        </span>
        <span className={styles.formatBadge}>
          {connection.format === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'}
        </span>
      </div>
      <dl className={styles.engineFacts}>
        <div>
          <dt>Khoá</dt>
          <dd className={styles.monoText}>
            {connection.keyHint === null ? 'không có / ẩn' : `…${connection.keyHint}`}
          </dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>
            {connection.models.length} · mặc định{' '}
            <span className={styles.monoText}>{connection.defaultModel ?? '—'}</span>
          </dd>
        </div>
        <div>
          <dt>Agent dùng</dt>
          <dd>
            {connection.agentNames.length === 0 ? 'chưa có' : connection.agentNames.join(', ')}
          </dd>
        </div>
      </dl>

      <div className={controlStyles.buttonRow}>
        <button type="button" className={controlStyles.secondaryButton} onClick={onEdit}>
          Sửa
        </button>
        <button
          type="button"
          className={controlStyles.secondaryButton}
          disabled={isPending}
          onClick={() =>
            void performAction(
              () => checkProviderConnection(connection.id),
              (result) =>
                `${result.reachable ? '✓' : '✗'} ${result.message} (${result.latencyMs} ms)`,
            )
          }
        >
          Kiểm tra kết nối
        </button>
        <button
          type="button"
          className={controlStyles.secondaryButton}
          onClick={() => setIsConfirmingDelete(true)}
        >
          Xoá…
        </button>
      </div>
      <StatusNotice outcome={outcome} />

      {connection.models.length > 0 && (
        <div className={styles.inlineInput}>
          <select
            aria-label={`Model chạy thử cho ${connection.name}`}
            value={testModel}
            onChange={(event) => setTestModel(event.target.value)}
            className={`${controlStyles.fieldInput} ${styles.monoInput}`}
          >
            {connection.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={controlStyles.primaryButton}
            disabled={testRun.phase === 'starting' || testRun.phase === 'running'}
            onClick={() =>
              void testRun.startTestRun(() => startConnectionTestRun(connection.id, testModel))
            }
          >
            {testRun.phase === 'running' ? 'Đang chạy…' : 'Chạy thử'}
          </button>
          {testRun.phase === 'running' && (
            <button
              type="button"
              className={controlStyles.secondaryButton}
              onClick={() => void testRun.cancelTestRun()}
            >
              Huỷ
            </button>
          )}
        </div>
      )}
      {testRun.startError !== null && (
        <StatusNotice outcome={{ tone: 'error', error: testRun.startError }} />
      )}
      <EngineTestRunLog events={testRun.events} />

      {isConfirmingDelete && (
        <div
          className={styles.confirmBox}
          role="group"
          aria-label={`Xác nhận xoá ${connection.name}`}
        >
          <span>Xoá kết nối {connection.name}? Khoá đã lưu cũng bị xoá.</span>
          <div className={controlStyles.buttonRow}>
            <button
              type="button"
              className={controlStyles.dangerButton}
              disabled={isPending}
              onClick={() =>
                void performAction(
                  () => deleteProviderConnection(connection.id).then(() => true),
                  () => null,
                )
              }
            >
              Xoá kết nối
            </button>
            <button
              type="button"
              className={controlStyles.secondaryButton}
              onClick={() => setIsConfirmingDelete(false)}
            >
              Giữ lại
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
