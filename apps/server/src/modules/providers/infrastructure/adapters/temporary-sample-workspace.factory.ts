import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import type {
  SampleWorkspace,
  SampleWorkspaceFactory,
} from '../../application/ports/sample-workspace.port';

const SAMPLE_README = [
  '# Dự án mẫu',
  '',
  'Ứng dụng ghi chú nhỏ viết bằng TypeScript. Có hai lệnh: thêm ghi chú và liệt kê ghi chú.',
  '',
].join('\n');

@Injectable()
export class TemporarySampleWorkspaceFactory implements SampleWorkspaceFactory {
  createSampleWorkspace(): SampleWorkspace {
    const directory = mkdtempSync(path.join(tmpdir(), 'aiteam-test-run-'));
    writeFileSync(path.join(directory, 'README.md'), SAMPLE_README);
    return {
      directory,
      disposeSampleWorkspace: () => rmSync(directory, { recursive: true, force: true }),
    };
  }
}
