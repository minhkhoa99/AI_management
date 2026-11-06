'use client';

import { useState } from 'react';
import type { ProviderConnection } from '@aiteam/contracts';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { StrokeIcon } from '../../../shared/ui/stroke-icon';
import { loadLocalEngines, loadProviderConnections } from '../providers-api';
import { ConnectionCard } from './connection-card';
import { ConnectionFormPanel } from './connection-form-panel';
import { LocalEngineCard } from './local-engine-card';
import styles from './settings.module.css';

const INSTALL_GUIDE = `# 1. Claude Code: cài CLI, rồi đăng nhập bằng tài khoản Claude
#    (cùng tài khoản với Claude Desktop)
claude            # gõ /login trong cửa sổ này

# 2. Codex: nếu đã đăng nhập trong Codex app thì bỏ qua, không thì
npm install -g @openai/codex
codex login

# 3. Kiểm tra cả hai
aiteam doctor`;

type ConnectionPanel =
  { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; connection: ProviderConnection };

/** /settings: local engines (Claude Code, Codex) and Custom API connections. */
export function SettingsScreen() {
  const engines = useApiQuery('local-engines', loadLocalEngines);
  const connections = useApiQuery('provider-connections', loadProviderConnections);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [connectionPanel, setConnectionPanel] = useState<ConnectionPanel>({ mode: 'closed' });

  return (
    <div className={styles.screen}>
      <section aria-labelledby="local-engines-heading" className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="local-engines-heading" className={controlStyles.panelTitle}>
              Bộ não lập trình: Claude Code và Codex
            </h2>
            <p className={styles.sectionIntro}>
              Chạy ngay trên máy này bằng tài khoản bạn đã đăng nhập, không dùng API key. Quyền của
              mỗi lần chạy do từng agent quyết định; cài đặt ở đây là giới hạn trên.
            </p>
          </div>
          <button
            type="button"
            className={controlStyles.secondaryButton}
            aria-expanded={isGuideOpen}
            onClick={() => setIsGuideOpen((open) => !open)}
          >
            {isGuideOpen ? 'Ẩn hướng dẫn cài' : 'Hướng dẫn cài'}
          </button>
        </div>
        {isGuideOpen && <pre className={styles.codeBlock}>{INSTALL_GUIDE}</pre>}
        {engines.status === 'loading' && (
          <p className={styles.fieldHint}>Đang kiểm tra Claude Code và Codex trên máy…</p>
        )}
        {engines.status === 'error' && (
          <StatusNotice outcome={{ tone: 'error', error: engines.error }} />
        )}
        {engines.status === 'success' && (
          <div className={styles.engineGrid}>
            {engines.result.map((engine) => (
              <LocalEngineCard key={engine.engine} engine={engine} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="connections-heading" className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="connections-heading" className={controlStyles.panelTitle}>
              Kết nối API tuỳ chỉnh
            </h2>
            <p className={styles.sectionIntro}>
              Agent dùng bộ não “Custom API” gọi qua một kết nối ở đây. Hỗ trợ OpenAI-compatible
              (OpenAI, OpenRouter, vLLM, Ollama…) và Anthropic API. Ở giai đoạn này agent Custom API
              chỉ trả lời văn bản.
            </p>
          </div>
          <button
            type="button"
            className={controlStyles.primaryButton}
            onClick={() => setConnectionPanel({ mode: 'create' })}
          >
            <span className={styles.buttonIcon}>
              <StrokeIcon path="M12 5v14M5 12h14" size={16} strokeWidth={2.2} />
              Thêm kết nối
            </span>
          </button>
        </div>
        {connectionPanel.mode !== 'closed' && (
          <ConnectionFormPanel
            key={connectionPanel.mode === 'edit' ? connectionPanel.connection.id : 'new'}
            editedConnection={
              connectionPanel.mode === 'edit' ? connectionPanel.connection : undefined
            }
            onSaved={() => setConnectionPanel({ mode: 'closed' })}
            onCancel={() => setConnectionPanel({ mode: 'closed' })}
          />
        )}
        {connections.status === 'error' && (
          <StatusNotice outcome={{ tone: 'error', error: connections.error }} />
        )}
        {connections.status === 'success' &&
          connections.result.length === 0 &&
          connectionPanel.mode === 'closed' && (
            <p className={styles.fieldHint}>
              Chưa có kết nối nào. Bấm “Thêm kết nối” để thêm OpenAI-compatible hoặc Anthropic API.
            </p>
          )}
        {connections.status === 'success' && (
          <div className={styles.engineGrid}>
            {connections.result.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                onEdit={() => setConnectionPanel({ mode: 'edit', connection })}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
