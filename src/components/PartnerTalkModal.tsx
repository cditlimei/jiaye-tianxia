import { useMemo, useState } from 'react';
import type { Lord, Partner } from '../data/gameData';
import { imageUrl } from '../lib/assets';
import { GameButton } from './common/GameButton';
import { ImageWithFallback } from './common/ImageWithFallback';
import { ModalShell } from './common/ModalShell';

interface PartnerTalkModalProps {
  lord: Lord;
  ownedPartners: Partner[];
  onClose: () => void;
}

type TalkMode = 'tea' | 'music' | 'talk';

const MODE_COPY: Record<TalkMode, { label: string; line: string }> = {
  tea: { label: '品茶', line: '清茶入盏，府中事务可暂缓一刻。' },
  music: { label: '赏乐', line: '弦声渐起，军心与家望皆有所安。' },
  talk: { label: '对话', line: '妾愿听主公细说今日谋划。' }
};

export function PartnerTalkModal({ lord, ownedPartners, onClose }: PartnerTalkModalProps) {
  const firstPartner = ownedPartners[0] ?? null;
  const [selectedId, setSelectedId] = useState(firstPartner?.id ?? '');
  const [mode, setMode] = useState<TalkMode>('tea');
  const selectedPartner = useMemo(
    () => ownedPartners.find((partner) => partner.id === selectedId) ?? firstPartner,
    [firstPartner, ownedPartners, selectedId]
  );

  return (
    <ModalShell title="伴侣互动" onClose={onClose}>
      <div className="partner-talk">
        {!selectedPartner ? (
          <section className="partner-talk__empty">
            <h3>内庭未设</h3>
            <p>尚未有伴侣入府，请先在开局或招募中择定良缘。</p>
          </section>
        ) : (
          <>
            <section className="partner-talk__scene">
              <ImageWithFallback
                src={imageUrl(selectedPartner.imagePath, 640)}
                alt={selectedPartner.name}
                className="partner-talk__image"
                loading="eager"
              />
              <div className="partner-talk__bubble">
                <span>{lord.name} · 内庭</span>
                <p>{MODE_COPY[mode].line}</p>
              </div>
            </section>

            {ownedPartners.length > 1 && (
              <div className="partner-talk__switcher" aria-label="选择互动伴侣">
                {ownedPartners.map((partner) => (
                  <button
                    key={partner.id}
                    type="button"
                    className={partner.id === selectedPartner.id ? 'is-selected' : ''}
                    onClick={() => setSelectedId(partner.id)}
                  >
                    {partner.name}
                  </button>
                ))}
              </div>
            )}

            <section className="partner-talk__actions">
              {(Object.keys(MODE_COPY) as TalkMode[]).map((item) => (
                <GameButton
                  key={item}
                  variant={mode === item ? 'primary' : 'secondary'}
                  onClick={() => setMode(item)}
                >
                  {MODE_COPY[item].label}
                </GameButton>
              ))}
            </section>
          </>
        )}
      </div>
    </ModalShell>
  );
}
