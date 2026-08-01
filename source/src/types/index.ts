/**
 * Core type definitions used across the application.
 *
 * The secure-hackchat protocol operates purely on top of the public
 * hack.chat WebSocket protocol. We define all the shapes we need to
 * reason about messages, identities, members, and packets.
 */

/** hack.chat server connection parameters. */
export interface ServerConfig {
  /** Base URL of the hack.chat server, e.g. https://hack.chat */
  url: string;
  /** Channel / room name. */
  channel: string;
  /** Nickname used when joining. */
  nickname: string;
  /** Local-only secret used to derive the room key. Never sent to the server. */
  password: string;
}

/** Persistent identity derived from an Ed25519 key pair. */
export interface Identity {
  /** Stable, unique id (fingerprint of the public key). */
  id: string;
  /** Raw public key bytes (raw SPKI form). */
  publicKey: ArrayBuffer;
  /** Raw private key bytes (raw PKCS8 form). Persisted, never transmitted. */
  privateKey: ArrayBuffer;
  /** Human-friendly fingerprint: hex grouped in 4-byte blocks. */
  fingerprint: string;
  /** Epoch millis when the identity was created. */
  createdAt: number;
}

/** A trusted fingerprint entry stored locally in IndexedDB. */
export interface TrustedFingerprint {
  /** Fingerprint string, primary key. */
  fingerprint: string;
  /** Optional human label, e.g. "Alice's laptop". */
  label?: string;
  /** Last known nickname for this fingerprint, may be undefined. */
  lastNick?: string;
  /** Room where the fingerprint was first seen / trusted. */
  lastRoom?: string;
  /** Epoch millis when the trust was granted. */
  trustedAt: number;
}

/** Local user profile (nickname, favorite room, etc.). Persisted in IndexedDB. */
export interface UserProfile {
  /** The nickname the user joins hack.chat with. */
  nickname: string;
  /** Room the user prefers to land in by default. */
  favoriteRoom: string;
  /** Epoch millis the profile was last updated. */
  updatedAt: number;
}

/**
 * Local member state. We keep track of every nick we have ever seen in the
 * current session so the UI can render presence even when packets are missed.
 */
export interface Member {
  /** hack.chat nickname. */
  nickname: string;
  /** Trust/encryption status indicator. */
  status: MemberStatus;
  /** Fingerprint if known (may be missing for plain hack.chat users). */
  fingerprint?: string;
  /** Last time we received any signal from this member. */
  lastSeen: number;
}

/** Coarse-grained status for the members page indicator. */
export type MemberStatus =
  | 'unknown' // no signal yet
  | 'plain' // no secure client detected
  | 'wrong-password' // secure client, password mismatch
  | 'untrusted' // secure client, password matches, fingerprint not trusted
  | 'trusted'; // user has manually verified the fingerprint

/** Encryption payload used for outgoing and incoming messages. */
export interface EncryptedPayload {
  /** AES-256-GCM IV (12 bytes). */
  iv: string; // base64
  /** Ciphertext (including auth tag). */
  ct: string; // base64
}

/** Packet types in the [HCC:1] protocol. */
export type PacketType = 'hello' | 'message' | 'presence';

/** Top-level [HCC:1] packet. */
export interface SecurePacket {
  /** Protocol version, currently 1. */
  v: number;
  /** Packet type discriminator. */
  t: PacketType;
  /** Sender fingerprint. */
  fp: string;
  /** Epoch millis when the packet was created. */
  ts: number;
  /** Type-specific payload, opaque to the transport layer. */
  payload: HelloPayload | MessagePayload | PresencePayload;
  /**
   * Detached Ed25519 signature over the canonical packet (sig field
   * excluded). Required for `hello` and `message` packets. Optional
   * for `presence`.
   */
  sig?: string; // base64
}

export interface HelloPayload {
  /** Protocol features supported by the sender. */
  features: string[];
  /**
   * SPKI bytes of the sender's Ed25519 public key, base64. This is the only
   * place where the public key is transmitted, which keeps every other
   * packet small.
   */
  pk: string;
}

export interface MessagePayload {
  /** Encrypted content. */
  enc: EncryptedPayload;
}

export interface PresencePayload {
  /** Current presence info, e.g. typing. Reserved for future use. */
  state: 'online' | 'typing' | 'away';
}

/** Shape of a single chat message displayed in the timeline. */
export interface ChatMessage {
  /** Unique id, generated locally. */
  id: string;
  /** Sender nick. */
  nick: string;
  /** Decrypted plaintext, or undefined when not decryptable. */
  text?: string;
  /** Original wire payload (used for "Show Raw"). */
  raw?: string;
  /** Whether the message is end-to-end encrypted. */
  encrypted: boolean;
  /** True if decryption failed but the message was a protocol packet. */
  undecryptable?: boolean;
  /** True if the signature failed verification. */
  signatureInvalid?: boolean;
  /** True if this is a self-authored message. Determined by the local
   *  sending context, not by comparing fingerprints. */
  self: boolean;
  /** Local id of the outgoing message (only set when self === true). */
  outgoingId?: string;
  /** Epoch millis when the message was rendered. */
  ts: number;
}
