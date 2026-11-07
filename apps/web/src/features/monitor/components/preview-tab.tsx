'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { loadTaskDetail } from '../../tasks/tasks-api';
import {
  ALL_DEVICES,
  CUSTOM_DEVICE_ID,
  CUSTOM_SIZE_LIMITS,
  DEFAULT_DEVICE_ID,
  DEVICE_GROUPS,
  type DeviceKind,
  describeBreakpoint,
  guessDeviceKind,
} from '../preview-devices';
import styles from './monitor.module.css';
import { usePreviewLease } from './use-preview-lease';

const ZOOM_OPTIONS = [
  { id: 'auto', label: 'Vừa khung' },
  { id: '1', label: '100%' },
  { id: '0.75', label: '75%' },
  { id: '0.5', label: '50%' },
  { id: '0.33', label: '33%' },
  { id: '0.25', label: '25%' },
];

const STATE_LABELS = {
  starting: 'Đang khởi động server…',
  running: 'Server đang chạy, tự tải lại khi agent lưu file (nếu dev server hỗ trợ)',
  failed: 'Server lỗi',
  stopped: 'Server đã dừng',
} as const;

/** "Giao diện": the task's dev server inside a sandboxed iframe, at the chosen screen size. */
export function PreviewTab({ taskId }: { taskId: string }) {
  const task = useApiQuery(`preview-task:${taskId}`, () => loadTaskDetail(taskId));
  if (task.status === 'loading') return <p className={styles.mutedText}>Đang tải task…</p>;
  if (task.status === 'error')
    return <StatusNotice outcome={{ tone: 'error', error: task.error }} />;
  if (task.result.previewCommand === null) {
    return (
      <div className={styles.previewEmpty}>
        <p className={styles.mutedText}>
          Task chưa có lệnh chạy giao diện. Mở task, chọn “Sửa task” và điền lệnh chạy dev server có{' '}
          <code>{'{port}'}</code>, vd.{' '}
          <code>npm run dev -- --port {'{port}'} --host 127.0.0.1</code>.
        </p>
        <Link
          href={`/tasks/?task=${encodeURIComponent(taskId)}`}
          className={controlStyles.secondaryButton}
        >
          Mở task
        </Link>
      </div>
    );
  }
  return (
    <PreviewRunner
      key={task.result.previewCommand}
      taskId={taskId}
      command={task.result.previewCommand}
    />
  );
}

