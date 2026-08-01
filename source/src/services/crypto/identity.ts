/**
 * Identity bootstrap. Loads the long-term Ed25519 key pair from IndexedDB,
 * or generates a fresh one on first launch.
 */

import {
  buildIdentity,
  generateIdentityKeyPair,
} from './crypto';
import { loadIdentity, saveIdentity } from '../storage/idb';
import type { Identity } from '../../types';

/**
 * Returns the persisted identity, creating one if it doesn't exist.
 * Safe to call multiple times — it's idempotent.
 */
export async function getOrCreateIdentity(): Promise<Identity> {
  const existing = await loadIdentity();
  if (existing) return existing;
  const { publicKey, privateKey } = await generateIdentityKeyPair();
  const identity = await buildIdentity({ publicKey, privateKey });
  await saveIdentity(identity);
  return identity;
}
