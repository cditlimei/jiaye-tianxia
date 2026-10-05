import { useState } from 'react';
import type { Lord } from '../data/gameData';
import { weapons } from '../data/gameData';
import { weaponBonusForLord } from '../lib/battle';
import { imageUrl } from '../lib/assets';
import type { GameState } from '../types';
import { GameButton } from './common/GameButton';
import { ImageWithFallback } from './common/ImageWithFallback';
import { ModalShell } from './common/ModalShell';

interface WeaponModalProps {
  lord: Lord;
  state: GameState;
  onClose: () => void;
  onEquip: (weaponId: string) => boolean;
}

export function WeaponModal({ lord, state, onClose, onEquip }: WeaponModalProps) {
  const [notice, setNotice] = useState('');
  return (
    <ModalShell title="兵器库" onClose={onClose}>
      <div className="weapon-list">
        <p className="weapon-list__summary">
          府库 {state.gold.toLocaleString()} 金 · 已拥有 {state.ownedWeaponIds.length}/{weapons.length} 件
        </p>
        {notice && (
          <p className="partner-market__notice" role="status">
            {notice}
          </p>
        )}
        {weapons.map((weapon) => {
          const equipped = weapon.id === state.equippedWeaponId;
          const owned = state.ownedWeaponIds.includes(weapon.id);
          const exclusive = weapon.bestMatchLordId === lord.id;
          const missingGold = Math.max(0, weapon.price - state.gold);
          const label = equipped
            ? '已装备'
            : owned
              ? '装备'
              : missingGold > 0
                ? `差 ${missingGold.toLocaleString()} 金`
                : `购入 · ${weapon.price.toLocaleString()} 金`;
          return (
            <article key={weapon.id} className={`weapon-card weapon-card--${weapon.rarity} ${owned ? '' : 'is-locked'}`}>
              <ImageWithFallback src={imageUrl(weapon.imagePath, 384)} alt={weapon.name} className="weapon-card__image" />
              <div className="weapon-card__body">
                <div className="weapon-card__top">
                  <div>
                    <span>{rarityLabel(weapon.rarity)}{owned ? '' : ` · ${weapon.price.toLocaleString()} 金`}</span>
                    <h3>{weapon.name}</h3>
                  </div>
                  {exclusive && <strong>专属加成</strong>}
                </div>
                <p>武力 +{weaponBonusForLord(weapon, lord.id)}</p>
                <GameButton
                  variant={equipped ? 'ghost' : owned || missingGold === 0 ? 'primary' : 'secondary'}
                  disabled={equipped}
                  onClick={() => {
                    if (onEquip(weapon.id)) {
                      const current = weapons.find((item) => item.id === state.equippedWeaponId);
                      const stronger = !current || weaponBonusForLord(weapon, lord.id) > weaponBonusForLord(current, lord.id);
                      setNotice(owned ? `已装备 ${weapon.name}。` : stronger ? `购入 ${weapon.name}，已装备。` : `购入 ${weapon.name}，比手上的 ${current?.name} 弱，已收进兵器库。`);
                      return;
                    }
                    setNotice(`金不足，还差 ${missingGold.toLocaleString()} 金。`);
                  }}
                >
                  {label}
                </GameButton>
              </div>
            </article>
          );
        })}
      </div>
    </ModalShell>
  );
}

function rarityLabel(rarity: string) {
  if (rarity === 'legendary') return '传说';
  if (rarity === 'epic') return '史诗';
  return '普通';
}
