/**
 * IndexedDB wrapper for the secure-hackchat client.
 *
 * We persist:
 *   - The long-term Ed25519 identity (private + public key)
 *   - Trusted fingerprints (globally, with metadata about how they
 *     were added and the room they were first seen in)
 *   - User profile (nickname, favorite room)
 *   - User preferences (e.g. theme, last-used server URL)
 *
 * LocalStorage is intentionally NOT used for anything sensitive: the
 * password-derived room key is held in memory only for the current
 * session.
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { Identity, TrustedFingerprint, UserProfile } from '../../types';

const DB_NAME = 'secure-hackchat';
const DB_VERSION = 2;

const STORE_IDENTITY = 'identity';
const STORE_TRUST = 'trust';
const STORE_PREFS = 'prefs';
const STORE_PROFILE = 'profile';

interface IdentityRecord {
  id: string;
  publicKey: ArrayBuffer;
  privateKey: ArrayBuffer;
  fingerprint: string;
  createdAt: number;
}

interface PrefRecord {
  key: string;
  value: unknown;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore(STORE_IDENTITY, { keyPath: 'id' });
          db.createObjectStore(STORE_TRUST, { keyPath: 'fingerprint' });
          db.createObjectStore(STORE_PREFS, { keyPath: 'key' });
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(STORE_PROFILE)) {
            db.createObjectStore(STORE_PROFILE, { keyPath: 'id' });
          }
        }
      },
    });
  }
  return dbPromise;
}

/* ---------------------------------------------------------------------- */
/* Identity                                                               */
/* ---------------------------------------------------------------------- */

const IDENTITY_RECORD_ID = 'self';

export async function loadIdentity(): Promise<Identity | null> {
  const db = await getDb();
  const rec = (await db.get(STORE_IDENTITY, IDENTITY_RECORD_ID)) as
    | IdentityRecord
    | undefined;
  if (!rec) return null;
  return {
    id: rec.id,
    publicKey: rec.publicKey,
    privateKey: rec.privateKey,
    fingerprint: rec.fingerprint,
    createdAt: rec.createdAt,
  };
}

export async function saveIdentity(identity: Identity): Promise<void> {
  const db = await getDb();
  const rec: IdentityRecord = {
    id: IDENTITY_RECORD_ID,
    publicKey: identity.publicKey,
    privateKey: identity.privateKey,
    fingerprint: identity.fingerprint,
    createdAt: identity.createdAt,
  };
  await db.put(STORE_IDENTITY, rec);
}

/* ---------------------------------------------------------------------- */
/* User profile                                                           */
/* ---------------------------------------------------------------------- */

const PROFILE_RECORD_ID = 'self';

export async function loadProfile(): Promise<UserProfile | null> {
  const db = await getDb();
  const rec = (await db.get(STORE_PROFILE, PROFILE_RECORD_ID)) as
    | { id: string; nickname: string; favoriteRoom: string; updatedAt: number }
    | undefined;
  if (!rec) return null;
  return {
    nickname: rec.nickname,
    favoriteRoom: rec.favoriteRoom,
    updatedAt: rec.updatedAt,
  };
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  const db = await getDb();
  await db.put(STORE_PROFILE, {
    id: PROFILE_RECORD_ID,
    nickname: profile.nickname,
    favoriteRoom: profile.favoriteRoom,
    updatedAt: profile.updatedAt,
  });
}

/* ---------------------------------------------------------------------- */
/* Trusted fingerprints                                                   */
/* ---------------------------------------------------------------------- */

export async function listTrusted(): Promise<TrustedFingerprint[]> {
  const db = await getDb();
  return (await db.getAll(STORE_TRUST)) as TrustedFingerprint[];
}

export async function addTrusted(entry: TrustedFingerprint): Promise<void> {
  const db = await getDb();
  await db.put(STORE_TRUST, entry);
}

export async function removeTrusted(fingerprint: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_TRUST, fingerprint);
}

export async function isTrusted(fingerprint: string): Promise<boolean> {
  const db = await getDb();
  const rec = await db.get(STORE_TRUST, fingerprint);
  return !!rec;
}

/* ---------------------------------------------------------------------- */
/* Preferences                                                            */
/* ---------------------------------------------------------------------- */

export async function getPref<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const rec = (await db.get(STORE_PREFS, key)) as PrefRecord | undefined;
  return (rec?.value as T) ?? null;
}

export async function setPref<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.put(STORE_PREFS, { key, value });
}

export async function deletePref(key: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_PREFS, key);
}

/* ---------------------------------------------------------------------- */
/* Test-only helpers                                                      */
/* ---------------------------------------------------------------------- */

/** Wipes the whole database. Only used in tests. */
export async function clearAllForTests(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_IDENTITY);
  await db.clear(STORE_TRUST);
  await db.clear(STORE_PREFS);
  await db.clear(STORE_PROFILE);
}
