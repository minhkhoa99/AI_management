'use client';

import type { LocalEngine } from '@aiteam/contracts';
import { PROVIDER_PRESENTATION } from '../../organization/organization-labels';
import type { LocalEngineModels } from '../use-local-engine-models';
import styles from './settings.module.css';

/** Where the model list comes from, why it may be short, and the ↻ that re-reads it. */
export function ModelListNotes({
  engine,
  models,
}: {
  engine: LocalEngine;
  models: LocalEngineModels;
}) {
  const engineName = PROVIDER_PRESENTATION[engine].label;
  const { cliUpdate, problem, loading, refreshModels } = models;
  return (
    <>
      <span className={styles.modelListSource}>
        <span className={styles.fieldHint}>
          {loading
            ? `Đang đọc danh sách model từ ${engineName}…`
            : `Danh sách lấy từ ${engineName} trên máy.`}
        </span>
        <button
          type="button"
          className={styles.modelListRefresh}
          aria-label={`Đọc lại danh sách model của ${engineName}`}
          title="Đọc lại danh sách model"
          disabled={loading}
          onClick={refreshModels}
        >
          ↻
        </button>
      </span>
      {problem !== null && <span className={styles.fieldHint}>{problem}</span>}
      {cliUpdate !== null && (
        <span className={styles.cliUpdateHint}>
          Có {engineName} {cliUpdate.latestVersion} (máy đang {cliUpdate.installedVersion}). Model
          mới có thể cần bản mới: chạy <code>{cliUpdate.updateCommand}</code> trong terminal.
        </span>
      )}
    </>
  );
}
