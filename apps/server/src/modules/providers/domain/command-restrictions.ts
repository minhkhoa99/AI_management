/** Command prefixes per shell flavour, shared by every engine that restricts commands. */
export interface CommandPrefixes {
  shell: readonly string[];
  powershell: readonly string[];
}

/** Shell commands that reach the network, denied together with the network tools. */
export const NETWORK_COMMAND_PREFIXES: CommandPrefixes = {
  shell: ['curl', 'wget'],
  powershell: ['Invoke-WebRequest'],
};

/** Denied even for agents allowed to edit, when the engine blocks dangerous commands. */
export const DANGEROUS_COMMAND_PREFIXES: CommandPrefixes = {
  shell: ['rm -rf', 'git push', 'git reset --hard', 'npm publish'],
  powershell: ['Remove-Item'],
};
