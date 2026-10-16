import { useMemo, useState } from 'react';
import { CAMP_META, lords } from '../data/gameData';
import { imageUrl } from '../lib/assets';
import { GameButton } from './common/GameButton';
import { ImageWithFallback } from './common/ImageWithFallback';
import { StatBar } from './common/StatBar';
import { loyalBonusFor, type FactionId } from '../data/factions';

interface LordSelectScreenProps {
  onConfirm: (lordId: string) => void;
  onBack: () => void;
  disabled?: boolean;
  /** 新朝开国时的朝代提示 */
  banner?: string;
  /** v3.2 本朝势力：同阵营主公标「旧部」，三项属性各 +3（群不加） */
  faction?: FactionId;
}

export function LordSelectScreen({ onConfirm, onBack, disabled = false, banner, faction = 'qun' }: LordSelectScreenProps) {
  // 有旧部时默认选第一位旧部
  const [selectedId, setSelectedId] = useState(() => (lords.find((lord) => loyalBonusFor(lord.camp, faction) > 0) ?? lords[0]).id);
  const selectedLord = useMemo(() => lords.find((lord) => lord.id === selectedId) ?? lords[0], [selectedId]);
  const camp = CAMP_META[selectedLord.camp];
  const loyal = loyalBonusFor(selectedLord.camp, faction);

  return (
    <main className="screen lord-screen">
      <header className="screen-header">
        <div>
          <span className="eyebrow">选择主公</span>
          <h2>乱世择主</h2>
        </div>
        <GameButton variant="ghost" onClick={onBack} disabled={disabled}>
          返回
        </GameButton>
      </header>
      {banner && <p className="dynasty-banner">{banner}</p>}

      <section className="lord-grid" aria-label="主公列表">
        {lords.map((lord) => {
          const lordCamp = CAMP_META[lord.camp];
          return (
            <button
              key={lord.id}
              className={`lord-card ${lord.id === selectedId ? 'is-selected' : ''}`}
              style={{ borderColor: lord.id === selectedId ? lordCamp.color : undefined }}
              onClick={() => setSelectedId(lord.id)}
            >
              <ImageWithFallback src={imageUrl(lord.imagePath, 256)} alt={lord.name} className="lord-card__image" />
              <span className="camp-badge" style={{ color: lordCamp.color, background: lordCamp.softColor }}>
                {lordCamp.name}
              </span>
              {loyalBonusFor(lord.camp, faction) > 0 && <span className="lord-card__loyal">旧部</span>}
              <span className="lord-card__copy">
                <strong>{lord.name}</strong>
                <small>{lord.title}</small>
              </span>
            </button>
          );
        })}
      </section>

      <section className="lord-detail" style={{ borderColor: camp.color }}>
        <div className="lord-detail__copy">
          <span className="camp-line" style={{ color: camp.color }}>
            {camp.name} · {selectedLord.title}{loyal > 0 ? ` · 旧部（三项 +${loyal}）` : ''}
          </span>
          <h3>{selectedLord.name}</h3>
          <p>{selectedLord.description}</p>
          <blockquote>“乱世起家，择一主而成一门。”</blockquote>
        </div>
        <div className="lord-detail__stats">
          <StatBar label="武力" value={selectedLord.strength + loyal} tone="red" />
          <StatBar label="智谋" value={selectedLord.intelligence + loyal} tone="blue" />
          <StatBar label="声望" value={selectedLord.charisma + loyal} tone="green" />
        </div>
      </section>

      <GameButton block onClick={() => onConfirm(selectedLord.id)} disabled={disabled}>
        {disabled ? '封侯拜将中' : '确认选择'}
      </GameButton>
    </main>
  );
}
