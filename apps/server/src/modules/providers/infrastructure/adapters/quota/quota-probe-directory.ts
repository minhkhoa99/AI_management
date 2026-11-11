import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/** A throw-away working directory for quota queries, never a worktree or project folder. */
export async function prepareQuotaProbeDirectory(dataDirectory: string): Promise<string> {
  const probeDirectory = path.resolve(dataDirectory, 'quota-probe');
  await mkdir(probeDirectory, { recursive: true });
  return probeDirectory;
}
