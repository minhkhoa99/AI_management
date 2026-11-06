import { createServer } from 'node:net';
import { ConflictError } from './shared/errors/app-error';

/** How many consecutive ports are tried after the preferred one is busy. */
export const MAX_PORT_ATTEMPTS = 20;

const HIGHEST_TCP_PORT = 65_535;

/** Resolves true when nothing listens on host:port right now. */
export function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
        resolve(false);
        return;
      }
      reject(error);
    });
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen({ port, host, exclusive: true });
  });
}

/** Ports to try, in order: the preferred port, then the next ones up to MAX_PORT_ATTEMPTS. */
export function listCandidatePorts(preferredPort: number): number[] {
  const candidates: number[] = [];
  for (let port = preferredPort; port <= HIGHEST_TCP_PORT; port += 1) {
    if (candidates.length === MAX_PORT_ATTEMPTS) {
      break;
    }
    candidates.push(port);
  }
  return candidates;
}

export function isAddressInUseError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE';
}

export function createNoFreePortError(preferredPort: number): ConflictError {
  const lastPort = Math.min(preferredPort + MAX_PORT_ATTEMPTS - 1, HIGHEST_TCP_PORT);
  return new ConflictError(
    `Không còn cổng trống từ ${preferredPort} đến ${lastPort}. Chọn cổng khác bằng --port hoặc AITEAM_PORT.`,
    { code: 'NO_FREE_PORT' },
  );
}
