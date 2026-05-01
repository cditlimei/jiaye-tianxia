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
  onRecruit: (partnerId: string) => void;
}

export function PartnerModal({ state, lord, onClose, onRecruit }: PartnerModalProps) {
  return (
    <ModalShell title="伴侣招募" onClose={onClose}>
      <div className="partner-grid">
        {partners.map((partner) => {
          const owned = state.ownedPartnerIds.includes(partner.id);
          const best = partner.bestMatchLordId === lord.id;
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
                  disabled={owned || state.gold < partner.recruitCost}
                  onClick={() => onRecruit(partner.id)}
                >
                  {owned ? '已招募' : `${partner.recruitCost.toLocaleString()} 金`}
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
