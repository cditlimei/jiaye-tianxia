import { useCallback, useEffect, useRef } from 'react';
import { mediaUrl } from '../lib/assets';
import type { Screen } from '../types';

const BGM_BY_SCREEN: Record<Screen, string> = {
  title: 'audio/bgm/bgm_select.mp3',
  lordSelect: 'audio/bgm/bgm_select.mp3',
  partnerSelect: 'audio/bgm/bgm_select.mp3',
  home: 'audio/bgm/bgm_home.mp3',
  battle: 'audio/bgm/bgm_battle.mp3'
};

export function useAudioManager(screen: Screen, soundEnabled: boolean) {
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const currentBgmRef = useRef<string | null>(null);
  const unlockedRef = useRef(false);

  const unlock = useCallback(() => {
    unlockedRef.current = true;
    if (bgmRef.current && soundEnabled) {
      void bgmRef.current.play().catch(() => undefined);
    }
  }, [soundEnabled]);

  const playSfx = useCallback(
    (path: string, volume = 0.42) => {
      if (!soundEnabled || typeof Audio === 'undefined') {
        return;
      }
      const sfx = new Audio(mediaUrl(path));
      sfx.volume = volume;
      void sfx.play().catch(() => undefined);
    },
    [soundEnabled]
  );

  useEffect(() => {
    if (typeof Audio === 'undefined') {
      return;
    }

    const nextPath = BGM_BY_SCREEN[screen];
    if (!bgmRef.current) {
      bgmRef.current = new Audio(mediaUrl(nextPath));
      bgmRef.current.loop = true;
      bgmRef.current.volume = 0.28;
      currentBgmRef.current = nextPath;
    }

    if (currentBgmRef.current !== nextPath) {
      bgmRef.current.pause();
      bgmRef.current = new Audio(mediaUrl(nextPath));
      bgmRef.current.loop = true;
      bgmRef.current.volume = screen === 'battle' ? 0.34 : 0.28;
      currentBgmRef.current = nextPath;
    }

    if (!soundEnabled) {
      bgmRef.current.pause();
      return;
    }

    if (unlockedRef.current) {
      void bgmRef.current.play().catch(() => undefined);
    }
  }, [screen, soundEnabled]);

  return { unlock, playSfx };
}
