/**
 * Test harness: an in-process fake hack.chat server + a drop-in
 * replacement for HackChatConnection that talks to it. The shape
 * matches the real HackChatConnection closely so SecureChannel
 * works unmodified.
 */

import type { ServerConfig } from '../types';
import type { ServerCommand } from './network/hackchat';

export interface FakeClient {
  id: string;
  nick: string;
  /**
   * The server calls this to deliver a message to the client. The client
   * must only receive messages that originated from OTHER clients.
   */
  send: (data: string) => void;
  close: () => void;
}

export class FakeServer {
  clients = new Map<string, FakeClient>();

  register(client: FakeClient): void {
    this.clients.set(client.id, client);
    // Notify existing clients that someone has joined, matching hack.chat
    // behavior (the server sends `onlineAdd` to the rest of the room).
    for (const [id, c] of this.clients) {
      if (id === client.id) continue;
      queueMicrotask(() =>
        c.send(JSON.stringify({ cmd: 'onlineAdd', nick: client.nick })),
      );
    }
  }

  unregister(id: string): void {
    const leaving = this.clients.get(id);
    this.clients.delete(id);
    if (leaving) {
      // Notify remaining clients.
      for (const [, c] of this.clients) {
        queueMicrotask(() =>
          c.send(JSON.stringify({ cmd: 'onlineRemove', nick: leaving.nick })),
        );
      }
    }
  }

  /** Forward a chat/emote payload to all other clients. */
  broadcast(fromId: string, payload: ServerCommand): void {
    const text = JSON.stringify(payload);
    for (const [id, c] of this.clients) {
      if (id === fromId) continue;
      queueMicrotask(() => c.send(text));
    }
  }

  /** Send a payload to a specific client (rarely used in tests). */
  sendTo(target: string, payload: ServerCommand): void {
    const c = this.clients.get(target);
    if (!c) return;
    queueMicrotask(() => c.send(JSON.stringify(payload)));
  }

  /** Snapshot of the user list, with `joiner` listed first. */
  onlineSetFor(joiner: string): string[] {
    return [joiner, ...Array.from(this.clients.keys()).filter((n) => n !== joiner)];
  }

  /** Clear all registered clients. */
  reset(): void {
    this.clients.clear();
  }
}

export const globalFakeServer = new FakeServer();

export interface TestHandlers {
  onCommand?: (cmd: ServerCommand) => void;
  onOpen?: () => void;
  onClose?: (ev: unknown) => void;
  onError?: (ev: unknown) => void;
}

export class FakeHackChatConnection {
  public serverUrl: string;
  public channel: string;
  public nickname: string;
  public password: string;
  private socketId: string;
  private handlers: TestHandlers = {};
  private client: FakeClient | null = null;

  constructor(config: ServerConfig) {
    this.serverUrl = config.url;
    this.channel = config.channel;
    this.nickname = config.nickname;
    this.password = config.password;
    this.socketId = config.nickname;
  }

  setHandlers(h: TestHandlers): void {
    this.handlers = h;
  }

  connect(): void {
    const send = (data: string) => {
      let cmd: ServerCommand;
      try {
        cmd = JSON.parse(data);
      } catch {
        return;
      }
      if (cmd.cmd === 'join') {
        const nick = (cmd.nick as string) || this.nickname;
        this.socketId = nick;
        const client: FakeClient = {
          id: nick,
          nick,
          send: (frame) => {
            let parsed: ServerCommand;
            try {
              parsed = JSON.parse(frame);
            } catch {
              return;
            }
            queueMicrotask(() => this.handlers.onCommand?.(parsed));
          },
          close: () => {
            globalFakeServer.unregister(nick);
            this.handlers.onClose?.({ code: 1000 });
          },
        };
        this.client = client;
        globalFakeServer.register(client);
        // Send hello + initial online set to the joiner.
        queueMicrotask(() => this.handlers.onCommand?.({ cmd: 'hello' }));
        queueMicrotask(() =>
          this.handlers.onCommand?.({
            cmd: 'onlineSet',
            nicks: globalFakeServer.onlineSetFor(nick),
          }),
        );
        queueMicrotask(() => this.handlers.onOpen?.());
        return;
      }
      if (cmd.cmd === 'chat' || cmd.cmd === 'emote') {
        const wire = { ...cmd, nick: this.socketId } as ServerCommand;
        globalFakeServer.broadcast(this.socketId, wire);
        return;
      }
      // Other commands (e.g. ping) are no-ops.
    };
    queueMicrotask(() =>
      send(
        JSON.stringify({
          cmd: 'join',
          channel: this.channel,
          nick: this.nickname,
        }),
      ),
    );
  }

  sendChat(text: string): void {
    if (!this.client) return;
    const wire = { cmd: 'chat', text, nick: this.socketId } as ServerCommand;
    globalFakeServer.broadcast(this.socketId, wire);
  }

  send(cmd: Record<string, unknown>): void {
    if (!this.client) return;
    if (cmd.cmd === 'chat' || cmd.cmd === 'emote') {
      const wire = { ...cmd, nick: this.socketId } as ServerCommand;
      globalFakeServer.broadcast(this.socketId, wire);
    }
  }

  close(): void {
    if (this.client) {
      globalFakeServer.unregister(this.client.id);
      this.client = null;
    }
    // Notify handlers that the connection has dropped. In real hack.chat
    // the WebSocket fires a `close` event; we mirror that here so the
    // SecureChannel's reconnect logic engages.
    this.handlers.onClose?.({ code: 1006 } as unknown as CloseEvent);
  }
}
