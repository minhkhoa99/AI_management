import { Injectable } from '@nestjs/common';
import type { EngineTestRunMessage } from '@aiteam/contracts';
import { Observable } from 'rxjs';
import { EngineTestRunRegistry } from '../engine-test-run-registry';

/** Event stream of a test run for SSE: buffered events first, then live ones, then completes. */
@Injectable()
export class WatchEngineTestRunUseCase {
  constructor(private readonly testRunRegistry: EngineTestRunRegistry) {}

  watchEngineTestRun(testRunId: string): Observable<EngineTestRunMessage> {
    // Checked before subscribing, so an unknown id is a JSON 404, not an empty event stream.
    this.testRunRegistry.assertEngineTestRunExists(testRunId);
    return new Observable<EngineTestRunMessage>((subscriber) =>
      this.testRunRegistry.followEngineTestRun(
        testRunId,
        (message) => subscriber.next(message),
        () => subscriber.complete(),
      ),
    );
  }
}
