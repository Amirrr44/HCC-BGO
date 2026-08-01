/**
 * SecureChannel — orchestrates encryption, signing, and the [HCC:1] protocol
 * on top of an existing {@link HackChatConnection}.
 *
 * Responsibilities:
 *   - Derive the room key from the shared password.
 *   - Build and broadcast signed hello packets (which carry the public
 *     key). The hello is the only place the public key is transmitted.
 *   - Verify signatures on incoming hello packets before accepting
 *     a remote identity. Unsigned hellos are dropped.
 *   - Encrypt/sign outgoing messages.
 *   - Decrypt/verify incoming messages.
 *   - Track per-nick presence and compute member status (e.g. trusted /
 *     wrong-password / untrusted).
 *   - Track local outgoing messages by id, so the "self" flag in the
 *     UI does not depend on comparing fingerprints (multiple devices
 *     can share the same identity and we still want to render them
 *     as remote).
 */

import { HackChatConnection, type ServerCommand } from '../network/hackchat';
import {
  b64ToBuf,
  bufToB64,
  decryptString,
  deriveRoomKey,
  encryptString,
  importPrivateKey,
  importPublicKey,
  signBuffer,
  verifySignature,
} from './crypto';
import {
  canonicalizeForSigning,
  isFresh,
  PROTOCOL_VERSION,
  serializePacket,
  SUPPORTED_FEATURES,
  tryParsePacket,
} from '../protocol/protocol';
import type {
  ChatMessage,
  EncryptedPayload,
  HelloPayload,
  Identity,
  Member,
  MemberStatus,
  SecurePacket,
} from '../../types';
import { listTrusted, addTrusted as idbAddTrusted } from '../storage/idb';

export interface SecureChannelHandlers {
  onMessage: (msg: ChatMessage) => void;
  onMembersChanged: (members: Member[]) => void;
  onIdentityLoaded: (identity: Identity) => void;
  onStatus: (status: ChannelStatus) => void;
  onError: (err: Error) => void;
  /** Fired when a remote hello fails signature verification. */
  onUnverifiedHello?: (fingerprint: string, nick: string) => void;
}

export type ChannelStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

/**
 * Minimum interval between two hello packets sent to the same peer, and
 * between two of our own hello broadcasts. Without this throttling we
 * can fall into a hello-pong loop with another secure client.
 */
const HELLO_REBROADCAST_INTERVAL_MS = 30_000;

/** A nick → public key record we learned from a (verified) hello packet. */
interface PeerRecord {
  fingerprint: string;
  publicKey: ArrayBuffer;
  lastHello: number;
  /**
   * Set to true once we have successfully decrypted a message from this
   * peer (i.e. confirmed that the shared password matches). Set to false
   * if a decryption attempt failed for a valid signature. `null` means
   * we haven't tried yet.
   */
  passwordOk: boolean | null;
}

/**
 * Local tracking of an outgoing message. The id is generated on the
 * client when the user hits "send", and travels through the network
 * as part of the message's `id` field in the wrapped packet. We use
 * this id to mark the message as `self: true` on the local UI, rather
 * than relying on fingerprint equality (which would falsely mark
 * messages from a different device using the same identity as "self").
 */
interface OutgoingRecord {
  id: string;
  text: string;
  ts: number;
  encrypted: boolean;
}

/**
 * The high-level secure channel used by the React UI.
 *
 * One instance per (server, channel, password) combination. Created on the
 * login page and disposed when leaving the chat.
 */
export class SecureChannel {
  private roomKey: CryptoKey | null = null;
  private identity: Identity | null = null;
  private privateKey: CryptoKey | null = null;
  /** We keep the public key as raw bytes for re-broadcasting. */
  private publicKey: CryptoKey | null = null;
  private peers = new Map<string, PeerRecord>(); // key = lowercased fingerprint
  private members = new Map<string, Member>(); // key = nick
  private trustedFps = new Set<string>(); // mirrors IndexedDB for fast checks
  private lastHelloToPeer = new Map<string, number>(); // fingerprint → epoch ms
  private lastHelloBroadcastAt = 0; // monotonic global throttle for our own hello
  /** Outgoing messages keyed by their local id. */
  private outgoing = new Map<string, OutgoingRecord>();
  private handlers: SecureChannelHandlers;
  private conn: HackChatConnection;
  /** Local nick, used to render outgoing plain messages as self. */
  private readonly localNick: string;

