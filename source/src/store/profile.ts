/**
 * Local user-profile store. Holds the nickname and favorite room, both
 * persisted in IndexedDB. There is no remote backing for these values
 * — they are pure local data.
 */

import { create } from 'zustand';
import { loadProfile, saveProfile } from '../services/storage/idb';
import type { UserProfile } from '../types';

interface ProfileState {
  ready: boolean;
  profile: UserProfile;
  setNickname: (nick: string) => Promise<void>;
  setFavoriteRoom: (room: string) => Promise<void>;
  init: () => Promise<void>;
}

const DEFAULT: UserProfile = {
  nickname: 'anon',
  favoriteRoom: 'lobby',
  updatedAt: 0,
};

export const useProfile = create<ProfileState>((set, get) => ({
  ready: false,
  profile: DEFAULT,

  setNickname: async (nick) => {
    const next: UserProfile = { ...get().profile, nickname: nick, updatedAt: Date.now() };
    set({ profile: next });
    await saveProfile(next);
  },

  setFavoriteRoom: async (room) => {
    const next: UserProfile = { ...get().profile, favoriteRoom: room, updatedAt: Date.now() };
    set({ profile: next });
    await saveProfile(next);
  },

  init: async () => {
    const stored = await loadProfile();
    if (stored) {
      set({ profile: stored, ready: true });
    } else {
      // Seed a default profile and persist it.
      const seed: UserProfile = { ...DEFAULT, updatedAt: Date.now() };
      await saveProfile(seed);
      set({ profile: seed, ready: true });
    }
  },
}));
