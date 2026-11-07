import { createConnection, createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { Injectable } from '@nestjs/common';
import type { LocalPortProbe, LoopbackHost } from '../../application/ports/preview-server.ports';

const CONNECT_TIMEOUT_MS = 400;

/** TCP checks against this machine only. */
@Injectable()
export class NodeLocalPortProbe implements LocalPortProbe {
  allocateFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        server.close(() => (port > 0 ? resolve(port) : reject(new Error('no port assigned'))));
      });
    });
  }

  async findLoopbackHost(port: number): Promise<LoopbackHost | null> {
    if (await acceptsConnection('127.0.0.1', port)) return '127.0.0.1';
    if (await acceptsConnection('::1', port)) return '::1';
    return null;
  }

  async isReachableFromNetwork(port: number): Promise<boolean> {
    const addresses = Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      // Link-local IPv6 needs a scope id and is not reachable beyond the link anyway.
      .filter((entry) => !entry.internal && !entry.address.toLowerCase().startsWith('fe80:'))
      .map((entry) => entry.address);
    const results = await Promise.all(addresses.map((host) => acceptsConnection(host, port)));
    return results.some(Boolean);
  }
}

function acceptsConnection(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (accepted: boolean) => {
      socket.destroy();
      resolve(accepted);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
