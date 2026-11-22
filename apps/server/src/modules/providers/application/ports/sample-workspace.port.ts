export const SAMPLE_WORKSPACE_FACTORY = Symbol('SAMPLE_WORKSPACE_FACTORY');

export interface SampleWorkspace {
  directory: string;
  disposeSampleWorkspace(): void;
}

/**
 * Throw-away directory used by engine test runs and one-shot AI questions (never a real project).
 * It holds a small sample README unless `withReadme` is false (default true).
 */
export interface SampleWorkspaceFactory {
  createSampleWorkspace(options?: { withReadme: boolean }): SampleWorkspace;
}
