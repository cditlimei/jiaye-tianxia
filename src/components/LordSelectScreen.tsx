import { useMemo, useState } from 'react';
import { CAMP_META, lords } from '../data/gameData';
import { wsrvUrl } from '../lib/assets';
import { GameButton } from './common/GameButton';
import { ImageWithFallback } from './common/ImageWithFallback';
import { StatBar } from './common/StatBar';

interface LordSelectScreenProps {
  onConfirm: (lordId: string) => void;
  onBack: () => void;
}

export function LordSelectScreen({ onConfirm, onBack }: LordSelectScreenProps) {
  const [selectedId, setSelectedId] = useState(lords[0].id);
  const selectedLord = useMemo(() => lords.find((lord) => lord.id === selectedId) ?? lords[0], [selectedId]);
  const camp = CAMP_META[selectedLord.camp];

  return (
    <main className="screen lord-screen">
      <header className="screen-header">
        <div>
          <span className="eyebrow">择定主公</span>
          <h2>群雄入局</h2>
        </div>
        <GameButton variant="ghost" onClick={onBack}>
          返回
        </GameButton>
      </header>

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
              <ImageWithFallback src={wsrvUrl(lord.imagePath, 256)} alt={lord.name} className="lord-card__image" />
              <span className="camp-badge" style={{ color: lordCamp.color, background: lordCamp.softColor }}>
                {lordCamp.name}
              </span>
              <strong>{lord.name}</strong>
              <small>{lord.title}</small>
            </button>
          );
        })}
      </section>

      <section className="lord-detail" style={{ borderColor: camp.color }}>
        <div className="lord-detail__copy">
          <span className="camp-line" style={{ color: camp.color }}>
            {camp.name} · {selectedLord.title}
          </span>
          <h3>{selectedLord.name}</h3>
          <p>{selectedLord.description}</p>
        </div>
        <div className="lord-detail__stats">
          <StatBar label="武力" value={selectedLord.strength} tone="red" />
          <StatBar label="智力" value={selectedLord.intelligence} tone="blue" />
          <StatBar label="魅力" value={selectedLord.charisma} tone="green" />
        </div>
      </section>

      <GameButton block onClick={() => onConfirm(selectedLord.id)}>
        确认选择
      </GameButton>
    </main>
  );
}