function PreviewRunner({ taskId, command }: { taskId: string; command: string }) {
  const { status, failure, restartPreview, stopPreviewNow } = usePreviewLease(taskId, command);
  const [reloadCount, setReloadCount] = useState(0);
  const state = status?.state ?? 'starting';
  const stateColor =
    state === 'running'
      ? 'var(--color-success)'
      : state === 'failed'
        ? 'var(--color-danger)'
        : 'var(--color-text-muted)';

  return (
    <div className={styles.previewLayout}>
      <div className={styles.previewStatusRow}>
        <span className={styles.previewState} style={{ color: stateColor }}>
          <span
            aria-hidden="true"
            className={styles.counterDot}
            style={{ background: stateColor }}
          />
          {STATE_LABELS[state]}
        </span>
        <span className={styles.monoText}>{command}</span>
        <div className={controlStyles.buttonRow} style={{ marginLeft: 'auto' }}>
          {state === 'running' && status?.url !== null && status?.url !== undefined && (
            <>
              <button
                type="button"
                className={controlStyles.secondaryButton}
                onClick={() => setReloadCount((count) => count + 1)}
              >
                Tải lại
              </button>
              <a
                className={controlStyles.secondaryButton}
                href={status.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Mở tab mới
              </a>
            </>
          )}
          {(state === 'running' || state === 'starting') && (
            <button
              type="button"
              className={controlStyles.secondaryButton}
              onClick={stopPreviewNow}
            >
              Dừng server
            </button>
          )}
          {(state === 'failed' || state === 'stopped') && (
            <button type="button" className={controlStyles.primaryButton} onClick={restartPreview}>
              Chạy lại
            </button>
          )}
        </div>
      </div>
      {failure !== null && <StatusNotice outcome={{ tone: 'error', error: failure }} />}
      {status?.message !== null && status?.message !== undefined && (
        <p role="alert" className={controlStyles.fieldError}>
          {status.message}
        </p>
      )}
      {(state === 'failed' || state === 'starting') && status !== null && status.output !== '' && (
        <pre className={styles.terminal} aria-label="Output của server">
          {status.output}
        </pre>
      )}
      <DeviceViewport
        url={state === 'running' ? (status?.url ?? null) : null}
        reloadCount={reloadCount}
      />
    </div>
  );
}

function DeviceViewport({ url, reloadCount }: { url: string | null; reloadCount: number }) {
  const [deviceId, setDeviceId] = useState(DEFAULT_DEVICE_ID);
  const [landscape, setLandscape] = useState(false);
  const [zoomChoice, setZoomChoice] = useState('auto');
  const [customSize, setCustomSize] = useState({ width: 1024, height: 768 });
  const stageWidth = useElementWidth();

  const isCustom = deviceId === CUSTOM_DEVICE_ID;
  const device = ALL_DEVICES.find((candidate) => candidate.id === deviceId) ?? ALL_DEVICES[2]!;
  const baseWidth = isCustom
    ? clamp(customSize.width, CUSTOM_SIZE_LIMITS.minWidth, CUSTOM_SIZE_LIMITS.maxWidth)
    : device.width;
  const baseHeight = isCustom
    ? clamp(customSize.height, CUSTOM_SIZE_LIMITS.minHeight, CUSTOM_SIZE_LIMITS.maxHeight)
    : device.height;
  const viewWidth = landscape ? baseHeight : baseWidth;
  const viewHeight = landscape ? baseWidth : baseHeight;
  const kind: DeviceKind = isCustom ? guessDeviceKind(viewWidth) : device.kind;
  const bezel = kind === 'phone' ? 12 : kind === 'tablet' ? 16 : 0;
  const topBar =
    kind === 'laptop' || kind === 'desktop' ? 34 : kind === 'phone' && !landscape ? 22 : 0;
  const frameWidth = viewWidth + bezel * 2;
  const frameHeight = viewHeight + bezel * 2 + topBar;
  const fitZoom = Math.min(1, (stageWidth.width - 48) / frameWidth, 720 / frameHeight);
  const zoom =
    zoomChoice === 'auto' ? Math.max(0.15, Math.floor(fitZoom * 100) / 100) : Number(zoomChoice);
  const deviceIndex = ALL_DEVICES.findIndex((candidate) => candidate.id === device.id);
  const stepDevice = (offset: number) => {
    const next = ALL_DEVICES[(deviceIndex + offset + ALL_DEVICES.length) % ALL_DEVICES.length];
    if (next !== undefined) setDeviceId(next.id);
  };

  return (
    <>
      <div className={styles.previewToolbar}>
        <label className={`${controlStyles.field} ${styles.previewDeviceField}`}>
          Thiết bị / kích thước màn
          <span className={styles.previewDevicePicker}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Thiết bị trước"
              onClick={() => stepDevice(-1)}
            >
              ‹
            </button>
            <select
              className={controlStyles.fieldInput}
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
            >
              {DEVICE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.devices.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name} · {candidate.width}×{candidate.height}
                    </option>
                  ))}
                </optgroup>
              ))}
              <optgroup label="Khác">
                <option value={CUSTOM_DEVICE_ID}>Tuỳ chỉnh kích thước…</option>
              </optgroup>
            </select>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Thiết bị tiếp theo"
              onClick={() => stepDevice(1)}
            >
              ›
            </button>
          </span>
        </label>
        {isCustom && (
          <>
            <label className={controlStyles.field}>
              Rộng (px)
              <input
                type="number"
                className={`${controlStyles.fieldInput} ${styles.previewNumber}`}
                min={CUSTOM_SIZE_LIMITS.minWidth}
                max={CUSTOM_SIZE_LIMITS.maxWidth}
                value={customSize.width}
                onChange={(event) =>
                  setCustomSize((size) => ({ ...size, width: Number(event.target.value) || 0 }))
                }
              />
            </label>
            <label className={controlStyles.field}>
              Cao (px)
              <input
                type="number"
                className={`${controlStyles.fieldInput} ${styles.previewNumber}`}
                min={CUSTOM_SIZE_LIMITS.minHeight}
                max={CUSTOM_SIZE_LIMITS.maxHeight}
                value={customSize.height}
                onChange={(event) =>
                  setCustomSize((size) => ({ ...size, height: Number(event.target.value) || 0 }))
                }
              />
            </label>
          </>
        )}
        <button
          type="button"
          className={controlStyles.pillButton}
          aria-pressed={landscape}
          onClick={() => setLandscape((value) => !value)}
        >
          {landscape ? 'Màn ngang' : 'Màn dọc'}
        </button>
        <label className={controlStyles.field}>
          Thu phóng
          <select
            className={controlStyles.fieldInput}
            value={zoomChoice}
            onChange={(event) => setZoomChoice(event.target.value)}
          >
            {ZOOM_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.previewChips}>
        <span className={styles.previewChip}>{isCustom ? 'Tuỳ chỉnh' : device.name}</span>
        <span className={`${styles.previewChip} ${styles.monoText}`}>
          {viewWidth} × {viewHeight} px
        </span>
        <span className={styles.previewChip}>Breakpoint {describeBreakpoint(viewWidth)}</span>
        <span className={styles.previewChip}>Thu phóng {Math.round(zoom * 100)}%</span>
      </div>
      <div ref={stageWidth.ref} className={styles.previewStage}>
        <div style={{ width: frameWidth * zoom, height: frameHeight * zoom, margin: '0 auto' }}>
          <div
            className={styles.previewFrame}
            data-kind={kind}
            style={{
              width: frameWidth,
              height: frameHeight,
              borderWidth: bezel,
              transform: `scale(${zoom})`,
            }}
          >
            {topBar > 0 && (
              <div className={styles.previewTopBar} style={{ height: topBar }}>
                {kind === 'phone' ? (
                  <span className={styles.previewNotch} />
                ) : (
                  <span className={styles.monoText}>{url ?? ''}</span>
                )}
              </div>
            )}
            {url === null ? (
              <div
                className={styles.previewPlaceholder}
                style={{ width: viewWidth, height: viewHeight }}
              >
                Chưa có giao diện để hiển thị.
              </div>
            ) : (
              <iframe
                key={`${url}:${reloadCount}`}
                title="Xem trước giao diện của task"
                src={url}
                width={viewWidth}
                height={viewHeight}
                className={styles.previewIframe}
                // Agent-written app: scripts and forms run, but in an opaque origin, so it cannot
                // reach this page. The server gives a `localhost` (or [::1]) URL, another site
                // than the UI's 127.0.0.1, so the browser never sends it the aiteam cookie.
                sandbox="allow-scripts allow-forms"
                referrerPolicy="no-referrer"
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Width of the preview stage, followed as the window resizes (for "Vừa khung"). */
function useElementWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined && measured > 0) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
