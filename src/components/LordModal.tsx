import { useState } from 'react';
import type { Lord } from '../data/gameData';
import { hasTitle, titles } from '../data/progression';
import { findAmbition, vowStatus } from '../data/ambitions';
import { findLord } from '../data/gameData';
import { dynastyCount, effectiveRealms, findRealm } from '../data/dynasty';
import { activeTradition } from '../data/traditions';
import { BEQUESTS, FACTIONS } from '../data/factions';
import { availablePlaques, PLAQUE_TEXT, plaqueOf, RETIRED_LINEAGE_NAMES, retiredHonors, TITLE_INFO } from '../data/titleEffects';
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
  /** 固定主城挂哪块匾（null = 按最高档自动） */
  onSetPlaque?: (plaque: string | null) => void;
}

const plaqueName = (id: string) => (id in TITLE_INFO ? TITLE_INFO[id as keyof typeof TITLE_INFO].name : RETIRED_LINEAGE_NAMES[id as keyof typeof RETIRED_LINEAGE_NAMES] ?? id);

export function LordModal({ lord, state, totalPower, intelligence, charisma, onClose, onSetPlaque }: LordModalProps) {
  const vow = vowStatus(state);
  const faction = FACTIONS[state.faction];
  const eff = effectiveRealms(state);
  const [chronicleOpen, setChronicleOpen] = useState(false);
  const [rankedOpen, setRankedOpen] = useState(false);
  const tradition = activeTradition(state);
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
          {(dynastyCount(state.realms) > 0 || state.faction !== 'qun') && <small className="lord-sheet__realms">第 {dynastyCount(state.realms) + 1} 朝 · {faction.name}起于{faction.capital}{(['wei', 'shu', 'wu'] as const).some((id) => eff[id] > 0) ? ` · 国号加成：${(['wei', 'shu', 'wu'] as const).filter((id) => eff[id] > 0).map((id) => `${findRealm(id)!.name}×${eff[id]}`).join('、')}（前朝遗泽冻结 + 本朝一份）` : ''}</small>}
          {state.bequests.length > 0 && <small className="lord-sheet__realms">本朝遗泽：{state.bequests.map((id) => BEQUESTS.find((item) => item.id === id)?.name).join('、')}（只管这一朝）</small>}
          {tradition && <small className="lord-sheet__realms">家风「{tradition.name}」：{tradition.effect}（旧家风本朝照旧，下次统一遗泽多选一项）</small>}
          <small>伴侣技能为主、属性为辅 · 武力→斗地主场次 · 智谋→政务收入 · 声望→招募折扣 · 三项都抬高斗地主缴获{state.legacyPoints > 0 ? ` · 家业点 ${state.legacyPoints}（收入 +${Math.round((legacyIncomeMultiplier(state.legacyPoints) - 1) * 100)}%）` : ''}</small>
        </div>
      </div>
      {vow && (
        <section className="chronicle" aria-label="本朝宏愿">
          <div className="section-title">
            <span>本朝宏愿 · {faction.name}</span>
            <strong>{vow.vow.name} · {vow.done ? '已达成' : vow.missed ? '已错过' : '未竟'}</strong>
          </div>
          <p>{vow.vow.text}。{vow.progress}。宏愿开朝即定，达成后下一朝遗泽多选一项（家学渊源两项）。</p>
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
                <span>{entry.openDays ? `开府 ${entry.openDays} 天（第 ${entry.days} 日）` : `${entry.days} 日`} · {entry.wins} 胜 · 存金 {entry.gold.toLocaleString()}{entry.fiefs > 0 ? ` · ${entry.fiefs} 郡` : ''}{ambitionName ? <> · <span className="nowrap">志向「{ambitionName}」{entry.ambitionDone ? '达成' : '未竟'}</span></> : ''}</span>
              </div>
            );
          })}
          {state.chronicle.length > 5 && (
            <button type="button" className="chronicle-toggle" onClick={() => setChronicleOpen((open) => !open)}>{chronicleOpen ? '收起' : `展开全部 ${state.chronicle.length} 代`}</button>
          )}
        </section>
      )}
      {[
        { label: '家声（跨朝保留）', list: titles.filter((title) => title.lineage) },
        { label: '本朝称号', list: titles.filter((title) => !title.lineage) }
      ].map((group) => (
      <section key={group.label} className="title-list" aria-label={group.label}>
        <div className="section-title">
          <span>{group.label}</span>
          <strong>{group.list.filter((title) => hasTitle(state, title)).length}/{group.list.length}</strong>
        </div>
        {(group.label === '本朝称号' && !rankedOpen && group.list.every((title) => title.isEarned(state)) ? [] : group.list).map((title) => {
          const earned = hasTitle(state, title);
          return (
            <div key={title.id} className={`title-row ${earned ? 'is-earned' : ''}`}>
              <strong>「{title.name}」</strong>
              <span>{earned ? '已获得' : title.requirement || '开局即有'}{title.id !== 'commoner' ? <> · <span className="title-row__effect">{title.effect}</span></> : null}</span>
            </div>
          );
        })}
        {group.label === '本朝称号' && group.list.every((title) => title.isEarned(state)) && (
          <button type="button" className="chronicle-toggle" onClick={() => setRankedOpen((open) => !open)}>{rankedOpen ? '收起' : `本朝称号已集齐 ${group.list.length}/${group.list.length} · 展开`}</button>
        )}
      </section>
      ))}
      {retiredHonors(state).length > 0 && (
        <section className="title-list title-list--retired" aria-label="旧誉">
          <div className="section-title">
            <span>旧誉</span>
            <strong>{retiredHonors(state).length} 项 · 只作纪念</strong>
          </div>
          {retiredHonors(state).map((id) => (
            <div key={id} className="title-row is-retired">
              <strong>「{RETIRED_LINEAGE_NAMES[id]}」</strong>
              <span>旧版家声，已退役，没有效果 · 可挂纪念匾「{PLAQUE_TEXT[id]}」</span>
            </div>
          ))}
        </section>
      )}
      {availablePlaques(state).length > 0 && onSetPlaque && (
        <section className="title-list plaque-picker" aria-label="主城匾额">
          <div className="section-title">
            <span>主城匾额</span>
            <strong>现挂「{PLAQUE_TEXT[plaqueOf(state) ?? ''] ?? '无'}」</strong>
          </div>
          <div className="plaque-picker__options" role="radiogroup" aria-label="挂哪块匾">
            <button type="button" role="radio" aria-checked={state.plaque === null} className={state.plaque === null ? 'is-selected' : ''} onClick={() => onSetPlaque(null)}>自动（最高称号）</button>
            {availablePlaques(state).map((id) => (
              <button key={id} type="button" role="radio" aria-checked={state.plaque === id} className={state.plaque === id ? 'is-selected' : ''} onClick={() => onSetPlaque(id)}>
                「{PLAQUE_TEXT[id]}」<small>{plaqueName(id)}</small>
              </button>
            ))}
          </div>
        </section>
      )}
      {state.pastDynasties.length > 0 && (
        <section className="chronicle" aria-label="前朝">
          <div className="section-title">
            <span>前朝</span>
            <strong>{state.pastDynasties.length} 朝</strong>
          </div>
          {state.pastDynasties.map((entry) => (
            <div key={entry.dynasty} className="chronicle-row is-done">
              <strong>第 {entry.dynasty} 朝{entry.realm ? ` · ${findRealm(entry.realm)?.name}` : ' · 开国'} · 天下归心</strong>
              <span>{entry.generations} 代 · {entry.openDays ? `开府 ${entry.openDays.toLocaleString()} 天（第 ${entry.days.toLocaleString()} 日）` : `${entry.days.toLocaleString()} 日`} · {entry.wins.toLocaleString()} 胜 · {entry.ambitions} 代志向达成</span>
            </div>
          ))}
        </section>
      )}
    </ModalShell>
  );
}
