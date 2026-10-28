// =============================================================================
// UCSS API — Token Encryption Service
// =============================================================================
// Encrypts and decrypts Google OAuth refresh tokens using AES-256-GCM.
// 
// WHY AES-256-GCM?
//   - GCM (Galois/Counter Mode) is an AEAD cipher — it provides both
//     confidentiality (encryption) AND integrity (authentication tag).
//   - If anyone tampers with the stored ciphertext, decryption will FAIL
//     with an authentication error, not silently return garbage.
//   - It's a built-in Node.js crypto primitive — no external dependencies.
//
// STORAGE FORMAT: "iv:authTag:ciphertext" (all hex-encoded)
//   - iv: 12 bytes (96 bits) — recommended for GCM
//   - authTag: 16 bytes (128 bits) — maximum tag length
//   - ciphertext: variable length

import crypto from 'crypto';
import { env } from './env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;       // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

// 64 hex chars are the raw key; anything else is stretched to 32 bytes with SHA-256.
const KEY = /^[0-9a-fA-F]{64}$/.test(env.TOKEN_ENCRYPTION_KEY)
  ? Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'hex')
  : crypto.createHash('sha256').update(env.TOKEN_ENCRYPTION_KEY).digest();

if (KEY.length !== 32) {
  throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes');
}

/**
 * Encrypts a plaintext string (e.g., a refresh token) using AES-256-GCM.
 * Returns a single string in the format: "iv:authTag:ciphertext" (hex-encoded).
 */
export function encryptToken(plaintext: string): string {
  // Generate a cryptographically random IV for each encryption.
  // NEVER reuse an IV with the same key in GCM mode.
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Pack everything into a single colon-delimited hex string
  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

/**
 * Decrypts a token string produced by encryptToken().
 * Throws if the ciphertext has been tampered with (auth tag mismatch).
 */
export function decryptToken(encryptedString: string): string {
  const parts = encryptedString.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  // setAuthTag MUST be called before final() — it verifies the tag on final()
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(), // Throws if auth tag doesn't match — tamper detected
  ]);

  return decrypted.toString('utf8');
}
