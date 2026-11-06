'use client';

import { type FormEvent, useState } from 'react';
import {
  type ApiFormat,
  type ProviderConnection,
  saveProviderConnectionRequestSchema,
} from '@aiteam/contracts';
import { controlStyles, InlinePanel, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { collectFieldErrors } from '../../org/org-tree-navigation';
import {
  createProviderConnection,
  discoverModels,
  updateProviderConnection,
} from '../providers-api';
import styles from './settings.module.css';

const FORMAT_CHOICES: Array<{
  format: ApiFormat;
  label: string;
  note: string;
  urlPlaceholder: string;
}> = [
  {
    format: 'openai',
    label: 'OpenAI-compatible',
    note: 'OpenAI, OpenRouter, vLLM, Ollama…',
    urlPlaceholder: 'https://api.openai.com/v1 hoặc http://localhost:11434/v1',
  },
  {
    format: 'anthropic',
    label: 'Anthropic API',
    note: 'Messages API',
    urlPlaceholder: 'https://api.anthropic.com',
  },
];

interface ConnectionFormPanelProps {
  editedConnection?: ProviderConnection;
  onSaved: () => void;
  onCancel: () => void;
}

export function ConnectionFormPanel({
  editedConnection,
  onSaved,
  onCancel,
}: ConnectionFormPanelProps) {
  const [name, setName] = useState(editedConnection?.name ?? '');
  const [format, setFormat] = useState<ApiFormat>(editedConnection?.format ?? 'openai');
  const [baseUrl, setBaseUrl] = useState(editedConnection?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>(editedConnection?.models ?? []);
  const [selectedModels, setSelectedModels] = useState<ReadonlySet<string>>(
    new Set(editedConnection?.models ?? []),
  );
  const [defaultModel, setDefaultModel] = useState<string | null>(
    editedConnection?.defaultModel ?? null,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const discovery = useActionOutcome();
  const saving = useActionOutcome();
  const formatChoice =
    FORMAT_CHOICES.find((choice) => choice.format === format) ?? FORMAT_CHOICES[0];

  const loadModels = async () => {
    const result = await discovery.performAction(
      () =>
        discoverModels({
          format,
          baseUrl: baseUrl.trim(),
          ...(apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() }),
          ...(editedConnection === undefined ? {} : { connectionId: editedConnection.id }),
        }),
      (found) => `Tìm thấy ${found.models.length} model.`,
    );
    if (result !== undefined) {
      setAvailableModels(result.models);
    }
  };

  const toggleModel = (model: string) => {
    setSelectedModels((previous) => {
      const next = new Set(previous);
      if (!next.delete(model)) {
        next.add(model);
      }
      if (!next.has(defaultModel ?? '')) {
        setDefaultModel([...next][0] ?? null);
      }
      return next;
    });
  };

  const saveConnection = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = saveProviderConnectionRequestSchema.safeParse({
      name,
      format,
      baseUrl,
      ...(apiKey.trim() === '' ? {} : { apiKey }),
      models: [...selectedModels],
      defaultModel,
    });
    if (!parsed.success) {
      setFieldErrors(collectFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    const saved = await saving.performAction(
      () =>
        editedConnection === undefined
          ? createProviderConnection(parsed.data)
          : updateProviderConnection(editedConnection.id, parsed.data),
      () => null,
    );
    if (saved !== undefined) {
      onSaved();
    }
  };

  return (
    <InlinePanel
      title={editedConnection === undefined ? 'Thêm kết nối API' : `Sửa ${editedConnection.name}`}
      emphasised
    >
      <form className={styles.form} onSubmit={(event) => void saveConnection(event)} noValidate>
        <label className={controlStyles.field}>
          Tên kết nối
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={controlStyles.fieldInput}
            placeholder="OpenRouter cá nhân"
          />
        </label>
        {fieldErrors.name !== undefined && (
          <span role="alert" className={controlStyles.fieldError}>
            {fieldErrors.name}
          </span>
        )}

        <div role="radiogroup" aria-label="Định dạng API" className={styles.formatChoices}>
          {FORMAT_CHOICES.map((choice) => (
            <button
              key={choice.format}
              type="button"
              role="radio"
              aria-checked={format === choice.format}
              className={styles.formatChoice}
              onClick={() => setFormat(choice.format)}
            >
              <span className={styles.formatLabel}>{choice.label}</span>
              <span className={styles.engineVia}>{choice.note}</span>
            </button>
          ))}
        </div>

        <label className={controlStyles.field}>
          Base URL
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            className={`${controlStyles.fieldInput} ${styles.monoInput}`}
            placeholder={formatChoice?.urlPlaceholder}
          />
        </label>
        {fieldErrors.baseUrl !== undefined && (
          <span role="alert" className={controlStyles.fieldError}>
            {fieldErrors.baseUrl}
          </span>
        )}

        <label className={controlStyles.field}>
          API key
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            onChange={(event) => setApiKey(event.target.value)}
            className={`${controlStyles.fieldInput} ${styles.monoInput}`}
            placeholder={
              (editedConnection?.keyHint ?? null) !== null
                ? `Để trống để giữ khoá hiện tại (…${editedConnection?.keyHint ?? ''})`
                : 'Bỏ trống nếu máy chủ không cần khoá (Ollama…)'
            }
          />
        </label>
        <p className={styles.fieldHint}>
          Khoá được mã hoá AES-256-GCM trên máy này; giao diện không bao giờ nhận lại khoá.
        </p>

        <div className={controlStyles.buttonRow}>
          <button
            type="button"
            className={controlStyles.secondaryButton}
            onClick={() => void loadModels()}
            disabled={discovery.isPending || baseUrl.trim() === ''}
          >
            {discovery.isPending ? 'Đang tải…' : 'Tải danh sách model'}
          </button>
        </div>
        <StatusNotice outcome={discovery.outcome} />

        {availableModels.length > 0 && (
          <fieldset className={styles.modelPicker}>
            <legend className={styles.colorLegend}>
              Model cho agent dùng ({selectedModels.size} đã chọn)
            </legend>
            <div className={styles.modelList}>
              {availableModels.map((model) => (
                <label key={model} className={styles.modelOption}>
                  <input
                    type="checkbox"
                    checked={selectedModels.has(model)}
                    onChange={() => toggleModel(model)}
                  />
                  <span className={styles.monoText}>{model}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {selectedModels.size > 0 && (
          <label className={controlStyles.field}>
            Model mặc định
            <select
              value={defaultModel ?? ''}
              onChange={(event) => setDefaultModel(event.target.value || null)}
              className={controlStyles.fieldInput}
            >
              {[...selectedModels].map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
        )}

        <ApiCallPreview
          format={format}
          baseUrl={baseUrl}
          model={defaultModel}
          hasKey={apiKey.trim() !== '' || (editedConnection?.keyHint ?? null) !== null}
        />

        <StatusNotice outcome={saving.outcome} />
        <div className={controlStyles.buttonRow}>
          <button type="submit" className={controlStyles.primaryButton} disabled={saving.isPending}>
            {editedConnection === undefined ? 'Lưu kết nối' : 'Lưu thay đổi'}
          </button>
          <button type="button" className={controlStyles.secondaryButton} onClick={onCancel}>
            Huỷ
          </button>
        </div>
      </form>
    </InlinePanel>
  );
}

/** "Cách nền tảng gọi API": built from the form, with the key masked. */
function ApiCallPreview({
  format,
  baseUrl,
  model,
  hasKey,
}: {
  format: ApiFormat;
  baseUrl: string;
  model: string | null;
  hasKey: boolean;
}) {
  const trimmedUrl = baseUrl.trim().replace(/\/+$/, '') || '<base-url>';
  const modelName = model ?? '<model>';
  const preview =
    format === 'anthropic'
      ? [
          `POST ${trimmedUrl.replace(/\/v1$/, '')}/v1/messages`,
          ...(hasKey ? ['x-api-key: ••••••••'] : []),
          'anthropic-version: 2026-10-21',
          `{ "model": "${modelName}", "max_tokens": 16000, "stream": true,`,
          '  "messages": [{ "role": "user", "content": "<yêu cầu của task>" }] }',
        ]
      : [
          `POST ${trimmedUrl}/chat/completions`,
          ...(hasKey ? ['Authorization: Bearer ••••••••'] : []),
          `{ "model": "${modelName}", "stream": true,`,
          '  "messages": [{ "role": "user", "content": "<yêu cầu của task>" }] }',
        ];
  return (
    <section aria-label="Cách nền tảng gọi API" className={styles.callPreview}>
      <span className={styles.colorLegend}>Cách nền tảng gọi API</span>
      <pre className={styles.codeBlock}>{preview.join('\n')}</pre>
    </section>
  );
}
