import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AesGcmSecretVault } from './aes-gcm-secret-vault';

describe('AesGcmSecretVault', () => {
  let directory: string;
  let keyFilePath: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'aiteam-vault-'));
    keyFilePath = path.join(directory, 'secret.key');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('round-trips a secret and never stores it in clear text', () => {
    const vault = new AesGcmSecretVault(keyFilePath);

    const encrypted = vault.encryptSecret('sk-live-1234567890');

    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain('sk-live');
    expect(new AesGcmSecretVault(keyFilePath).decryptSecret(encrypted)).toBe('sk-live-1234567890');
  });

  it('uses a fresh IV each time', () => {
    const vault = new AesGcmSecretVault(keyFilePath);

    expect(vault.encryptSecret('same')).not.toBe(vault.encryptSecret('same'));
  });

  it('creates a 32-byte key file once and reuses it', () => {
    new AesGcmSecretVault(keyFilePath).encryptSecret('a');
    const firstKey = readFileSync(keyFilePath, 'utf8');
    new AesGcmSecretVault(keyFilePath).encryptSecret('b');

    expect(Buffer.from(firstKey, 'base64')).toHaveLength(32);
    expect(readFileSync(keyFilePath, 'utf8')).toBe(firstKey);
  });

  it('detects tampering', () => {
    const vault = new AesGcmSecretVault(keyFilePath);
    const [version, iv, tag, ciphertext] = vault.encryptSecret('secret').split(':');
    const tampered = [
      version,
      iv,
      tag,
      Buffer.from('other!').toString('base64') + (ciphertext ?? ''),
    ].join(':');

    expect(() => vault.decryptSecret(tampered)).toThrow(
      expect.objectContaining({ code: 'SECRET_UNREADABLE' }),
    );
  });

  it('reports a missing key file instead of creating a new one on decrypt', () => {
    const encrypted = new AesGcmSecretVault(keyFilePath).encryptSecret('secret');
    rmSync(keyFilePath);

    expect(() => new AesGcmSecretVault(keyFilePath).decryptSecret(encrypted)).toThrow(
      expect.objectContaining({ code: 'SECRET_KEY_MISSING' }),
    );
  });

  it('rejects a key file of the wrong size', () => {
    writeFileSync(keyFilePath, Buffer.alloc(8).toString('base64'));

    expect(() => new AesGcmSecretVault(keyFilePath).encryptSecret('x')).toThrow(
      expect.objectContaining({ code: 'SECRET_KEY_INVALID' }),
    );
  });
});
