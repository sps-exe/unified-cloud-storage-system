// =============================================================================
// UCSS Web — Client-Side Zero-Knowledge Encryption Engine (Web Crypto API)
// =============================================================================
// Cryptographic Standard:
//   - Key Derivation: PBKDF2 (HMAC-SHA-256, 100,000 iterations)
//   - Cipher: AES-256-GCM (Authenticated Encryption with 128-bit tag)
//   - Header: 16-byte MAGIC ("UCSS_ZK_VAULT_V1") + 16-byte Salt + 12-byte IV
//
// Zero-Knowledge Guarantee:
//   The user's master passphrase NEVER leaves the browser memory. Plaintext bytes
//   are NEVER transmitted to the backend or Google Drive servers.
// =============================================================================

const MAGIC_HEADER = 'UCSS_ZK_VAULT_V1'; // 16 bytes ASCII
const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;

/**
 * Derives an AES-GCM 256-bit CryptoKey from a user passphrase and salt using PBKDF2.
 */
async function deriveEncryptionKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Checks if a byte buffer or Blob begins with the UCSS Zero-Knowledge Vault header.
 */
export async function isEncryptedVaultFile(blobOrBuffer: Blob | ArrayBuffer): Promise<boolean> {
  let headerBytes: Uint8Array;

  if (blobOrBuffer instanceof Blob) {
    const slice = blobOrBuffer.slice(0, 16);
    const buf = await slice.arrayBuffer();
    headerBytes = new Uint8Array(buf);
  } else {
    headerBytes = new Uint8Array(blobOrBuffer.slice(0, 16));
  }

  const dec = new TextDecoder();
  return dec.decode(headerBytes) === MAGIC_HEADER;
}

/**
 * Encrypts a File or Blob with AES-256-GCM using a user-supplied passphrase.
 * Returns a new File object with '.enc' appended and the magic vault header.
 */
export async function encryptFileClientSide(file: File, passphrase: string): Promise<File> {
  const enc = new TextEncoder();
  const magic = enc.encode(MAGIC_HEADER);
  const salt = window.crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));

  const key = await deriveEncryptionKey(passphrase, salt);
  const fileBytes = await file.arrayBuffer();

  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    fileBytes,
  );

  // Assemble container: [MAGIC (16B)] + [SALT (16B)] + [IV (12B)] + [CIPHERTEXT]
  const container = new Uint8Array(magic.length + salt.length + iv.length + ciphertext.byteLength);
  container.set(magic, 0);
  container.set(salt, magic.length);
  container.set(iv, magic.length + salt.length);
  container.set(new Uint8Array(ciphertext), magic.length + salt.length + iv.length);

  const encryptedBlob = new Blob([container], { type: 'application/octet-stream' });
  const encryptedName = file.name.endsWith('.enc') ? file.name : `${file.name}.enc`;

  return new window.File([encryptedBlob], encryptedName, {
    type: 'application/octet-stream',
    lastModified: Date.now(),
  });
}

/**
 * Decrypts a vault container with AES-256-GCM using the user passphrase.
 * Returns the decrypted Uint8Array. Throws on incorrect password or tamper.
 */
export async function decryptFileClientSide(
  encryptedBuffer: ArrayBuffer,
  passphrase: string,
): Promise<Uint8Array> {
  const bytes = new Uint8Array(encryptedBuffer);
  const dec = new TextDecoder();

  // Validate magic header
  const magic = dec.decode(bytes.slice(0, 16));
  if (magic !== MAGIC_HEADER) {
    throw new Error('File is not a valid UCSS Zero-Knowledge encrypted vault container');
  }

  const salt = bytes.slice(16, 16 + SALT_LENGTH_BYTES);
  const iv = bytes.slice(16 + SALT_LENGTH_BYTES, 16 + SALT_LENGTH_BYTES + IV_LENGTH_BYTES);
  const ciphertext = bytes.slice(16 + SALT_LENGTH_BYTES + IV_LENGTH_BYTES);

  const key = await deriveEncryptionKey(passphrase, salt);

  try {
    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      ciphertext,
    );
    return new Uint8Array(decrypted);
  } catch {
    throw new Error('Decryption failed: Incorrect password or corrupted ciphertext');
  }
}
