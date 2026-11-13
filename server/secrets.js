import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = (() => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta?.url && import.meta.url.startsWith('file:')) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch { /* ignored */ }
  try { return process.cwd ? process.cwd() : '/'; } catch { return '/'; }
})();

const root = path.resolve(here, '..');

/**
 * HMAC verification requires the original shared secret, so webhook secrets are
 * stored encrypted (AES-256-GCM), not merely hashed. Invitation tokens, by
 * contrast, are one-time bearer tokens and are stored as SHA-256 hashes only.
 */
function keyMaterial() {
  const env = process.env.WEBHOOK_ENCRYPTION_KEY;
  if (env && env.length >= 32) return crypto.createHash('sha256').update(env).digest();
  const dir = path.resolve(root, process.env.DATA_DIR || 'data');
  const keyFile = path.join(dir, '.webhook-key');
  if (fs.existsSync(keyFile)) return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
  fs.mkdirSync(dir, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, key.toString('base64'), { mode: 0o600 });
  return key;
}

let cachedKey = null;
const key = () => (cachedKey ||= keyMaterial());

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${body.toString('base64')}`;
}

export function decryptSecret(payload) {
  const [version, ivB64, tagB64, bodyB64] = String(payload).split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !bodyB64) throw new Error('Unsupported secret envelope');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(bodyB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
