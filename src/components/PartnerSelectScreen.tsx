import { useMemo, useState } from 'react';
import type { Lord, Partner } from '../data/gameData';
import { partners, partnerRank } from '../data/gameData';
import { imageUrl } from '../lib/assets';
import { GameButton } from './common/GameButton';
import { ImageWithFallback } from './common/ImageWithFallback';

interface PartnerSelectScreenProps {
  lord: Lord;
  onConfirm: (partnerId: string) => void;
  onBack: () => void;
}

export function PartnerSelectScreen({ lord, onConfirm, onBack }: PartnerSelectScreenProps) {
  const recommended = useMemo(() => partners.find((partner) => partner.bestMatchLordId === lord.id) ?? partners[0], [lord.id]);
  const [selectedId, setSelectedId] = useState(recommended.id);
  const selectedPartner = useMemo(
    () => partners.find((partner) => partner.id === selectedId) ?? recommended,
    [recommended, selectedId]
  );
  const bonusCopy = describeBonus(selectedPartner, selectedPartner.bestMatchLordId === lord.id);

  return (
    <main className="screen partner-select-screen">
      <header className="screen-header partner-select-header">
        <div>
          <span className="eyebrow">选择伴侣</span>
          <h2>良缘入府</h2>
          <p>主公，请选择您的伴侣</p>
        </div>
        <GameButton variant="ghost" onClick={onBack}>
          返回
        </GameButton>
      </header>

      <section className="partner-select-stage" aria-label="已选伴侣">
        <div className="partner-select-stage__portrait">
          <ImageWithFallback
            src={imageUrl(selectedPartner.imagePath, 640)}
            alt={selectedPartner.name}
            className="partner-select-stage__image"
            loading="eager"
          />
        </div>
        <div className="partner-select-stage__copy">
          <span>{selectedPartner.bestMatchLordId === lord.id ? '良缘推荐' : partnerRank(selectedPartner)}</span>
          <h3>{selectedPartner.name}</h3>
          <p>{selectedPartner.description}</p>
          <strong>{bonusCopy}</strong>
          <small className="stat-legend">武力→官道讨伐与北疆边患 · 智谋→政务收入与江东水战 · 声望→招募折扣与许都朝堂</small>
        </div>
      </section>

      <section className="partner-select-strip" aria-label="伴侣列表">
        {partners.map((partner) => {
          const selected = partner.id === selectedId;
          const best = partner.bestMatchLordId === lord.id;
          return (
            <button
              key={partner.id}
              type="button"
              className={`partner-select-chip ${selected ? 'is-selected' : ''} ${best ? 'is-best' : ''}`}
              onClick={() => setSelectedId(partner.id)}
            >
              <ImageWithFallback src={imageUrl(partner.imagePath, 320)} alt={partner.name} className="partner-select-chip__image" />
              <span>{best ? '良缘' : partnerRank(partner)}</span>
              <strong>{partner.name}</strong>
            </button>
          );
        })}
      </section>

      <GameButton block onClick={() => onConfirm(selectedPartner.id)}>
        携美人，共创家业
      </GameButton>
    </main>
  );
}

function describeBonus(partner: Partner, best: boolean) {
  return Object.entries(partner.bonus)
    .map(([key, value]) => `${translateBonus(key)} +${best ? Math.round((value ?? 0) * 1.3) : value}`)
    .join(' · ');
}

function translateBonus(key: string) {
  if (key === 'strength') return '武力';
  if (key === 'intelligence') return '智谋';
  return '声望';
}

