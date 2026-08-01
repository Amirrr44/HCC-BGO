/**
 * [HCC:1] — the secure-hackchat protocol that runs *on top of* plain
 * hack.chat messages.
 *
 * Because the server is immutable, all coordination is encoded as ordinary
 * chat messages that happen to look like `[HCC:1]<json>`. Users of the stock
 * hack.chat client will simply see the text, which is the desired behavior.
 *
 * Wire format:
 *
 *     [HCC:1]{"v":1,"t":"hello",...}
 *     [HCC:1]{"v":1,"t":"message",...}
 *     [HCC:1]{"v":1,"t":"presence",...}
 *
 * The header is followed by a single space and then a JSON body. Optional
 * `sig` field carries a base64 Ed25519 signature over the canonical
 * representation of the packet with the `sig` field stripped.
 */

import type { SecurePacket } from '../../types';

/** Magic header for the protocol. */
export const PROTOCOL_HEADER = '[HCC:1]';

/** Current protocol version. Bump when making a breaking change. */
export const PROTOCOL_VERSION = 1;

/** Protocol features advertised in the hello packet. */
export const SUPPORTED_FEATURES = ['aes-256-gcm', 'ed25519', 'presence-v1'];

/** Maximum age (in ms) of a packet we will still accept. */
const MAX_PACKET_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Try to parse a hack.chat text message as a [HCC:1] packet.
 * Returns the parsed packet or null if the text doesn't look like one.
 */
export function tryParsePacket(text: string): SecurePacket | null {
  if (!text.startsWith(PROTOCOL_HEADER)) return null;
  const body = text.slice(PROTOCOL_HEADER.length).trim();
  if (!body) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isSecurePacket(parsed)) return null;
  return parsed;
}

/** Type guard for SecurePacket. */
function isSecurePacket(value: unknown): value is SecurePacket {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.v !== PROTOCOL_VERSION) return false;
  if (typeof v.fp !== 'string' || !v.fp) return false;
  if (typeof v.ts !== 'number') return false;
  if (v.t !== 'hello' && v.t !== 'message' && v.t !== 'presence') return false;
  if (!('payload' in v)) return false;
  // We do NOT require `sig` at the parser level. The semantic
  // verification (signature must be present and valid) happens inside
  // the SecureChannel so we can surface a clear "unverified hello"
  // warning to the user, rather than silently dropping the packet at
  // the protocol layer.
  return true;
}

/** Serialize a packet to its wire representation. */
export function serializePacket(packet: SecurePacket): string {
  return `${PROTOCOL_HEADER} ${JSON.stringify(packet)}`;
}

/**
 * Produce a deterministic string used as the message to sign/verify. The
 * signature is computed over the JSON of the packet *with the `sig` field
 * omitted* and with the keys sorted in a stable order.
 */
export function canonicalizeForSigning(packet: SecurePacket): string {
  const { sig: _sig, ...rest } = packet;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

/** Convenience: detect whether a text message is a protocol packet. */
export function isProtocolMessage(text: string): boolean {
  return text.startsWith(PROTOCOL_HEADER);
}

/**
 * Validate a packet's freshness. Packets older than the threshold are
 * considered stale. We are deliberately generous with skew because clocks
 * may differ across machines.
 */
export function isFresh(packet: SecurePacket, now: number = Date.now()): boolean {
  const age = now - packet.ts;
  return age >= -MAX_PACKET_AGE_MS && age <= MAX_PACKET_AGE_MS;
}
