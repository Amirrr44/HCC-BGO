/**
 * QR code utilities. We use the `qrcode` package to render QR codes
 * for our local data (room QR, profile QR) and `jsqr` to decode QR
 * codes captured from the camera.
 *
 * The QR payloads are deliberately restricted to non-sensitive data:
 *   - Room QR: { server, channel }
 *   - Profile QR: { nick, fingerprint, room }
 *
 * The shared password and the private key are NEVER included.
 */

import QRCode from 'qrcode';
import jsQR from 'jsqr';

/** Build the JSON payload for a room QR. */
export function buildRoomPayload(server: string, channel: string): string {
  return JSON.stringify({ kind: 'shc.room', v: 1, server, channel });
}

/** Build the JSON payload for a profile QR. */
export function buildProfilePayload(args: {
  nickname: string;
  fingerprint: string;
  room: string;
}): string {
  return JSON.stringify({
    kind: 'shc.profile',
    v: 1,
    nickname: args.nickname,
    fingerprint: args.fingerprint,
    room: args.room,
  });
}

/** Render a QR code as a data URL (PNG). */
export async function renderQrDataUrl(text: string, size = 256): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: {
      // Let the QR match the theme; we use a dark amber on cream
      // (light) or light amber on warm-black (dark). The QR
      // generator is theme-agnostic, so we just pick a foreground
      // color with high contrast.
      dark: '#2A1F12',
      light: '#FFFAF0',
    },
  });
}

/** Decode a QR code from raw pixel data. */
export function decodeQr(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  const result = jsQR(data, width, height, {
    inversionAttempts: 'attemptBoth',
  });
  return result?.data ?? null;
}

/**
 * Parsed contents of a QR code we know about. We deliberately only
 * accept payloads we recognize; an unknown payload is ignored.
 */
export type QrPayload =
  | { kind: 'shc.room'; v: 1; server: string; channel: string }
  | { kind: 'shc.profile'; v: 1; nickname: string; fingerprint: string; room: string };

export function parseQrPayload(text: string): QrPayload | null {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (o.kind === 'shc.room' && o.v === 1) {
    if (typeof o.server !== 'string' || typeof o.channel !== 'string') return null;
    return { kind: 'shc.room', v: 1, server: o.server, channel: o.channel };
  }
  if (o.kind === 'shc.profile' && o.v === 1) {
    if (typeof o.nickname !== 'string' || typeof o.fingerprint !== 'string' || typeof o.room !== 'string') {
      return null;
    }
    return {
      kind: 'shc.profile',
      v: 1,
      nickname: o.nickname,
      fingerprint: o.fingerprint,
      room: o.room,
    };
  }
  return null;
}
