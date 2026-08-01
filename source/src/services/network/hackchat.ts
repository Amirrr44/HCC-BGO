/**
 * WebSocket transport for hack.chat.
 *
 * The hack.chat protocol is text-based JSON over a single WebSocket. The
 * server speaks first with `{cmd: "hello"}` and a list of commands, then
 * clients send `{cmd: "join", channel, nick}` to enter a room. Subsequent
 * chat messages arrive as `{cmd: "chat", nick, text, ...}`.
 *
 * This file implements the *transport* only — it knows nothing about
 * encryption, identity, or the [HCC:1] protocol. Higher layers wrap it.
 */

import type { ServerConfig } from '../../types';

/** Raw commands the hack.chat server can send us. */
export type ServerCommand =
  | { cmd: 'hello'; mods?: string[]; servers?: string[] }
  | { cmd: 'chat'; nick: string; text: string; trip?: string }
  | { cmd: 'info'; type?: string; text?: string; info?: string }
  | { cmd: 'warn'; text: string }
  | { cmd: 'onlineAdd'; nick: string; users?: string[] }
  | { cmd: 'onlineRemove'; nick: string; users?: string[] }
  | { cmd: 'onlineSet'; nicks?: string[]; users?: string[] }
  | { cmd: 'emote'; nick: string; type?: string; text?: string }
  | { cmd: 'cookie'; hash?: string }
  | { cmd: 'cors' }
  | { cmd: string; [k: string]: unknown };

/** Hooks the consumer can register. */
export interface HackChatHandlers {
  onCommand?: (cmd: ServerCommand) => void;
  onOpen?: () => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: (ev: Event) => void;
  /** Fired when an automatic reconnect attempt is scheduled. */
  onReconnectScheduled?: (delayMs: number, attempt: number) => void;
}

/** Strip trailing slash and convert https:// -> wss:// */
function toWebSocketUrl(serverUrl: string): string {
  let url = serverUrl.trim();
  if (url.endsWith('/')) url = url.slice(0, -1);
  url = url.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return url;
}

/**
 * Extract the host (with scheme) from a server address. The hack.chat
 * WebSocket endpoint is always served at `/chat-ws` on the origin host,
 * regardless of whether the user typed `https://hack.chat` or
 * `https://hack.chat/anything`.
 */
function hostOnly(serverUrl: string): string {
  return toWebSocketUrl(serverUrl);
}

/** A single live connection to a hack.chat room. */
export class HackChatConnection {
  private ws: WebSocket | null = null;
  private handlers: HackChatHandlers = {};
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private explicitlyClosed = false;
  private reconnectAttempt = 0;
  /** Maximum number of automatic reconnect attempts. */
  private static readonly MAX_RECONNECT_ATTEMPTS = 8;
  /** Base delay for the exponential-backoff schedule. */
  private static readonly RECONNECT_BASE_MS = 750;

  constructor(private readonly config: ServerConfig) {}

  /** Register event handlers. Idempotent; later calls overwrite. */
  setHandlers(handlers: HackChatHandlers): void {
    this.handlers = handlers;
  }

  /** Open the WebSocket and join the room. */
  connect(): void {
    // The hack.chat WebSocket endpoint is `/chat-ws` on the host. The
    // server is immutable and always serves it at that path.
    const url = `${hostOnly(this.config.url)}/chat-ws`;
    this.explicitlyClosed = false;
    this.reconnectAttempt = 0;
    this.openSocket(url);
  }

  private openSocket(url: string): void {
    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      // Synchronous construction failure (e.g. invalid URL). Surface as
      // a close so the consumer can decide what to do.
      this.handlers.onClose?.({ code: 1006, reason: String(err) } as CloseEvent);
      return;
    }

    this.ws.addEventListener('open', () => {
      this.reconnectAttempt = 0;
      this.send({ cmd: 'join', channel: this.config.channel, nick: this.config.nickname });
      // hack.chat recommends pinging every 50s to keep the connection alive
      this.pingTimer = setInterval(() => {
        this.send({ cmd: 'ping' });
      }, 50_000);
      this.handlers.onOpen?.();
    });

    this.ws.addEventListener('message', (ev) => {
      let parsed: ServerCommand | null = null;
      try {
        parsed = JSON.parse(ev.data as string) as ServerCommand;
      } catch {
        // ignore malformed frames
        return;
      }
      if (parsed) this.handlers.onCommand?.(parsed);
    });

    this.ws.addEventListener('close', (ev) => {
      this.cleanup();
      this.handlers.onClose?.(ev);
      if (!this.explicitlyClosed) this.scheduleReconnect(url);
    });

    this.ws.addEventListener('error', (ev) => {
      this.handlers.onError?.(ev);
    });
  }

  private scheduleReconnect(url: string): void {
    if (this.reconnectAttempt >= HackChatConnection.MAX_RECONNECT_ATTEMPTS) {
      this.handlers.onError?.(new Event('reconnect-failed'));
      return;
    }
    const delay =
      HackChatConnection.RECONNECT_BASE_MS * 2 ** this.reconnectAttempt;
    const attempt = this.reconnectAttempt + 1;
    this.reconnectAttempt = attempt;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.explicitlyClosed) return;
      this.openSocket(url);
    }, delay);
    this.handlers.onReconnectScheduled?.(delay, attempt);
  }

  /** Send a chat message. */
  sendChat(text: string): void {
    this.send({ cmd: 'chat', text });
  }

  /** Send a custom command (e.g. emote). */
  send(cmd: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(cmd));
  }

  /** Close the connection cleanly. Cancels any pending reconnect. */
  close(): void {
    this.explicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    this.ws?.close();
    this.ws = null;
  }

  private cleanup(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
