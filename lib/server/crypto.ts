import crypto from 'crypto';
import { getEncryptionKey } from './appConfig';

const ALGO = 'aes-256-gcm';

export const encryptSecret = (plaintext?: string | null): string | null => {
  if (!plaintext) {
    return null;
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
};

export const decryptSecret = (sealed?: string | null): string | null => {
  if (!sealed) {
    return null;
  }

  const [ivRaw, tagRaw, dataRaw] = sealed.split('.');
  if (!ivRaw || !tagRaw || !dataRaw) {
    throw new Error('Invalid encrypted secret format');
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivRaw, 'base64url');
  const tag = Buffer.from(tagRaw, 'base64url');
  const data = Buffer.from(dataRaw, 'base64url');

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

  return decrypted.toString('utf8');
};
