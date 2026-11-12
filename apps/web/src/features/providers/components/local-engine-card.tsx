'use client';

import { useState } from 'react';
import { type LocalEngineStatus, modelNameSchema } from '@aiteam/contracts';
import { controlStyles, StatusNotice, ToggleSwitch } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { startLocalEngineTestRun, updateLocalEngineSettings } from '../providers-api';
import { LOCAL_ENGINE_MARKS } from '../../organization/organization-labels';
import { useEngineTestRun } from '../use-engine-test-run';
import { useLocalEngineModels } from '../use-local-engine-models';
import { EngineTestRunLog } from './engine-test-run-log';
import { ModelListNotes } from './model-list-notes';
import styles from './settings.module.css';

const ENGINE_PRESENTATION = {
  claude_code: {
    name: 'Claude Code',
    mark: LOCAL_ENGINE_MARKS.claude_code,
    via: 'claude -p · tài khoản Claude đã đăng nhập',
    modelPlaceholder: 'Mặc định của Claude Code',
    commandSafety: {
      kind: 'toggle',
      label: 'Chặn rm -rf, git push, git reset --hard, npm publish khi chạy tự động',
      /** The rules match how a command starts; another spelling gets through. */
      hint: 'Lọc theo đầu lệnh, không chặn được mọi cách viết khác. Agent được sửa chạy Bash/PowerShell với quyền của bạn (đọc được cả ~/.aiteam): chỉ cấp quyền sửa cho việc bạn tin.',
    },
    background: '#1C3256',
    foreground: '#B9D3FF',
  },
  codex: {
    name: 'Codex',
    mark: LOCAL_ENGINE_MARKS.codex,
    via: 'codex exec · tài khoản ChatGPT đã đăng nhập',
    modelPlaceholder: 'Mặc định của Codex',
    commandSafety: {
      kind: 'note',
      label:
        'Lệnh nguy hiểm do sandbox của Codex giới hạn: agent chỉ đọc chạy read-only; agent được sửa chỉ ghi trong thư mục của task, mạng theo công tắc bên dưới. Codex không lọc từng lệnh.',
    },
    background: '#113329',
    foreground: '#86E8C4',
  },
  antigravity: {
    name: 'Antigravity',
    mark: LOCAL_ENGINE_MARKS.antigravity,
    via: 'agy · tài khoản Antigravity đã đăng nhập',
    modelPlaceholder: 'Mặc định của Antigravity',
    commandSafety: {
      kind: 'toggle',
      label: 'Chặn rm -rf, git push, git reset --hard, npm publish khi chạy tự động',
      hint: 'Lọc theo đầu lệnh, không chặn được mọi cách viết khác. Antigravity vẫn nạp hook và MCP cá nhân của bạn trong ~/.gemini/config. Agent được sửa chạy lệnh với quyền của bạn: chỉ cấp quyền sửa cho việc bạn tin.',
    },
    background: '#2A1F4D',
    foreground: '#CDBBFF',
  },
} as const;

export function LocalEngineCard({ engine }: { engine: LocalEngineStatus }) {
  const presentation = ENGINE_PRESENTATION[engine.engine];
  const [modelDraft, setModelDraft] = useState(engine.settings.defaultModel ?? '');
  const [modelError, setModelError] = useState<string | null>(null);
  const { outcome, isPending, performAction } = useActionOutcome();
  const testRun = useEngineTestRun();
  const models = useLocalEngineModels(engine.engine);
  const modelChoices = models.choices;
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
          {modelChoices.map(({ model, label }) => (
            <option key={model} value={model} label={label} />
          ))}
        </datalist>
      </label>
      {modelError !== null && (
        <span role="alert" className={controlStyles.fieldError}>
          {modelError}
        </span>
      )}
      <ModelListNotes engine={engine.engine} models={models} />

      {presentation.commandSafety.kind === 'toggle' ? (
        <>
          <ToggleSwitch
            pressed={engine.settings.blockDangerousCommands}
            accessibleLabel={presentation.commandSafety.label}
            visibleLabel={presentation.commandSafety.label}
            onToggle={() =>
              void performAction(
                () =>
                  updateLocalEngineSettings(engine.engine, {
                    blockDangerousCommands: !engine.settings.blockDangerousCommands,
                  }),
                () => null,
              )
            }
            disabled={isPending}
          />
          <p className={styles.fieldHint}>{presentation.commandSafety.hint}</p>
        </>
      ) : (
        <p className={styles.fieldHint}>{presentation.commandSafety.label}</p>
      )}
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
