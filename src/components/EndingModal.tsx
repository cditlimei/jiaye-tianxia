import { useEffect, useRef, useState } from 'react';
import { bequestSlots, dynastyCount, dynastySummary, findRealm, foundingGoldFor } from '../data/dynasty';
import { findLord, partners } from '../data/gameData';
import { attackableFiefs, findFief, nodeShortName, orderCapFor } from '../data/fiefs';
import { BEQUESTS, FACTIONS, FOUNDABLE_FACTIONS, treasuryBequestGold, type BequestId, type FactionId } from '../data/factions';
import { findVow, VOWS } from '../data/ambitions';
import { titleBonuses } from '../data/titleEffects';
import { factionCurve } from '../lib/prices';
import type { GameState } from '../types';
import { GameButton } from './common/GameButton';
import { ModalShell } from './common/ModalShell';

interface EndingModalProps {
  state: GameState;
  dailyIncome: number;
  /** 本朝军令上限（含整军封地）；国号说明按新朝口径另算，不用它 */
  orderCap: number;
  onClose: () => void;
  onFound: (faction: FactionId, bequests: BequestId[], keepPartnerId: string | null) => void;
}

type Step = 'realm' | 'bequest' | 'confirm';
const STEP_LABEL: Record<Step, string> = { realm: '一 · 选国号', bequest: '二 · 选遗泽', confirm: '三 · 确认' };
const wan = (gold: number) => `${(gold / 10000).toLocaleString()} 万`;
const short = (name: string) => name.replace(/郡$/, '');

/**
 * 天下归心卷轴（v3.2）：三步开新朝 —— 选国号（= 下一朝从哪里起家）→ 选遗泽（只管下一朝，最多 3 项）→ 确认。
 * 国号效果按「冻结的前朝遗泽 + 本朝一份」，跨朝不再叠倍率；遗泽里没有收入乘数，第 N 朝不会越打越快。
 */
