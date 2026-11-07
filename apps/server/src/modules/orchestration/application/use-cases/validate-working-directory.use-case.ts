import { Injectable } from '@nestjs/common';
import type { DirectoryValidation } from '@aiteam/contracts';
import { WorkingDirectoryPolicy } from './working-directory-policy';

/** Checks a folder typed in the task form, before the task is saved. */
@Injectable()
export class ValidateWorkingDirectoryUseCase {
  constructor(private readonly workingDirectoryPolicy: WorkingDirectoryPolicy) {}

  validateWorkingDirectory(rawPath: string): Promise<DirectoryValidation> {
    return this.workingDirectoryPolicy.describeWorkingDirectory(rawPath);
  }
}
