import { useState } from 'react';
import type { Lord } from '../data/gameData';
import { hasTitle, titles } from '../data/progression';
import { ambitionStatus, findAmbition } from '../data/ambitions';
import { findLord } from '../data/gameData';
import { dynastyCount, findRealm } from '../data/dynasty';
import { traditionOf } from '../data/traditions';
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
  const ambition = ambitionStatus(state);
  const [chronicleOpen, setChronicleOpen] = useState(false);
  const [rankedOpen, setRankedOpen] = useState(false);
  const tradition = traditionOf(state.chronicle);
  const chronicleRows = chronicleOpen || state.chronicle.length <= 5 ? state.chronicle : state.chronicle.slice(-3);
  return (
    <ModalShell title="主公" onClose={onClose}>
      <div className="lord-sheet">
        <ImageWithFallback src={imageUrl(lord.imagePath, 256)} alt={lord.name} className="lord-sheet__portrait" />
        <div className="lord-sheet__copy">
          <strong>{lord.name}</strong>
          <span>{lord.title}{dynastyCount(state.realms) > 0 ? ` · ${state.realm ? `${findRealm(state.realm)?.name} · ` : ''}第 ${dynastyCount(state.realms) + 1} 朝` : ''}{state.generation > 1 ? ` · 第 ${state.generation} 代` : ''}</span>
          <p>{lord.description}</p>
          <dl>
            <div><dt>武力</dt><dd>{totalPower}</dd></div>
            <div><dt>智谋</dt><dd>{intelligence}</dd></div>
            <div><dt>声望</dt><dd>{charisma}</dd></div>
          </dl>
          {dynastyCount(state.realms) > 0 && <small className="lord-sheet__realms">第 {dynastyCount(state.realms) + 1} 朝 · 国号加成：{(['wei', 'shu', 'wu'] as const).filter((id) => state.realms[id] > 0).map((id) => `${findRealm(id)!.name}×${state.realms[id]}`).join('、')}</small>}
          {tradition && <small className="lord-sheet__realms">家风「{tradition.name}」：{tradition.effect}（连续两代达成同一志向，换志向即断）</small>}
          <small>伴侣技能为主、属性为辅 · 武力→斗地主场次与北疆 · 智谋→政务收入 · 声望→招募折扣 · 三项都抬高斗地主缴获{state.legacyPoints > 0 ? ` · 家业点 ${state.legacyPoints}（收入 +${Math.round((legacyIncomeMultiplier(state.legacyPoints) - 1) * 100)}%）` : ''}</small>
        </div>
      </div>
      {ambition && (
        <section className="chronicle" aria-label="本代志向">
          <div className="section-title">
            <span>本代志向</span>
            <strong>{ambition.ambition.name} · {ambition.done ? '已达成' : `${ambition.progress.toLocaleString()} / ${ambition.target.toLocaleString()} ${ambition.ambition.unit}`}</strong>
          </div>
          <p>{ambition.ambition.describe(ambition.target)}。{ambition.ambition.motto}。</p>
        </section>
      )}
      {state.chronicle.length > 0 && (
        <section className="chronicle" aria-label="家谱">
          <div className="section-title">
            <span>家谱</span>
            <strong>第 {state.generation} 代 · 载 {state.chronicle.length} 代</strong>
          </div>
          {chronicleRows.map((entry, index) => {
            const name = findLord(entry.lordId)?.name ?? '无名氏';
            const ambitionName = entry.ambition ? findAmbition(entry.ambition)?.name : null;
            return (
              <div key={`${entry.generation}-${index}`} className={`chronicle-row ${entry.ambitionDone ? 'is-done' : ''}`}>
                <strong>第 {entry.generation} 代 · {name}</strong>
                <span>{entry.days} 日 · {entry.wins} 胜 · 存金 {entry.gold.toLocaleString()}{entry.fiefs > 0 ? ` · ${entry.fiefs} 郡` : ''}{ambitionName ? <> · <span className="nowrap">志向「{ambitionName}」{entry.ambitionDone ? '达成' : '未竟'}</span></> : ' · 未定志向'}</span>
              </div>
            );
          })}
          {state.chronicle.length > 5 && (
            <button type="button" className="chronicle-toggle" onClick={() => setChronicleOpen((open) => !open)}>{chronicleOpen ? '收起' : `展开全部 ${state.chronicle.length} 代`}</button>
          )}
        </section>
      )}
      {[
        { label: '家声（跨代保留）', list: titles.filter((title) => title.lineage) },
        { label: '本代称号', list: titles.filter((title) => !title.lineage) }
      ].map((group) => (
      <section key={group.label} className="title-list" aria-label={group.label}>
        <div className="section-title">
          <span>{group.label}</span>
          <strong>{group.list.filter((title) => hasTitle(state, title)).length}/{group.list.length}</strong>
        </div>
        {(group.label === '本代称号' && !rankedOpen && group.list.every((title) => title.isEarned(state)) ? [] : group.list).map((title) => {
          const earned = hasTitle(state, title);
          return (
            <div key={title.id} className={`title-row ${earned ? 'is-earned' : ''}`}>
              <strong>「{title.name}」</strong>
              <span>{earned ? '已获得' : title.id === 'scholarly' && state.generation < 2 ? '传位后方可解锁' : title.requirement || '开局即有'}</span>
            </div>
          );
        })}
        {group.label === '本代称号' && group.list.every((title) => title.isEarned(state)) && (
          <button type="button" className="chronicle-toggle" onClick={() => setRankedOpen((open) => !open)}>{rankedOpen ? '收起' : `本代称号已集齐 ${group.list.length}/${group.list.length} · 展开`}</button>
        )}
      </section>
      ))}
      {state.pastDynasties.length > 0 && (
        <section className="chronicle" aria-label="前朝">
          <div className="section-title">
            <span>前朝</span>
            <strong>{state.pastDynasties.length} 朝</strong>
          </div>
          {state.pastDynasties.map((entry) => (
            <div key={entry.dynasty} className="chronicle-row is-done">
              <strong>第 {entry.dynasty} 朝{entry.realm ? ` · ${findRealm(entry.realm)?.name}` : ' · 开国'} · 天下归心</strong>
              <span>{entry.generations} 代 · {entry.days.toLocaleString()} 日 · {entry.wins.toLocaleString()} 胜 · {entry.ambitions} 代志向达成</span>
            </div>
          ))}
        </section>
      )}
    </ModalShell>
  );
}
