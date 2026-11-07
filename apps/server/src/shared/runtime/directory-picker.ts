export const DIRECTORY_PICKER = Symbol('DIRECTORY_PICKER');

/** The operating system's folder dialog, opened on this machine. */
export interface DirectoryPicker {
  /** The chosen folder, or null when the user cancelled. */
  pickDirectory(): Promise<string | null>;
}
