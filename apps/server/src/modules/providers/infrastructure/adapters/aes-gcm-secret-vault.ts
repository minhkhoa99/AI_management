import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ConflictError } from '../../../../shared/errors/app-error';
import type { SecretVault } from '../../application/ports/secret-vault.port';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const FORMAT_VERSION = 'v1';

/**
 * AES-256-GCM with a random 96-bit IV per secret. The 256-bit key lives in its own file
 * (~/.aiteam/secret.key, mode 600 on POSIX; on Windows the per-user profile ACL applies),
 * created on first use. Stored form: "v1:<iv>:<auth tag>:<ciphertext>" (base64).
 */
export class AesGcmSecretVault implements SecretVault {
  private cachedKey: Buffer | undefined;

  constructor(private readonly keyFilePath: string) {}

  encryptSecret(plainSecret: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.loadOrCreateKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plainSecret, 'utf8'), cipher.final()]);
    return [FORMAT_VERSION, iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
      .join(':');
  }

  decryptSecret(encryptedSecret: string): string {
    const [version, ivText, tagText, ciphertextText] = encryptedSecret.split(':');
    if (
      version !== FORMAT_VERSION ||
      ivText === undefined ||
      tagText === undefined ||
      ciphertextText === undefined
    ) {
      throw new ConflictError('Khoá API đã lưu có định dạng không hợp lệ.', {
        code: 'SECRET_CORRUPTED',
      });
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.loadExistingKey(),
      Buffer.from(ivText, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));
    try {
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextText, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      throw new ConflictError(
        'Không giải mã được khoá API (secret.key đã thay đổi?). Nhập lại khoá cho kết nối này.',
        { code: 'SECRET_UNREADABLE', cause: error },
      );
    }
  }

  private loadExistingKey(): Buffer {
    try {
      return this.loadOrCreateKey({ createIfMissing: false });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ConflictError(
          'Không tìm thấy secret.key nên không đọc được khoá API đã lưu. Nhập lại khoá cho kết nối.',
          { code: 'SECRET_KEY_MISSING', cause: error },
        );
      }
      throw error;
    }
  }

  private loadOrCreateKey({ createIfMissing } = { createIfMissing: true }): Buffer {
    if (this.cachedKey !== undefined) {
      return this.cachedKey;
    }
    try {
      this.cachedKey = parseKeyFile(readFileSync(this.keyFilePath, 'utf8'));
    } catch (error) {
      if (!createIfMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      mkdirSync(path.dirname(this.keyFilePath), { recursive: true, mode: 0o700 });
      const freshKey = randomBytes(KEY_BYTES);
      // "wx": never overwrite an existing key (that would make every stored secret unreadable).
      writeFileSync(this.keyFilePath, freshKey.toString('base64'), { mode: 0o600, flag: 'wx' });
      this.cachedKey = freshKey;
    }
    return this.cachedKey;
  }
}

function parseKeyFile(fileContent: string): Buffer {
  const key = Buffer.from(fileContent.trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new ConflictError('secret.key không hợp lệ (cần 32 byte base64).', {
      code: 'SECRET_KEY_INVALID',
    });
  }
  return key;
}