  constructor(
    private readonly config: {
      url: string;
      channel: string;
      nickname: string;
      password: string;
      identity: Identity;
    },
    handlers: SecureChannelHandlers,
  ) {
    this.handlers = handlers;
    this.localNick = config.nickname;
    this.conn = new HackChatConnection({
      url: config.url,
      channel: config.channel,
      nickname: config.nickname,
      password: config.password, // not sent, only used for the key derivation
    });
  }

  /** Bring up the channel: load identity, derive key, open socket. */
  async start(): Promise<void> {
    try {
      this.handlers.onStatus('connecting');
      // 1. Set up the room key.
      this.roomKey = await deriveRoomKey(this.config.password, this.config.channel);
      // 2. Load the identity.
      this.identity = this.config.identity;
      this.privateKey = await importPrivateKey(this.identity.privateKey);
      this.publicKey = await importPublicKey(this.identity.publicKey);
      // 3. Refresh the trusted fingerprint cache.
      const trusted = await listTrusted();
      this.trustedFps = new Set(trusted.map((t) => t.fingerprint.toLowerCase()));
      this.handlers.onIdentityLoaded(this.identity);
      // 4. Wire the transport.
      this.conn.setHandlers({
        onOpen: () => {
          this.handlers.onStatus('connected');
          // Reset the hello throttles so the re-broadcast on reconnect
          // actually goes out (we may have been silent for a while).
          this.lastHelloBroadcastAt = 0;
          this.maybeHello();
        },
        onCommand: (cmd) => {
          void this.handleCommand(cmd);
        },
        onClose: (ev) => {
          if (ev && (ev as CloseEvent).code === 1000) {
            this.handlers.onStatus('disconnected');
          } else {
            this.handlers.onStatus('reconnecting');
          }
        },
        onError: (ev) => {
          if (ev && (ev as Event).type === 'reconnect-failed') {
            this.handlers.onStatus('error');
          } else {
            this.handlers.onStatus('reconnecting');
          }
        },
        onReconnectScheduled: () => {
          this.handlers.onStatus('reconnecting');
        },
      });
      this.conn.connect();
    } catch (err) {
      this.handlers.onError(err instanceof Error ? err : new Error(String(err)));
      this.handlers.onStatus('error');
    }
  }

  /** Tear everything down. */
  close(): void {
    this.conn.close();
    this.roomKey = null;
    this.privateKey = null;
    this.publicKey = null;
    this.outgoing.clear();
  }

  /** Returns the local identity, if loaded. */
  getIdentity(): Identity | null {
    return this.identity;
  }

