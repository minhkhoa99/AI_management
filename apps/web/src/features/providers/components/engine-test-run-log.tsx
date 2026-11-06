import type { AgentEngineEvent } from '@aiteam/contracts';
import styles from './settings.module.css';

/** Engine output as plain text lines (never rendered as HTML: content comes from the agent). */
export function EngineTestRunLog({ events }: { events: AgentEngineEvent[] }) {
  const lines = describeEvents(events);
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className={styles.runLog} role="log" aria-live="polite" aria-label="Kết quả chạy thử">
      {lines.map((line, index) => (
        <div key={index} className={styles[`runLine_${line.tone}`]}>
          {line.text}
        </div>
      ))}
    </div>
  );
}

interface LogLine {
  tone: 'neutral' | 'success' | 'error';
  text: string;
}

function describeEvents(events: AgentEngineEvent[]): LogLine[] {
  const lines: LogLine[] = [];
  let streamedText = '';
  for (const event of events) {
    switch (event.kind) {
      case 'session_started':
        lines.push({
          tone: 'neutral',
          text: `▸ Bắt đầu phiên${event.model === null ? '' : ` · ${event.model}`}`,
        });
        break;
      case 'text_delta':
        streamedText += event.text;
        break;
      case 'message':
        lines.push({ tone: 'neutral', text: event.text });
        streamedText = '';
        break;
      case 'tool_call':
        lines.push({ tone: 'neutral', text: `⚙ ${event.toolName} ${event.detail}`.trim() });
        break;
      case 'command':
        lines.push({
          tone: 'neutral',
          text: `$ ${event.command}${event.exitCode === null ? '' : ` (mã thoát ${event.exitCode})`}`,
        });
        break;
      case 'file_change':
        lines.push({ tone: 'neutral', text: `✎ ${event.changeKind} ${event.path}` });
        break;
      case 'usage':
        lines.push({
          tone: 'neutral',
          text: `Σ ${event.inputTokens} token vào · ${event.outputTokens} token ra${event.costUsd === null ? '' : ` · $${event.costUsd.toFixed(4)}`}`,
        });
        break;
      case 'completed':
        lines.push({ tone: 'success', text: '✓ Hoàn thành' });
        break;
      case 'failed':
        lines.push({
          tone: 'error',
          text: `✗ ${event.message} [${event.code}${event.retryable ? ', thử lại được' : ''}]`,
        });
        break;
      case 'cancelled':
        lines.push({ tone: 'error', text: '■ Đã huỷ' });
        break;
    }
  }
  if (streamedText !== '') {
    lines.push({ tone: 'neutral', text: streamedText });
  }
  return lines;
}
