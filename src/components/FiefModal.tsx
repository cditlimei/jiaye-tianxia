import { useState } from 'react';
import { FIEF_ORDER_BONUS, FIEF_STAT_BONUS, FIEF_UNLOCK_HOME_LEVEL, fiefIncomePercent, fiefPolicies, fiefStatBonus, fiefs, findFiefPolicy, nextFief, orderCapFor, ownedFiefCount, policyChangeCost, type FiefPolicyId } from '../data/fiefs';
import { findHomeLevel } from '../data/gameData';
import type { GameState } from '../types';
import { GameButton } from './common/GameButton';
import { ModalShell } from './common/ModalShell';

interface FiefModalProps {
  state: GameState;
  /** 再开一郡行劝农，每次政务多得的金 */
  farmingGain: number;
  totalPower: number;
  orderCap: number;
  onClose: () => void;
  onClaim: (policyId: FiefPolicyId) => boolean;
  onChangePolicy: (fiefId: string, policyId: FiefPolicyId) => boolean;
}

export function FiefModal({ state, farmingGain, totalPower, orderCap, onClose, onClaim, onChangePolicy }: FiefModalProps) {
  const unlocked = state.homeLevel >= FIEF_UNLOCK_HOME_LEVEL;
  const next = nextFief(state.fiefs);
  const owned = ownedFiefCount(state.fiefs);
  const [policy, setPolicy] = useState<FiefPolicyId>('farming');
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const chosen = findFiefPolicy(policy)!;
  const canClaim = unlocked && next !== null && state.gold >= next.cost;
  // 方略卡第二行按当前状态算具体数，三条量纲不同也能比
  const concrete: Record<FiefPolicyId, string> = {
    farming: `每次政务 +${farmingGain.toLocaleString()} 金`,
    military: `军令上限 ${orderCap} → ${orderCap + FIEF_ORDER_BONUS}`,
    schooling: `武力 ${totalPower} → ${totalPower + FIEF_STAT_BONUS}，智谋、声望同加`
  };

  const claim = () => {
    if (!next) return;
    if (!onClaim(policy)) {
      setNotice(`金不足：开拓${next.name}需 ${next.cost.toLocaleString()} 金。`);
      return;
    }
    setNotice(`${next.name}已归府下，行「${chosen.name}」之策。`);
  };

  const change = (fiefId: string, nextPolicy: FiefPolicyId) => {
    const fief = fiefs.find((item) => item.id === fiefId)!;
    if (!onChangePolicy(fiefId, nextPolicy)) {
      setNotice(`改弦更张需 ${policyChangeCost(fief).toLocaleString()} 金，金不足。`);
      return;
    }
    setEditing(null);
    const reclaimed = state.fiefs[fiefId] === 'military' ? Math.max(0, state.orders - (orderCap - FIEF_ORDER_BONUS)) : 0;
    setNotice(`${fief.name}改行「${findFiefPolicy(nextPolicy)!.name}」之策。${reclaimed > 0 ? `军令上限降为 ${orderCap - FIEF_ORDER_BONUS}，收回 ${reclaimed} 道。` : ''}`);
  };

  return (
    <ModalShell title="封地经略" onClose={onClose}>
      <div className="fief-sheet">
        {owned > 0 && (
          <p className="fief-sheet__summary">
            已领 {owned}/{fiefs.length} 郡 · 劝农 +{fiefIncomePercent(state.fiefs)}% 收入 · 军令上限 {orderCapFor(state.fiefs)} · 教化三项 +{fiefStatBonus(state.fiefs)}
          </p>
        )}
        <p className="fief-sheet__intro">
          六郡依次开拓，每郡定一条方略；方略随时可改，按开拓价一成收费。封地是家业田产，传位随之传下。
        </p>
        {notice && <p className="partner-market__notice" role="status">{notice}</p>}

        {!unlocked && (
          <p className="fief-sheet__locked">{owned > 0 ? `再开拓新郡需宅邸升至${findHomeLevel(FIEF_UNLOCK_HOME_LEVEL).name}；已有封地的方略仍可改。` : `宅邸升至${findHomeLevel(FIEF_UNLOCK_HOME_LEVEL).name}后方可裂土封郡。`}</p>
        )}

        {unlocked && next && (
          <section className="fief-claim" aria-label="开拓下一郡">
            <div className="section-title">
              <span>下一郡</span>
              <strong>{next.name} · {next.cost.toLocaleString()} 金</strong>
            </div>
            <p>{next.description}</p>
            <div className="fief-policies" role="radiogroup" aria-label="选择方略">
              {fiefPolicies.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={policy === item.id}
                  className={policy === item.id ? 'is-selected' : ''}
                  onClick={() => setPolicy(item.id)}
                >
                  <strong>{item.name}</strong>
                  <span>{concrete[item.id]}</span>
                  <small>{item.effect} · {item.detail}</small>
                </button>
              ))}
            </div>
            <GameButton block disabled={!canClaim} onClick={claim}>
              {canClaim ? `开拓${next.name} · 行${chosen.name}之策` : `差 ${(next.cost - state.gold).toLocaleString()} 金`}
            </GameButton>
            {canClaim && <p className="fief-claim__after">开拓后余 {(state.gold - next.cost).toLocaleString()} 金。</p>}
          </section>
        )}
        {unlocked && !next && <p className="fief-sheet__locked">六郡尽归府下，天下已定。</p>}

        <section className="fief-list" aria-label="已有封地">
          {fiefs.map((fief) => {
            const held = state.fiefs[fief.id];
            const heldPolicy = held ? findFiefPolicy(held) : null;
            const isEditing = editing === fief.id;
            return (
              <article key={fief.id} className={`fief-row ${held ? 'is-held' : ''}`}>
                <div>
                  <strong>{fief.name}</strong>
                  <span>{held && heldPolicy ? `${heldPolicy.name} · ${heldPolicy.effect}` : `${fief.cost.toLocaleString()} 金 · ${fief.description}`}</span>
                </div>
                {held && !isEditing && (
                  <button type="button" onClick={() => setEditing(fief.id)}>改方略 {policyChangeCost(fief).toLocaleString()} 金</button>
                )}
                {held && isEditing && (
                  <div className="fief-row__edit">
                    {held === 'military' && state.orders > orderCap - FIEF_ORDER_BONUS && (
                      <small className="fief-row__warn">改掉整军后军令上限降为 {orderCap - FIEF_ORDER_BONUS}，现有 {state.orders} 道会收回 {state.orders - (orderCap - FIEF_ORDER_BONUS)} 道。</small>
                    )}
                    {fiefPolicies.filter((item) => item.id !== held).map((item) => (
                      <button key={item.id} type="button" onClick={() => change(fief.id, item.id)}>改为{item.name}</button>
                    ))}
                    <button type="button" onClick={() => setEditing(null)}>作罢</button>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      </div>
    </ModalShell>
  );
}
