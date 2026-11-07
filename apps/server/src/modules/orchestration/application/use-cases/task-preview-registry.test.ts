import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type {
  LocalPortProbe,
  LoopbackHost,
  PreviewProcessLauncher,
  PreviewProcessListeners,
} from '../ports/preview-server.ports';
import { MAX_RUNNING_PREVIEWS, TaskPreviewRegistry } from './task-preview-registry';

class FakeLauncher implements PreviewProcessLauncher {
  readonly launches: Array<{
    command: string;
    directory: string;
    listeners: PreviewProcessListeners;
  }> = [];
  stops = 0;

  launchPreviewProcess(
    input: { command: string; directory: string; port: number },
    listeners: PreviewProcessListeners,
  ) {
    this.launches.push({ command: input.command, directory: input.directory, listeners });
    return {
      stopPreviewProcess: () => {
        this.stops += 1;
        listeners.reportExit(null);
      },
    };
  }
}

class FakeProbe implements LocalPortProbe {
  nextPort = 5100;
  answeringHost: LoopbackHost | null = null;
  exposed = false;

  allocateFreePort(): Promise<number> {
    this.nextPort += 1;
    return Promise.resolve(this.nextPort);
  }

  findLoopbackHost(): Promise<LoopbackHost | null> {
    return Promise.resolve(this.answeringHost);
  }

  isReachableFromNetwork(): Promise<boolean> {
    return Promise.resolve(this.exposed);
  }
}

const TIMINGS = { leaseMs: 60, readyTimeoutMs: 300, probeIntervalMs: 5, sweepIntervalMs: 10 };
const START = { commandTemplate: 'npm run dev -- --port {port}', directory: '/w', restart: false };

function createRegistry(timings = TIMINGS) {
  const launcher = new FakeLauncher();
  const probe = new FakeProbe();
  const registry = new TaskPreviewRegistry(launcher, probe, pino({ level: 'silent' }), timings);
  return { launcher, probe, registry };
}

async function waitForState(registry: TaskPreviewRegistry, taskId: string, state: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (registry.describePreview(taskId).state === state) return registry.describePreview(taskId);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    `preview never reached ${state}: ${JSON.stringify(registry.describePreview(taskId))}`,
  );
}

describe('TaskPreviewRegistry', () => {
  it('fills in the port, becomes running once the server answers on loopback, renews without restarting', async () => {
    const { launcher, probe, registry } = createRegistry();

    const first = await registry.startOrRenewPreview('t1', START);
    probe.answeringHost = '127.0.0.1';
    const running = await waitForState(registry, 't1', 'running');
    await registry.startOrRenewPreview('t1', START);

    expect(first).toMatchObject({ state: 'starting', port: 5101 });
    expect(launcher.launches[0]).toMatchObject({
      command: 'npm run dev -- --port 5101',
      directory: '/w',
    });
    expect(running).toMatchObject({ url: 'http://127.0.0.1:5101/', message: null });
    expect(launcher.launches).toHaveLength(1);
    registry.stopPreview('t1');
  });

  it('stops a server that is reachable from the network', async () => {
    const { launcher, probe, registry } = createRegistry();
    probe.answeringHost = '::1';
    probe.exposed = true;

    await registry.startOrRenewPreview('t1', START);
    const failed = await waitForState(registry, 't1', 'failed');

    expect(failed.url).toBeNull();
    expect(failed.message).toMatch(/127\.0\.0\.1/);
    expect(launcher.stops).toBe(1);
  });

  it('keeps a crashed server failed with its output until a restart is asked', async () => {
    const { launcher, registry } = createRegistry();

    await registry.startOrRenewPreview('t1', START);
    launcher.launches[0]!.listeners.receiveOutput('\u001b[31mError: missing script dev\u001b[0m\n');
    launcher.launches[0]!.listeners.reportExit(1);
    const renewed = await registry.startOrRenewPreview('t1', START);
    await registry.startOrRenewPreview('t1', { ...START, restart: true });

    expect(renewed).toMatchObject({ state: 'failed', output: 'Error: missing script dev\n' });
    expect(renewed.message).toMatch(/mã thoát 1/);
    expect(launcher.launches).toHaveLength(2);
    expect(registry.describePreview('t1').state).toBe('starting');
    registry.stopPreview('t1');
  });

  it('starts again when the task command changed', async () => {
    const { launcher, registry } = createRegistry();

    await registry.startOrRenewPreview('t1', START);
    await registry.startOrRenewPreview('t1', {
      ...START,
      commandTemplate: 'pnpm dev --port {port}',
    });

    expect(launcher.stops).toBe(1);
    expect(launcher.launches[1]?.command).toBe('pnpm dev --port 5102');
    registry.stopPreview('t1');
  });

  it('stops a preview whose lease is not renewed (the page was closed)', async () => {
    const { launcher, registry } = createRegistry();

    await registry.startOrRenewPreview('t1', START);
    await waitForState(registry, 't1', 'stopped');

    expect(launcher.stops).toBe(1);
  });

  it(`refuses more than ${MAX_RUNNING_PREVIEWS} previews at once`, async () => {
    const { registry } = createRegistry();
    for (let index = 0; index < MAX_RUNNING_PREVIEWS; index += 1) {
      await registry.startOrRenewPreview(`t${index}`, START);
    }

    await expect(registry.startOrRenewPreview('extra', START)).rejects.toMatchObject({
      code: 'PREVIEW_LIMIT_REACHED',
    });
    registry.onApplicationShutdown();
    expect(registry.describePreview('t0').state).toBe('stopped');
  });

  it('gives up when the server never opens its port', async () => {
    const { launcher, registry } = createRegistry({ ...TIMINGS, leaseMs: 5_000 });

    await registry.startOrRenewPreview('t1', START);
    const failed = await waitForState(registry, 't1', 'failed');

    expect(failed.message).toMatch(/chưa mở cổng 5101/);
    expect(launcher.stops).toBe(1);
  });
});
