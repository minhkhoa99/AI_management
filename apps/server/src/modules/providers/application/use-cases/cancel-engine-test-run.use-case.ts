import { Injectable } from '@nestjs/common';
import { EngineTestRunRegistry } from '../engine-test-run-registry';

@Injectable()
export class CancelEngineTestRunUseCase {
  constructor(private readonly testRunRegistry: EngineTestRunRegistry) {}

  cancelEngineTestRun(testRunId: string): void {
    this.testRunRegistry.cancelEngineTestRun(testRunId);
  }
}
