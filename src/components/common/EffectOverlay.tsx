import type { EffectOverlayState } from '../../hooks/useEffectOverlay';

interface EffectOverlayProps {
  overlay: EffectOverlayState;
  onFinish: () => void;
}

export function EffectOverlay({ overlay, onFinish }: EffectOverlayProps) {
  return (
    <div className="effect-overlay">
      <div className="effect-overlay__frame">
        {overlay.image ? (
          <img className="effect-overlay__image" src={overlay.image} alt="" />
        ) : (
          <video
            src={overlay.src}
            poster={overlay.poster}
            autoPlay
            muted
            playsInline
            onEnded={onFinish}
            onError={onFinish}
          />
        )}
        <div className="effect-overlay__title">{overlay.title}</div>
      </div>
    </div>
  );
}