export function EndingModal({ state, onClose, onFound }: EndingModalProps) {
  const summary = dynastySummary(state);
  const [step, setStep] = useState<Step>('realm');
  // 切步时滚回本步开头（横屏弹窗矮，不回顶的话落地只看到上一步滚到的底部）
  const stepsRef = useRef<HTMLOListElement>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const list = stepsRef.current;
    const body = list?.closest('.modal-shell__body') as HTMLElement | null;
    if (!list || !body) return;
    body.scrollTop = Math.max(0, list.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 4);
  }, [step]);
  const [faction, setFaction] = useState<FactionId>(() => (state.faction !== 'qun' && FOUNDABLE_FACTIONS.includes(state.faction) ? state.faction : 'wei'));
  const [picked, setPicked] = useState<BequestId[]>([]);
  const owned = partners.filter((partner) => state.ownedPartnerIds.includes(partner.id));
  const [keepId, setKeepId] = useState<string | null>(() => (state.escortPartnerId && state.ownedPartnerIds.includes(state.escortPartnerId) ? state.escortPartnerId : owned[0]?.id ?? null));
  const slots = bequestSlots(state);
  const chosen = FACTIONS[faction];
  const lordName = findLord(state.selectedLordId)?.name ?? '主公';
  const vow = state.vow ? findVow(state.vow.id) : null;
  const vowBonus = state.vow?.done ? titleBonuses(state).ambitionPoints : 0;
  const gold = foundingGoldFor(state, picked.includes('treasury'));
  const nextDynasty = dynastyCount(state.realms) + 2;

  const factionCard = (id: FactionId) => {
    const info = FACTIONS[id];
    const seat = findFief(info.seat);
    const first = attackableFiefs({}, info.seat).map((fief) => short(fief.name)).join('、');
    const curve = factionCurve({ paceCurve: 'v3', faction: id });
    const realm = info.realm ? findRealm(info.realm) : null;
    // 新朝国号效果 = 冻结遗泽 + 本朝一份
    const eff = { ...state.ancestralRealms };
    if (info.realm) eff[info.realm] += 1;
    const concrete = info.realm === 'wei' ? `新朝军令上限 ${orderCapFor({}, eff)}` : info.realm === 'shu' ? `新朝政务收入 +${eff.shu * 10}%` : info.realm === 'wu' ? `新朝三项 +${eff.wu * 6}、斗地主缴获 +${Math.min(3, eff.wu) * 20}%` : '';
    const perk = info.ownPerk ? findFief(info.ownPerk)?.perk : null;
    return (
      <button key={id} type="button" role="radio" aria-checked={faction === id} className={`ending-faction is-${id} ${faction === id ? 'is-selected' : ''}`} onClick={() => setFaction(id)}>
        <strong>{info.name}<em>起于{info.capital}（{seat ? nodeShortName(seat) : ''}）</em></strong>
        <span>首批可攻：{first} · 首郡 {wan(curve[0])}、末郡 {wan(curve[5])} · 王城 {wan(info.royalCost)}</span>
        {realm && <span>势力包：{realm.effect}{concrete ? `（${concrete}）` : ''}</span>}
        {perk && <span>自带特权「{perk.name}」：{perk.detail}</span>}
        <small>宏愿「{VOWS[id].name}」：{VOWS[id].text}{info.realm && state.realms[info.realm] > 0 ? ` · 已立 ${state.realms[info.realm]} 朝` : ''}</small>
      </button>
    );
  };

  const toggleBequest = (id: BequestId) => {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : current.length >= slots ? current : [...current, id]));
  };
  const keeperBlocked = picked.includes('keeper') && !keepId;

  return (
    <ModalShell title="天下归心" onClose={onClose}>
      <div className="ending-sheet ending-v32">
        <p className="ending-sheet__scroll">
          六郡尽归府下，王城巍峨。自开国至{lordName}，共 {summary.generations} 代、{summary.openDays ? `开府 ${summary.openDays.toLocaleString()} 天（第 ${summary.days.toLocaleString()} 日）` : `${summary.days.toLocaleString()} 日`}，{summary.wins.toLocaleString()} 场胜利{vow ? `，宏愿「${vow.name}」${state.vow?.done ? '已成' : '未竟'}` : ''}{summary.ambitions > 0 ? `，${summary.ambitions} 代志向达成` : ''}。天下归心，可开创新朝。
        </p>
        <ol ref={stepsRef} className="ending-steps" aria-label="开新朝三步">
          {(['realm', 'bequest', 'confirm'] as Step[]).map((item) => (
            <li key={item} className={step === item ? 'is-current' : ''}>{STEP_LABEL[item]}</li>
          ))}
        </ol>

        {step === 'realm' && (
          <section className="fief-claim" aria-label="选国号">
            <div className="section-title">
              <span>新朝国号 = 下一朝从哪里起家</span>
              <strong>第 {nextDynasty} 朝</strong>
            </div>
            <p>选国号就是选下一朝的开局势力：本府落在该国老巢，首批可攻的郡、造价顺序、自带牌桌特权、反攻战线都跟着换。国号效果按「前朝遗泽冻结 + 本朝一份」计，同一国号再立不再叠加。</p>
            <div className="fief-policies ending-factions" role="radiogroup" aria-label="选择国号">
              {FOUNDABLE_FACTIONS.filter((id) => FACTIONS[id].unlocked(state)).map(factionCard)}
            </div>
            <GameButton block onClick={() => setStep('bequest')}>
              下一步 · 选遗泽（{slots} 项）
            </GameButton>
            <GameButton block variant="ghost" onClick={onClose}>
              再经营些时日
            </GameButton>
          </section>
        )}

        {step === 'bequest' && (
          <section className="fief-claim ending-bequests" aria-label="选遗泽">
            <div className="section-title">
              <span>遗泽 · 只管下一朝</span>
              <strong>已选 {picked.length}/{slots}</strong>
            </div>
            <p>基础 1 项{vowBonus > 0 ? `，宏愿达成 +${vowBonus}` : '，本朝宏愿未竟不加'}{state.migrationComp.bequest ? '，旧家风补 1 项' : ''}（最多 3 项，同一项不能重复）。遗泽不设收入乘数，开新朝后只在那一朝生效。</p>
            <div className="ending-bequest-list" role="group" aria-label="遗泽">
              {BEQUESTS.map((item) => {
                const on = picked.includes(item.id);
                const full = !on && picked.length >= slots;
                const disabled = full || (item.id === 'keeper' && owned.length === 0);
                const extra = item.id === 'treasury' ? `本朝家业点 ${state.legacyPoints}，可加 ${treasuryBequestGold(state.legacyPoints).toLocaleString()} 金` : '';
                return (
                  <button key={item.id} type="button" role="checkbox" aria-checked={on} disabled={disabled} className={`ending-bequest ${on ? 'is-selected' : ''}`} onClick={() => toggleBequest(item.id)}>
                    <strong>{item.name}</strong>
                    <span>{item.effect}</span>
                    {extra && <small>{extra}</small>}
                  </button>
                );
              })}
            </div>
            {picked.includes('keeper') && (
              <div className="ending-keeper" role="radiogroup" aria-label="留下哪位伴侣">
                {owned.map((partner) => (
                  <button key={partner.id} type="button" role="radio" aria-checked={keepId === partner.id} className={keepId === partner.id ? 'is-selected' : ''} onClick={() => setKeepId(partner.id)}>
                    {partner.name}
                  </button>
                ))}
              </div>
            )}
            <GameButton block disabled={picked.length === 0 || keeperBlocked} onClick={() => setStep('confirm')}>
              {picked.length === 0 ? '至少选 1 项遗泽' : '下一步 · 确认'}
            </GameButton>
            <GameButton block variant="ghost" onClick={() => setStep('realm')}>
              ‹ 回去改国号
            </GameButton>
          </section>
        )}

        {step === 'confirm' && (
          <section className="fief-claim ending-confirm" aria-label="确认开新朝">
            <div className="section-title">
              <span>第 {nextDynasty} 朝 · {chosen.name} · {chosen.capital}</span>
              <strong>开国金 {gold.total.toLocaleString()}</strong>
            </div>
            <ul className="ending-confirm__list">
              <li>本府：{findFief(chosen.seat) ? nodeShortName(findFief(chosen.seat)!) : ''}（{chosen.capital}），首批可攻 {attackableFiefs({}, chosen.seat).map((fief) => short(fief.name)).join('、')}</li>
              <li>宏愿：「{VOWS[chosen.id].name}」{VOWS[chosen.id].text}（开朝即定）</li>
              <li>遗泽：{picked.map((id) => BEQUESTS.find((item) => item.id === id)?.name).join('、')}{picked.includes('keeper') && keepId ? `（留下${partners.find((partner) => partner.id === keepId)?.name ?? ''}）` : ''}</li>
              <li>开国金：1,000 + 2 万{gold.treasury > 0 ? ` + 府库 ${gold.treasury.toLocaleString()}` : ''}{gold.comp > 0 ? ` + 前朝旧例补发 ${gold.comp.toLocaleString()}` : ''}</li>
              <li>归入前朝：金、主公、伴侣{picked.includes('keeper') ? '（留下的一位除外）' : ''}、兵器、宅邸、屯田、封地、家业点、家谱；家声与前朝国号遗泽保留</li>
            </ul>
            <GameButton block variant="danger" onClick={() => onFound(faction, picked, picked.includes('keeper') ? keepId : null)}>
              开创新朝 · 国号{chosen.name}
            </GameButton>
            <GameButton block variant="ghost" onClick={() => setStep('bequest')}>
              ‹ 回去改遗泽
            </GameButton>
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
                <strong>第 {entry.dynasty} 朝{entry.realm ? ` · ${findRealm(entry.realm)?.name}` : ' · 开国'}{entry.faction ? `（${FACTIONS[entry.faction].name}起于${FACTIONS[entry.faction].capital}）` : ''}</strong>
                <span>{entry.generations} 代 · {entry.openDays ? `开府 ${entry.openDays.toLocaleString()} 天（第 ${entry.days.toLocaleString()} 日）` : `${entry.days.toLocaleString()} 日`} · {entry.wins.toLocaleString()} 胜{typeof entry.vow === 'boolean' ? ` · 宏愿${entry.vow ? '已成' : '未竟'}` : ` · ${entry.ambitions} 代志向达成`}{entry.lords && entry.lords.length > 0 ? ` · ${entry.lords.map((id) => findLord(id)?.name).filter(Boolean).join('、')}` : ''}</span>
              </div>
            ))}
          </section>
        )}
      </div>
    </ModalShell>
  );
}
