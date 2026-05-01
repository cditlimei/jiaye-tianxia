import { useState } from 'react';
import type { Lord } from '../data/gameData';
import { partners } from '../data/gameData';
import { imageUrl } from '../lib/assets';
import type { GameState } from '../types';
import { GameButton } from './common/GameButton';
import { ImageWithFallback } from './common/ImageWithFallback';
import { ModalShell } from './common/ModalShell';

interface PartnerModalProps {
  state: GameState;
  lord: Lord;
  onClose: () => void;
  onRecruit: (partnerId: string) => boolean;
}

export function PartnerModal({ state, lord, onClose, onRecruit }: PartnerModalProps) {
  const [notice, setNotice] = useState('');

  return (
    <ModalShell title="伴侣招募" onClose={onClose}>
      <div className="partner-grid">
        {notice && <p className="partner-grid__notice">{notice}</p>}
        {partners.map((partner) => {
          const owned = state.ownedPartnerIds.includes(partner.id);
          const best = partner.bestMatchLordId === lord.id;
          const missingGold = Math.max(0, partner.recruitCost - state.gold);
          const bonusCopy = Object.entries(partner.bonus)
            .map(([key, value]) => `${translateBonus(key)} +${best ? Math.round((value ?? 0) * 1.3) : value}`)
            .join(' · ');

          return (
            <article key={partner.id} className={`partner-card ${best ? 'is-best' : ''}`}>
              <ImageWithFallback src={imageUrl(partner.imagePath, 256)} alt={partner.name} className="partner-card__image" />
              <div className="partner-card__body">
                <div className="partner-card__title">
                  <h3>{partner.name}</h3>
                  {best && <span>良缘</span>}
                </div>
                <p>{partner.description}</p>
                <strong>{bonusCopy}</strong>
                <GameButton
                  variant={owned ? 'ghost' : 'primary'}
                  disabled={owned}
                  onClick={() => {
                    if (onRecruit(partner.id)) {
                      setNotice(`${partner.name}已入府。`);
                      return;
                    }
                    setNotice(missingGold > 0 ? `金不足，还差 ${missingGold.toLocaleString()} 金。` : `${partner.name}已在府中。`);
                  }}
                >
                  {owned
                    ? '已招募'
                    : missingGold > 0
                      ? `差 ${missingGold.toLocaleString()} 金`
                      : `召集 · ${partner.recruitCost.toLocaleString()} 金`}
                </GameButton>
              </div>
            </article>
          );
        })}
      </div>
    </ModalShell>
  );
}

function translateBonus(key: string) {
  if (key === 'strength') return '武力';
  if (key === 'intelligence') return '智谋';
  return '声望';
}