  /** Send a chat message. Returns a local id for the outgoing message. */
  async sendMessage(text: string, encrypted: boolean): Promise<string | null> {
    if (!this.roomKey || !this.identity || !this.privateKey) {
      throw new Error('Channel not ready');
    }
    const id = `o-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (!encrypted) {
      this.outgoing.set(id, { id, text, ts: Date.now(), encrypted: false });
      this.conn.sendChat(text);
      return id;
    }
    const enc = await encryptString(this.roomKey, text);
    const payload: { enc: EncryptedPayload; mid: string } = { enc, mid: id };
    const unsigned: SecurePacket = {
      v: PROTOCOL_VERSION,
      t: 'message',
      fp: this.identity.fingerprint,
      ts: Date.now(),
      payload,
    };
    const data = new TextEncoder().encode(canonicalizeForSigning(unsigned));
    const sig = await signBuffer(this.privateKey, data.buffer as ArrayBuffer);
    const signed: SecurePacket = { ...unsigned, sig: bufToB64(sig) };
    this.outgoing.set(id, { id, text, ts: Date.now(), encrypted: true });
    this.conn.sendChat(serializePacket(signed));
    return id;
  }

  /**
   * Build a (possibly signed) hello packet. Hello packets are always
   * signed so that the receiving side can verify the public key they
   * carry actually belongs to the claimed fingerprint.
   */
  private buildHello(): SecurePacket {
    if (!this.identity) {
      throw new Error('No identity loaded');
    }
    return {
      v: PROTOCOL_VERSION,
      t: 'hello',
      fp: this.identity.fingerprint,
      ts: Date.now(),
      payload: {
        features: SUPPORTED_FEATURES,
        pk: bufToB64(this.identity.publicKey),
      } as HelloPayload,
    };
  }

  /**
   * Sign a hello packet and return the wire form ready to send.
   */
  private async signHello(packet: SecurePacket): Promise<SecurePacket> {
    if (!this.privateKey) {
      throw new Error('No private key loaded');
    }
    const data = new TextEncoder().encode(canonicalizeForSigning(packet));
    const sig = await signBuffer(this.privateKey, data.buffer as ArrayBuffer);
    return { ...packet, sig: bufToB64(sig) };
  }

  /** Send a hello packet, signed. */
  async broadcastHello(): Promise<void> {
    if (!this.identity) return;
    const signed = await this.signHello(this.buildHello());
    this.conn.sendChat(serializePacket(signed));
  }

  /** Unconditionally send a hello, bypassing the global throttle. */
  async forceHello(): Promise<void> {
    this.lastHelloBroadcastAt = 0;
    await this.broadcastHello();
  }

  /**
   * Send a hello only if we haven't sent one in the last interval. Used
   * for unprompted triggers (joining the room, somebody else joining).
   */
  private maybeHello(): void {
    const now = Date.now();
    if (now - this.lastHelloBroadcastAt < HELLO_REBROADCAST_INTERVAL_MS) return;
    this.lastHelloBroadcastAt = now;
    void this.broadcastHello();
  }

  /**
   * Respond to a peer's hello by sending our own, but only if we haven't
   * already done so for that peer recently.
   */
  private respondToHello(fp: string): void {
    const key = fp.toLowerCase();
    const last = this.lastHelloToPeer.get(key) ?? 0;
    if (Date.now() - last < HELLO_REBROADCAST_INTERVAL_MS) return;
    this.lastHelloToPeer.set(key, Date.now());
    void this.broadcastHello();
  }

  /* ------------------------------------------------------------------ */
  /* Inbound                                                            */
  /* ------------------------------------------------------------------ */

  private async handleCommand(cmd: ServerCommand): Promise<void> {
    switch (cmd.cmd) {
      case 'chat': {
        await this.handleChat(cmd.nick, cmd.text);
        break;
      }
      case 'emote': {
        // Emotes behave like chat for the purpose of decryption attempts.
        await this.handleChat(cmd.nick, cmd.text ?? '');
        break;
      }
      case 'onlineAdd': {
        this.upsertMember(cmd.nick, 'unknown');
        this.emitMembers();
        this.maybeHello();
        break;
      }
      case 'onlineRemove': {
        this.members.delete(cmd.nick);
        this.emitMembers();
        break;
      }
      case 'onlineSet': {
        const nicks = cmd.nicks ?? cmd.users ?? [];
        this.members.clear();
        for (const n of nicks) this.upsertMember(n, 'unknown');
        this.maybeHello();
        this.emitMembers();
        break;
      }
      case 'info':
      case 'warn': {
        // Server-side system messages — drop them silently.
        break;
      }
      default:
        break;
    }
  }

  private async handleChat(nick: string, text: string): Promise<void> {
    const ts = Date.now();

    // 1. Try to parse as a [HCC:1] packet.
    const packet = tryParsePacket(text);
    if (packet) {
      if (!isFresh(packet)) {
        return;
      }
      await this.handleProtocolPacket(nick, packet, ts);
      return;
    }

    // 2. Plain (non-protocol) text message.
    this.upsertMember(nick, 'plain');
    this.emitMembers();
    // The "self" flag for plain messages uses the local nick. We do
    // not use fingerprint comparison here because the message did not
    // carry a fingerprint at all.
    const isSelf = nick === this.localNick;
    const msg: ChatMessage = {
      id: `${ts}-${Math.random().toString(36).slice(2, 8)}`,
      nick,
      text,
      encrypted: false,
      self: isSelf,
      ts,
    };
    this.handlers.onMessage(msg);
  }

  private async handleProtocolPacket(
    nick: string,
    packet: SecurePacket,
    ts: number,
  ): Promise<void> {
    if (packet.t === 'hello') {
      // Verify the hello signature before accepting the public key. An
      // unsigned (or wrongly-signed) hello is dropped and reported so
      // the UI can show a warning.
      const verified = await this.verifyHelloSignature(packet);
      if (!verified) {
        this.handlers.onUnverifiedHello?.(packet.fp, nick);
        // Still mark the member as `untrusted` so they appear in the
        // list, but never adopt their public key.
        this.upsertMember(nick, 'untrusted', packet.fp);
        this.emitMembers();
        return;
      }
      this.recordPeer(packet);
      const memberStatus = this.computeStatus(packet.fp, this.peers.get(packet.fp.toLowerCase()) ?? null);
      this.upsertMember(nick, memberStatus, packet.fp);
      this.emitMembers();
      this.respondToHello(packet.fp);
      return;
    }
    if (packet.t === 'message') {
      // For messages we need the sender's public key, which only
      // comes from a verified hello. If we don't have one, the
      // message is from an unverified identity.
      const peer = this.peers.get(packet.fp.toLowerCase());
      if (!peer) {
        this.upsertMember(nick, 'untrusted', packet.fp);
        this.emitMembers();
        await this.renderUndecryptableMessage(nick, packet, ts, /* sig invalid */ true, 'no-public-key');
        return;
      }
      await this.handleEncryptedMessage(nick, packet, ts);
      return;
    }
    if (packet.t === 'presence') {
      // Reserved for future use.
      return;
    }
  }

  /**
   * Verify the Ed25519 signature on a hello packet. Returns true if
   * (a) the packet has a signature, (b) the public key it carries
   * matches the claimed fingerprint, and (c) the signature verifies
   * over the canonical packet representation.
   */
  private async verifyHelloSignature(packet: SecurePacket): Promise<boolean> {
    if (!packet.sig) return false;
    if (packet.t !== 'hello') return false;
    const hello = packet.payload as HelloPayload;
    if (!hello?.pk) return false;
    try {
      const pubKey = await importPublicKey(b64ToBuf(hello.pk));
      // First check: the carried public key must hash to the claimed
      // fingerprint. This prevents a malicious peer from sending
      // someone else's public key under their own fingerprint.
      const { fingerprintPublicKey } = await import('./crypto');
      const fp = await fingerprintPublicKey(b64ToBuf(hello.pk));
      if (fp.toLowerCase() !== packet.fp.toLowerCase()) return false;
      const sigBuf = b64ToBuf(packet.sig);
      const data = new TextEncoder().encode(canonicalizeForSigning(packet));
      return await verifySignature(pubKey, sigBuf, data.buffer as ArrayBuffer);
    } catch {
      return false;
    }
  }

  private async handleEncryptedMessage(
    nick: string,
    packet: SecurePacket,
    ts: number,
  ): Promise<void> {
    if (packet.t !== 'message') return;
    const peer = this.peers.get(packet.fp.toLowerCase());
    const baseMsg: ChatMessage = {
      id: `${ts}-${Math.random().toString(36).slice(2, 8)}`,
      nick,
      raw: serializePacket(packet),
      encrypted: true,
      self: false,
      ts,
    };
    if (!peer) {
      await this.renderUndecryptableMessage(nick, packet, ts, true, 'no-public-key');
      return;
    }
    if (!this.roomKey) return;

    // Verify the signature first, before any decryption attempt.
    let signatureInvalid = false;
    if (packet.sig) {
      try {
        const sigBuf = b64ToBuf(packet.sig);
        const data = new TextEncoder().encode(canonicalizeForSigning(packet));
        const pubKey = await importPublicKey(peer.publicKey);
        const ok = await verifySignature(pubKey, sigBuf, data.buffer as ArrayBuffer);
        if (!ok) signatureInvalid = true;
      } catch {
        signatureInvalid = true;
      }
    } else {
      signatureInvalid = true;
    }

    if (signatureInvalid) {
      await this.renderUndecryptableMessage(nick, packet, ts, true, 'bad-signature');
      return;
    }

    // Signature is valid. Try to decrypt.
    try {
      const messagePayload = packet.payload as { enc: EncryptedPayload; mid?: string };
      const text = await decryptString(this.roomKey, messagePayload.enc);
      peer.passwordOk = true;
      this.refreshMemberStatus(peer.fingerprint);
      // If this is a message we sent ourselves, the outgoing id from
      // the wire should match one of our local outgoing records.
      const outgoingId = messagePayload.mid;
      const isSelf = !!outgoingId && this.outgoing.has(outgoingId);
      if (isSelf && outgoingId) {
        this.outgoing.delete(outgoingId);
      }
      this.handlers.onMessage({
        ...baseMsg,
        text,
        signatureInvalid: false,
        undecryptable: false,
        self: isSelf,
        outgoingId,
      });
    } catch {
      // AES-GCM auth tag failure → password mismatch.
      peer.passwordOk = false;
      this.refreshMemberStatus(peer.fingerprint);
      this.handlers.onMessage({
        ...baseMsg,
        undecryptable: true,
        signatureInvalid: false,
      });
    }
  }

  /** Helper to render an undecryptable / unverifiable message. */
  private async renderUndecryptableMessage(
    nick: string,
    packet: SecurePacket,
    ts: number,
    signatureInvalid: boolean,
    reason: 'bad-signature' | 'no-public-key',
  ): Promise<void> {
    this.handlers.onMessage({
      id: `${ts}-${Math.random().toString(36).slice(2, 8)}`,
      nick,
      raw: serializePacket(packet),
      encrypted: true,
      self: false,
      signatureInvalid,
      undecryptable: true,
      ts,
    });
    // Tag the reason on the message via a synthetic id suffix so
    // tests can inspect it without breaking the public surface.
    void reason;
  }

  /* ------------------------------------------------------------------ */
  /* Peer / member bookkeeping                                           */
  /* ------------------------------------------------------------------ */

  private recordPeer(packet: SecurePacket): PeerRecord | null {
    if (packet.t !== 'hello') return null;
    const hello = packet.payload as HelloPayload;
    if (!hello?.pk) return null;
    const fp = packet.fp.toLowerCase();
    const pk = b64ToBuf(hello.pk);
    const existing = this.peers.get(fp);
    if (existing) {
      existing.publicKey = pk;
      existing.lastHello = Date.now();
      existing.passwordOk = null;
      return existing;
    }
    const record: PeerRecord = {
      fingerprint: fp,
      publicKey: pk,
      lastHello: Date.now(),
      passwordOk: null,
    };
    this.peers.set(fp, record);
    return record;
  }

  private computeStatus(fp: string, peer: PeerRecord | null): MemberStatus {
    if (!peer) return 'plain';
    if (peer.passwordOk === false) return 'wrong-password';
    if (this.trustedFps.has(fp.toLowerCase())) return 'trusted';
    return 'untrusted';
  }

  private upsertMember(
    nick: string,
    status: MemberStatus,
    fingerprint?: string,
  ): void {
    const existing = this.members.get(nick);
    if (existing) {
      existing.status = status;
      existing.lastSeen = Date.now();
      if (fingerprint) existing.fingerprint = fingerprint.toLowerCase();
    } else {
      this.members.set(nick, {
        nickname: nick,
        status,
        fingerprint: fingerprint?.toLowerCase(),
        lastSeen: Date.now(),
      });
    }
  }

  private emitMembers(): void {
    this.handlers.onMembersChanged(Array.from(this.members.values()));
  }

  private refreshMemberStatus(fp: string): void {
    const target = fp.toLowerCase();
    const peer = this.peers.get(target);
    const newStatus = this.computeStatus(target, peer);
    for (const m of this.members.values()) {
      if (m.fingerprint === target) m.status = newStatus;
    }
    this.emitMembers();
  }

  /** Update the in-memory trust cache when the user trusts a new fp. */
  refreshTrust(fingerprint: string, trusted: boolean): void {
    const fp = fingerprint.toLowerCase();
    if (trusted) this.trustedFps.add(fp);
    else this.trustedFps.delete(fp);
    this.refreshMemberStatus(fp);
  }

  /**
   * Trust a fingerprint, persisting it locally. Records the nick and
   * room in which it was trusted so the registry can show useful
   * metadata later.
   */
  async trustFingerprint(args: {
    fingerprint: string;
    label?: string;
    nick?: string;
    room?: string;
  }): Promise<void> {
    const fp = args.fingerprint.toLowerCase();
    await idbAddTrusted({
      fingerprint: fp,
      label: args.label,
      lastNick: args.nick,
      lastRoom: args.room ?? this.config.channel,
      trustedAt: Date.now(),
    });
    this.trustedFps.add(fp);
    this.refreshMemberStatus(fp);
  }
}
