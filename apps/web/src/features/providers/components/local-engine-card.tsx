'use client';

import { useState } from 'react';
import { type LocalEngineStatus, modelNameSchema } from '@aiteam/contracts';
import { controlStyles, StatusNotice, ToggleSwitch } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { startLocalEngineTestRun, updateLocalEngineSettings } from '../providers-api';
import { useEngineTestRun } from '../use-engine-test-run';
import { EngineTestRunLog } from './engine-test-run-log';
import styles from './settings.module.css';

const ENGINE_PRESENTATION = {
  claude_code: {
    name: 'Claude Code',
    mark: 'CC',
    via: 'claude -p · tài khoản Claude đã đăng nhập',
    modelSuggestions: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    modelPlaceholder: 'Mặc định của Claude Code',
    dangerNote: 'Chặn rm -rf, git push, git reset --hard, npm publish khi chạy tự động',
    background: '#1C3256',
    foreground: '#B9D3FF',
  },
  codex: {
    name: 'Codex',
    mark: 'CX',
    via: 'codex exec · tài khoản ChatGPT đã đăng nhập',
    modelSuggestions: [] as string[],
    modelPlaceholder: 'Mặc định của Codex',
    dangerNote: 'Codex chạy lệnh trong sandbox: chỉ ghi trong thư mục của task',
    background: '#113329',
    foreground: '#86E8C4',
  },
} as const;

export function LocalEngineCard({ engine }: { engine: LocalEngineStatus }) {
  const presentation = ENGINE_PRESENTATION[engine.engine];
  const [modelDraft, setModelDraft] = useState(engine.settings.defaultModel ?? '');
  const [modelError, setModelError] = useState<string | null>(null);
  const { outcome, isPending, performAction } = useActionOutcome();
  const testRun = useEngineTestRun();
  const ready = engine.installed && engine.signedIn !== false;

  const saveDefaultModel = () => {
    const trimmed = modelDraft.trim();
    const parsed = trimmed === '' ? null : modelNameSchema.safeParse(trimmed);
    if (parsed !== null && !parsed.success) {
      setModelError(parsed.error.issues[0]?.message ?? 'Tên model không hợp lệ');
      return;
    }
    setModelError(null);
    void performAction(
      () =>
        updateLocalEngineSettings(engine.engine, {
          defaultModel: parsed === null ? null : parsed.data,
        }),
      () => 'Đã lưu model mặc định.',
    );
  };

  return (
    <article className={styles.engineCard} aria-label={presentation.name}>
      <div className={styles.engineHeader}>
        <span className={styles.engineIdentity}>
          <span
            className={styles.engineMark}
            style={{ background: presentation.background, color: presentation.foreground }}
          >
            {presentation.mark}
          </span>
          <span className={styles.engineTitle}>
            <span className={styles.engineName}>{presentation.name}</span>
            <span className={styles.engineVia}>{presentation.via}</span>
          </span>
        </span>
        <span className={ready ? styles.statusReady : styles.statusProblem}>
          {!engine.installed
            ? 'Chưa cài'
            : engine.signedIn === false
              ? 'Chưa đăng nhập'
              : 'Sẵn sàng'}
        </span>
      </div>

      <dl className={styles.engineFacts}>
        <div>
          <dt>Phiên bản</dt>
          <dd>{engine.version ?? '—'}</dd>
        </div>
        <div>
          <dt>Tài khoản</dt>
          <dd>{engine.accountDetail ?? '—'}</dd>
        </div>
      </dl>
      {engine.problem !== null && <p className={styles.engineProblem}>{engine.problem}</p>}

      <label className={controlStyles.field}>
        Model mặc định
        <span className={styles.inlineInput}>
          <input
            type="text"
            value={modelDraft}
            list={`${engine.engine}-models`}
            onChange={(event) => setModelDraft(event.target.value)}
            placeholder={presentation.modelPlaceholder}
            className={`${controlStyles.fieldInput} ${styles.monoInput}`}
            aria-invalid={modelError !== null}
          />
          <button
            type="button"
            className={controlStyles.secondaryButton}
            onClick={saveDefaultModel}
            disabled={isPending}
          >
            Lưu
          </button>
        </span>
        <datalist id={`${engine.engine}-models`}>
          {presentation.modelSuggestions.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </label>
      {modelError !== null && (
        <span role="alert" className={controlStyles.fieldError}>
          {modelError}
        </span>
      )}

      <ToggleSwitch
        pressed={engine.settings.blockDangerousCommands}
        accessibleLabel={presentation.dangerNote}
        visibleLabel={presentation.dangerNote}
        onToggle={() =>
          void performAction(
            () =>
              updateLocalEngineSettings(engine.engine, {
                blockDangerousCommands: !engine.settings.blockDangerousCommands,
              }),
            () => null,
          )
        }
        disabled={isPending || engine.engine === 'codex'}
      />
      <ToggleSwitch
        pressed={engine.settings.allowNetwork}
        accessibleLabel="Cho phép truy cập mạng (giới hạn trên cho mọi agent dùng engine này)"
        visibleLabel="Cho phép truy cập mạng (giới hạn trên cho mọi agent)"
        onToggle={() =>
          void performAction(
            () =>
              updateLocalEngineSettings(engine.engine, {
                allowNetwork: !engine.settings.allowNetwork,
              }),
            () => null,
          )
        }
        disabled={isPending}
      />

      <span className={styles.engineVia}>
        Agent đang dùng: {engine.agentNames.length === 0 ? 'chưa có' : engine.agentNames.join(', ')}
      </span>
      <StatusNotice outcome={outcome} />

      <div className={controlStyles.buttonRow}>
        <button
          type="button"
          className={controlStyles.primaryButton}
          onClick={() => void testRun.startTestRun(() => startLocalEngineTestRun(engine.engine))}
          disabled={
            !engine.installed || testRun.phase === 'starting' || testRun.phase === 'running'
          }
        >
          {testRun.phase === 'running' ? 'Đang chạy thử…' : 'Chạy thử trên máy'}
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
      <p className={styles.fieldHint}>
        Chạy thử: đọc README.md của một thư mục tạm và tóm tắt trong một câu. Chỉ đọc, không mạng.
      </p>
      {testRun.startError !== null && (
        <StatusNotice outcome={{ tone: 'error', error: testRun.startError }} />
      )}
      <EngineTestRunLog events={testRun.events} />
    </article>
  );
}
