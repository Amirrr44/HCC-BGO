/**
 * Browser-native cryptography primitives used by secure-hackchat.
 *
 * The whole crypto stack is built on top of the Web Crypto API. We deliberately
 * avoid external libraries so that the attack surface stays small and the code
 * remains auditable.
 *
 *   - PBKDF2 / SHA-256   — derive a 256-bit AES key from the shared password
 *   - AES-256-GCM        — symmetric encryption of message bodies
 *   - Ed25519            — long-term identity, signatures
 *   - SHA-256            — fingerprint of public keys
 *
 * All methods are intentionally pure functions on top of `crypto.subtle` so
 * they can be unit-tested independently of the network layer.
 */

import type { EncryptedPayload, Identity } from '../../types';

/* ---------------------------------------------------------------------- */
/* Utility: base64                                                        */
/* ---------------------------------------------------------------------- */

/** Encode an ArrayBuffer to standard base64. */
export function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

/** Decode standard base64 to an ArrayBuffer. Throws on invalid input. */
export function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes.buffer;
}

/* ---------------------------------------------------------------------- */
/* Utility: hex                                                           */
/* ---------------------------------------------------------------------- */

/** Convert an ArrayBuffer to a lowercase hex string. */
export function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** Convert a hex string into an ArrayBuffer. Throws on bad input. */
export function hexToBuf(hex: string): ArrayBuffer {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex length');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) throw new Error('Invalid hex character');
    bytes[i] = byte;
  }
  return bytes.buffer;
}

/** Human-readable grouping of a hex fingerprint, e.g. 91AF-23BC-8F4E-… */
export function formatFingerprint(hex: string): string {
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += 4) {
    groups.push(hex.substr(i, 4).toUpperCase());
  }
  return groups.join('-');
}

/* ---------------------------------------------------------------------- */
/* Symmetric: PBKDF2 + AES-GCM                                            */
/* ---------------------------------------------------------------------- */

const PBKDF2_ITERATIONS = 250_000;
const PBKDF2_HASH = 'SHA-256';
const AES_ALGO = 'AES-GCM';
const AES_KEY_BITS = 256;
const GCM_IV_BYTES = 12;

/** Derive an AES-256-GCM CryptoKey from a password + a per-room salt. */
export async function deriveRoomKey(
  password: string,
  channel: string,
): Promise<CryptoKey> {
  // We use a stable per-channel salt so the same password + channel always
  // produces the same key. The salt is *not* a secret.
  const saltText = `secure-hackchat::${channel.trim().toLowerCase()}`;
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(saltText),
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    baseKey,
    { name: AES_ALGO, length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt a UTF-8 string with AES-256-GCM. Returns IV + ciphertext. */
export async function encryptString(
  key: CryptoKey,
  plaintext: string,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt(
    { name: AES_ALGO, iv },
    key,
    enc.encode(plaintext),
  );
  return {
    iv: bufToB64(iv.buffer),
    ct: bufToB64(ct),
  };
}

/** Decrypt an AES-256-GCM payload. Throws on auth-tag mismatch. */
export async function decryptString(
  key: CryptoKey,
  payload: EncryptedPayload,
): Promise<string> {
  const iv = new Uint8Array(b64ToBuf(payload.iv));
  const ct = b64ToBuf(payload.ct);
  const pt = await crypto.subtle.decrypt({ name: AES_ALGO, iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/* ---------------------------------------------------------------------- */
/* Asymmetric: Ed25519                                                    */
/* ---------------------------------------------------------------------- */

/** Generate a new Ed25519 key pair. */
export async function generateIdentityKeyPair(): Promise<{
  publicKey: ArrayBuffer;
  privateKey: ArrayBuffer;
}> {
  const kp = await crypto.subtle.generateKey(
    { name: 'Ed25519' } as AlgorithmIdentifier,
    true,
    ['sign', 'verify'],
  );
  const publicKey = await crypto.subtle.exportKey('spki', kp.publicKey);
  const privateKey = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  return { publicKey, privateKey };
}

/** Import an Ed25519 public key from SPKI bytes. */
export async function importPublicKey(spki: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'Ed25519' } as AlgorithmIdentifier,
    true,
    ['verify'],
  );
}

/** Import an Ed25519 private key from PKCS8 bytes. */
export async function importPrivateKey(
  pkcs8: ArrayBuffer,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'Ed25519' } as AlgorithmIdentifier,
    true,
    ['sign'],
  );
}

/** Compute the SHA-256 fingerprint of a raw public key. */
export async function fingerprintPublicKey(
  publicKey: ArrayBuffer,
): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', publicKey);
  return bufToHex(hash);
}

/** Sign an ArrayBuffer with an Ed25519 private key. */
export async function signBuffer(
  privateKey: CryptoKey,
  data: ArrayBuffer,
): Promise<ArrayBuffer> {
  // Some browsers reject signing an ArrayBuffer directly; copy into a fresh
  // ArrayBuffer view to avoid passing a SharedArrayBuffer / typed array.
  const copy = new Uint8Array(data.byteLength);
  copy.set(new Uint8Array(data));
  return crypto.subtle.sign(
    { name: 'Ed25519' } as AlgorithmIdentifier,
    privateKey,
    copy.buffer,
  );
}

/** Verify an Ed25519 signature. Returns true if valid. */
export async function verifySignature(
  publicKey: CryptoKey,
  signature: ArrayBuffer,
  data: ArrayBuffer,
): Promise<boolean> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(new Uint8Array(data));
  return crypto.subtle.verify(
    { name: 'Ed25519' } as AlgorithmIdentifier,
    publicKey,
    signature,
    copy.buffer,
  );
}

/* ---------------------------------------------------------------------- */
/* High level: identity bootstrap                                         */
/* ---------------------------------------------------------------------- */

/**
 * Build a complete {@link Identity} from raw key material. This is the single
 * function used both when generating a fresh identity and when reloading one
 * from IndexedDB.
 */
export async function buildIdentity(args: {
  publicKey: ArrayBuffer;
  privateKey: ArrayBuffer;
  createdAt?: number;
}): Promise<Identity> {
  const fingerprint = await fingerprintPublicKey(args.publicKey);
  return {
    id: fingerprint,
    publicKey: args.publicKey,
    privateKey: args.privateKey,
    fingerprint,
    createdAt: args.createdAt ?? Date.now(),
  };
}
