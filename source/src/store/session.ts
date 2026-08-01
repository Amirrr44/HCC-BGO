/**
 * Global session store. Holds the connection configuration, the active
 * secure channel, the current identity, the chat history, and the
 * member list. The store is the single source of truth for the React
 * tree.
 *
 * Note: the nickname is now sourced from the user profile (see
 * `useProfile`). It is no longer part of the login form, and is read
 * at connect time.
 */

import { create } from 'zustand';
import { SecureChannel, type ChannelStatus } from '../services/crypto/secureChannel';
import { getOrCreateIdentity } from '../services/crypto/identity';
import { formatFingerprint } from '../services/crypto/crypto';
import type { ChatMessage, Identity, Member } from '../types';
import { useProfile } from './profile';

export interface SessionState {
  /* Connection config (no nickname — comes from the profile) */
  serverUrl: string;
  channel: string;
  password: string;
  /** Active nickname at the time of connect (read from the profile). */
  activeNickname: string;

  /* Live state */
  status: ChannelStatus;
  identity: Identity | null;
  identityFingerprintDisplay: string;
  channelInstance: SecureChannel | null;
  messages: ChatMessage[];
  members: Member[];
  lastError: string | null;
  unverifiedHellos: { fingerprint: string; nick: string; ts: number }[];

  /* Actions */
  setCredentials: (c: { serverUrl: string; channel: string; password: string }) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendMessage: (text: string, encrypted: boolean) => Promise<void>;
  clearMessages: () => void;
  setError: (err: string | null) => void;
}

export const useSession = create<SessionState>((set, get) => ({
  serverUrl: 'https://hack.chat',
  channel: '',
  password: '',
  activeNickname: '',
  status: 'idle',
  identity: null,
  identityFingerprintDisplay: '',
  channelInstance: null,
  messages: [],
  members: [],
  lastError: null,
  unverifiedHellos: [],

  setCredentials: (c) =>
    set({
      serverUrl: c.serverUrl,
      channel: c.channel,
      password: c.password,
    }),

  connect: async () => {
    const { serverUrl, channel, password, channelInstance: existing } = get();
    if (!serverUrl || !channel) {
      set({ lastError: 'Please fill in the room name.' });
      return;
    }
    const profile = useProfile.getState().profile;
    if (!profile.nickname.trim()) {
      set({ lastError: 'Please set a nickname in your profile first.' });
      return;
    }
    if (existing) existing.close();
    set({
      status: 'connecting',
      lastError: null,
      messages: [],
      members: [],
      unverifiedHellos: [],
      activeNickname: profile.nickname,
    });
    const identity = await getOrCreateIdentity();
    const channelInstance = new SecureChannel(
      { url: serverUrl, channel, nickname: profile.nickname, password, identity },
      {
        onMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
        onMembersChanged: (members) => set({ members }),
        onIdentityLoaded: (identity) =>
          set({ identity, identityFingerprintDisplay: formatFingerprint(identity.fingerprint) }),
        onStatus: (status) => set({ status }),
        onError: (err) => set({ lastError: err.message, status: 'error' }),
        onUnverifiedHello: (fingerprint, nick) =>
          set((s) => ({
            unverifiedHellos: [
              ...s.unverifiedHellos,
              { fingerprint, nick, ts: Date.now() },
            ].slice(-10),
          })),
      },
    );
    set({ channelInstance, identity, identityFingerprintDisplay: formatFingerprint(identity.fingerprint) });
    await channelInstance.start();
  },

  disconnect: () => {
    const ch = get().channelInstance;
    ch?.close();
    set({ channelInstance: null, status: 'disconnected', members: [], messages: [] });
  },

  sendMessage: async (text, encrypted) => {
    const ch = get().channelInstance;
    if (!ch) return;
    try {
      await ch.sendMessage(text, encrypted);
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) });
    }
  },

  clearMessages: () => set({ messages: [] }),

  setError: (err) => set({ lastError: err }),
}));
