import { useMemo, useState } from 'react';
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
  const sortedPartners = useMemo(
    () =>
      [...partners].sort((left, right) => {
        const leftOwned = state.ownedPartnerIds.includes(left.id);
        const rightOwned = state.ownedPartnerIds.includes(right.id);
        const leftScore =
          (left.bestMatchLordId === lord.id ? -3 : 0) + (leftOwned ? 10 : 0) + (state.gold >= left.recruitCost ? -1 : 0);
        const rightScore =
          (right.bestMatchLordId === lord.id ? -3 : 0) + (rightOwned ? 10 : 0) + (state.gold >= right.recruitCost ? -1 : 0);
        return leftScore - rightScore;
      }),
    [lord.id, state.gold, state.ownedPartnerIds]
  );

  return (
    <ModalShell title="伴侣招募" onClose={onClose}>
      <div className="partner-market">
        <div className="partner-market__summary">
          <div>
            <span>府库</span>
            <strong>{state.gold.toLocaleString()} 金</strong>
          </div>
          <div>
            <span>已入府</span>
            <strong>{state.ownedPartnerIds.length}/{partners.length}</strong>
          </div>
          <div>
            <span>主公</span>
            <strong>{lord.name}</strong>
          </div>
        </div>
        {notice && (
          <p className="partner-market__notice" role="status">
            {notice}
          </p>
        )}
        <div className="partner-grid">
          {sortedPartners.map((partner) => {
            const owned = state.ownedPartnerIds.includes(partner.id);
            const best = partner.bestMatchLordId === lord.id;
            const missingGold = Math.max(0, partner.recruitCost - state.gold);
            const bonusCopy = Object.entries(partner.bonus)
              .map(([key, value]) => `${translateBonus(key)} +${best ? Math.round((value ?? 0) * 1.3) : value}`)
              .join(' · ');

            return (
              <article key={partner.id} className={`partner-card ${best ? 'is-best' : ''} ${owned ? 'is-owned' : ''}`}>
                <div className="partner-card__portrait">
                  <ImageWithFallback src={imageUrl(partner.imagePath, best ? 384 : 256)} alt={partner.name} className="partner-card__image" />
                  <span>{owned ? '已入府' : best ? '良缘推荐' : '可召集'}</span>
                </div>
                <div className="partner-card__body">
                  <div className="partner-card__title">
                    <h3>{partner.name}</h3>
                    <em>{best ? '良缘' : partner.recruitCost.toLocaleString()}</em>
                  </div>
                  <p>{partner.description}</p>
                  <strong>{bonusCopy}</strong>
                  <GameButton
                    variant={owned ? 'ghost' : missingGold > 0 ? 'secondary' : 'primary'}
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
      </div>
    </ModalShell>
  );
}

function translateBonus(key: string) {
  if (key === 'strength') return '武力';
  if (key === 'intelligence') return '智谋';
  return '声望';
}
