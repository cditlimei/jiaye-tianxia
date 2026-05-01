import type { Lord } from '../data/gameData';
import { weapons } from '../data/gameData';
import { weaponBonusForLord } from '../lib/battle';
import { wsrvUrl } from '../lib/assets';
import { GameButton } from './common/GameButton';
import { ImageWithFallback } from './common/ImageWithFallback';
import { ModalShell } from './common/ModalShell';

interface WeaponModalProps {
  lord: Lord;
  equippedWeaponId: string;
  onClose: () => void;
  onEquip: (weaponId: string) => void;
}

export function WeaponModal({ lord, equippedWeaponId, onClose, onEquip }: WeaponModalProps) {
  return (
    <ModalShell title="兵器库" onClose={onClose}>
      <div className="weapon-list">
        {weapons.map((weapon) => {
          const equipped = weapon.id === equippedWeaponId;
          const exclusive = weapon.bestMatchLordId === lord.id;
          return (
            <article key={weapon.id} className={`weapon-card weapon-card--${weapon.rarity}`}>
              <ImageWithFallback src={wsrvUrl(weapon.imagePath, 384)} alt={weapon.name} className="weapon-card__image" />
              <div className="weapon-card__body">
                <div className="weapon-card__top">
                  <div>
                    <span>{rarityLabel(weapon.rarity)}</span>
                    <h3>{weapon.name}</h3>
                  </div>
                  {exclusive && <strong>专属加成</strong>}
                </div>
                <p>武力 +{weaponBonusForLord(weapon, lord.id)}</p>
                <GameButton variant={equipped ? 'ghost' : 'primary'} disabled={equipped} onClick={() => onEquip(weapon.id)}>
                  {equipped ? '已装备' : '装备'}
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

