export const SECRET_VAULT = Symbol('SECRET_VAULT');

/** Encrypts secrets (API keys) at rest. Plain secrets never reach the database or logs. */
export interface SecretVault {
  encryptSecret(plainSecret: string): string;
  decryptSecret(encryptedSecret: string): string;
}
