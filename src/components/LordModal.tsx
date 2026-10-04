import type { Lord } from '../data/gameData';
import { titles } from '../data/progression';
import { imageUrl } from '../lib/assets';
import { legacyIncomeMultiplier } from '../lib/battle';
import type { GameState } from '../types';
import { ImageWithFallback } from './common/ImageWithFallback';
import { ModalShell } from './common/ModalShell';

interface LordModalProps {
  lord: Lord;
  state: GameState;
  totalPower: number;
  intelligence: number;
  charisma: number;
  onClose: () => void;
}

export function LordModal({ lord, state, totalPower, intelligence, charisma, onClose }: LordModalProps) {
  const earnedCount = titles.filter((title) => title.isEarned(state)).length;
  return (
    <ModalShell title="主公与称号" onClose={onClose}>
      <div className="lord-sheet">
        <ImageWithFallback src={imageUrl(lord.imagePath, 256)} alt={lord.name} className="lord-sheet__portrait" />
        <div className="lord-sheet__copy">
          <strong>{lord.name}</strong>
          <span>{lord.title}{state.generation > 1 ? ` · 第 ${state.generation} 代` : ''}</span>
          <p>{lord.description}</p>
          <dl>
            <div><dt>武力</dt><dd>{totalPower}</dd></div>
            <div><dt>智谋</dt><dd>{intelligence}</dd></div>
            <div><dt>声望</dt><dd>{charisma}</dd></div>
          </dl>
          <small>武力→官道与北疆 · 智谋→政务收入与江东 · 声望→招募折扣与许都{state.legacyPoints > 0 ? ` · 家业点 ${state.legacyPoints}（收入 +${Math.round((legacyIncomeMultiplier(state.legacyPoints) - 1) * 100)}%）` : ''}</small>
        </div>
      </div>
      <section className="title-list" aria-label="称号">
        <div className="section-title">
          <span>称号</span>
          <strong>{earnedCount}/{titles.length}</strong>
        </div>
        {titles.map((title) => {
          const earned = title.isEarned(state);
          return (
            <div key={title.id} className={`title-row ${earned ? 'is-earned' : ''}`}>
              <strong>「{title.name}」</strong>
              <span>{earned ? '已获得' : title.requirement || '开局即有'}</span>
            </div>
          );
        })}
      </section>
    </ModalShell>
  );
}
