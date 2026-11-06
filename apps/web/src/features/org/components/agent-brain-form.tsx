'use client';

import { type FormEvent, useState } from 'react';
import {
  type AccessLevel,
  AGENT_PROVIDERS,
  type AgentDetail,
  type AgentProvider,
  changeAgentConfigurationRequestSchema,
} from '@aiteam/contracts';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { PROVIDER_PRESENTATION } from '../../organization/organization-labels';
import { changeAgentConfiguration, loadProviderConnections } from '../../providers/providers-api';
import styles from './org-screen.module.css';

/** Brain (provider, connection, model) and permissions of one agent. */
export function AgentBrainForm({ agent }: { agent: AgentDetail }) {
  const connections = useApiQuery('provider-connections', loadProviderConnections);
  const connectionList = connections.status === 'success' ? connections.result : [];
  const [provider, setProvider] = useState<AgentProvider>(agent.provider);
  const [connectionId, setConnectionId] = useState<string>(agent.connectionId ?? '');
  const [model, setModel] = useState(agent.model ?? '');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>(agent.accessLevel);
  const [networkAccess, setNetworkAccess] = useState(agent.networkAccess);
  const [formError, setFormError] = useState<string | null>(null);
  const { outcome, isPending, performAction } = useActionOutcome();

  const selectedConnection = connectionList.find((connection) => connection.id === connectionId);
  const usesCustomApi = provider === 'custom_api';

  const pickProvider = (nextProvider: AgentProvider) => {
    setProvider(nextProvider);
    setModel('');
    if (nextProvider === 'custom_api') {
      const firstConnection = connectionList[0];
      setConnectionId(firstConnection?.id ?? '');
      setModel(firstConnection?.defaultModel ?? firstConnection?.models[0] ?? '');
    } else {
      setConnectionId('');
    }
  };

  const pickConnection = (nextConnectionId: string) => {
    setConnectionId(nextConnectionId);
    const nextConnection = connectionList.find((connection) => connection.id === nextConnectionId);
    setModel(nextConnection?.defaultModel ?? nextConnection?.models[0] ?? '');
  };

  const saveBrain = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = changeAgentConfigurationRequestSchema.safeParse({
      provider,
      connectionId: usesCustomApi ? connectionId || null : null,
      model: model.trim() === '' ? null : model.trim(),
      accessLevel,
      networkAccess,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Cấu hình không hợp lệ');
      return;
    }
    setFormError(null);
    await performAction(
      () => changeAgentConfiguration(agent.id, parsed.data),
      () => 'Đã lưu bộ não và quyền.',
    );
  };

  return (
    <form className={styles.brainForm} onSubmit={saveBrain} noValidate aria-label="Bộ não và quyền">
      <span className={styles.brainHeading}>Bộ não</span>
      <div role="radiogroup" aria-label="Chọn bộ não" className={styles.providerChoices}>
        {AGENT_PROVIDERS.map((providerOption) => {
          const presentation = PROVIDER_PRESENTATION[providerOption];
          const unavailable = providerOption === 'custom_api' && connectionList.length === 0;
          return (
            <button
              key={providerOption}
              type="button"
              role="radio"
              aria-checked={provider === providerOption}
              className={styles.providerChoice}
              onClick={() => pickProvider(providerOption)}
              disabled={unavailable}
              title={unavailable ? 'Thêm kết nối ở Cài đặt API trước' : undefined}
            >
              <span className={styles.providerChoiceLabel}>{presentation.label}</span>
              <span className={styles.fieldHint}>
                {unavailable ? 'Chưa có kết nối API' : presentation.note}
              </span>
            </button>
          );
        })}
      </div>

      {usesCustomApi ? (
        <div className={styles.brainGrid}>
          <label className={controlStyles.field}>
            Kết nối
            <select
              value={connectionId}
              onChange={(event) => pickConnection(event.target.value)}
              className={controlStyles.fieldInput}
            >
              {connectionList.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                </option>
              ))}
            </select>
          </label>
          <label className={controlStyles.field}>
            Model
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className={`${controlStyles.fieldInput} ${styles.monoInput}`}
            >
              {(selectedConnection?.models ?? []).map((modelOption) => (
                <option key={modelOption} value={modelOption}>
                  {modelOption}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <label className={controlStyles.field}>
          Model (tuỳ chọn)
          <input
            type="text"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Theo model mặc định của engine (Cài đặt API)"
            className={`${controlStyles.fieldInput} ${styles.monoInput}`}
          />
        </label>
      )}

      <span className={styles.brainHeading}>Quyền</span>
      <label className={controlStyles.field}>
        Trong thư mục làm việc
        <select
          value={accessLevel}
          onChange={(event) => setAccessLevel(event.target.value as AccessLevel)}
          className={controlStyles.fieldInput}
        >
          <option value="read_only">Chỉ đọc</option>
          <option value="edit_workspace">Được sửa file trong thư mục của task</option>
        </select>
      </label>
      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={networkAccess}
          onChange={(event) => setNetworkAccess(event.target.checked)}
        />
        Cho phép truy cập mạng (vẫn bị giới hạn bởi cài đặt của engine)
      </label>
      <p className={styles.fieldHint}>
        Giảm quyền khi agent đang làm task sẽ dừng lượt hiện tại và chạy lại với quyền mới. Đổi bộ
        não hoặc kết nối chỉ áp dụng từ phiên kế tiếp.
      </p>
      {formError !== null && (
        <span role="alert" className={controlStyles.fieldError}>
          {formError}
        </span>
      )}
      <StatusNotice outcome={outcome} />
      <div className={controlStyles.buttonRow}>
        <button type="submit" className={controlStyles.secondaryButton} disabled={isPending}>
          Lưu bộ não và quyền
        </button>
      </div>
    </form>
  );
}
