export const SAMPLE_WORKSPACE_FACTORY = Symbol('SAMPLE_WORKSPACE_FACTORY');

export interface SampleWorkspace {
  directory: string;
  disposeSampleWorkspace(): void;
}

/** Throw-away directory with a small README, used by engine test runs (never a real project). */
export interface SampleWorkspaceFactory {
  createSampleWorkspace(): SampleWorkspace;
}
