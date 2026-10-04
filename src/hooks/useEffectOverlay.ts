import { useCallback, useRef, useState } from 'react';
import { imageUrl, mediaUrl } from '../lib/assets';

export interface EffectOverlayState {
  src: string;
  image?: string;
  poster?: string;
  title: string;
}

interface PlayEffectOptions {
  videoPath: string;
  /** 不放视频、只展示一张图时填这个 */
  imagePath?: string;
  posterPath?: string;
  title: string;
  fallbackMs?: number;
}

export function useEffectOverlay() {
  const [overlay, setOverlay] = useState<EffectOverlayState | null>(null);
  const resolverRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<number | null>(null);
  const playingRef = useRef(false);

  const finishEffect = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOverlay(null);
    resolverRef.current?.();
    resolverRef.current = null;
    playingRef.current = false;
  }, []);

  const playEffect = useCallback(
    (options: PlayEffectOptions) => {
      if (!options.videoPath && !options.imagePath) {
        return Promise.resolve();
      }

      if (playingRef.current) {
        return Promise.resolve();
      }

      playingRef.current = true;

      return new Promise<void>((resolve) => {
        resolverRef.current = resolve;
        setOverlay({
          src: options.videoPath ? mediaUrl(options.videoPath) : '',
          image: options.imagePath ? imageUrl(options.imagePath, 640) : undefined,
          poster: options.posterPath ? mediaUrl(options.posterPath) : undefined,
          title: options.title
        });
        timerRef.current = window.setTimeout(finishEffect, options.fallbackMs ?? 2600);
      });
    },
    [finishEffect]
  );

  return { overlay, playEffect, finishEffect };
}
