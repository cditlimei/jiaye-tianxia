import { useCallback, useRef, useState } from 'react';
import { mediaUrl } from '../lib/assets';

export interface EffectOverlayState {
  src: string;
  poster?: string;
  title: string;
}

interface PlayEffectOptions {
  videoPath: string;
  posterPath?: string;
  title: string;
  fallbackMs?: number;
}

export function useEffectOverlay() {
  const [overlay, setOverlay] = useState<EffectOverlayState | null>(null);
  const resolverRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<number | null>(null);

  const finishEffect = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOverlay(null);
    resolverRef.current?.();
    resolverRef.current = null;
  }, []);

  const playEffect = useCallback(
    (options: PlayEffectOptions) => {
      if (!options.videoPath) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        resolverRef.current = resolve;
        setOverlay({
          src: mediaUrl(options.videoPath),
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

