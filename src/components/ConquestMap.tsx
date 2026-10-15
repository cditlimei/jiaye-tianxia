import { useMemo, useState, type ReactNode } from 'react';
import { AI_SKILL_LABEL } from '../lib/doudizhu';
import { attackableFiefs, CONQUEST_STAKE_RATE, FIEF_UNLOCK_HOME_LEVEL, fiefPolicies, fiefs, findFiefPolicy, HOME_NODE, ownedFiefCount, type Fief, type FiefHoldings, type FiefPolicyId } from '../data/fiefs';

interface ConquestMapProps {
  holdings: FiefHoldings;
  homeLevel: number;
  gold: number;
  orders: number;
  stakeFor: (fief: Fief) => number;
  policyChangeCostFor: (fief: Fief) => number;
  onConquer: (fiefId: string, policyId: FiefPolicyId) => void;
  onChangePolicy: (fiefId: string, policyId: FiefPolicyId) => boolean;
  /** 攻郡确认里的「随行伴侣」选择 */
  escortPicker?: ReactNode;
}

type NodeState = 'owned' | 'attackable' | 'far';

const nodeById = (id: string) => (id === 'home' ? HOME_NODE : fiefs.find((fief) => fief.id === id) ?? null);

/**
 * 疆域图：本府荆州 + 六郡。已归府下的郡染金插旗，与疆域相邻的郡可出兵（红圈），其余待开疆。
 * 点城看守将、特权与军资；攻郡打一局斗地主，胜则得郡。
 */
export function ConquestMap({ holdings, homeLevel, gold, orders, stakeFor, policyChangeCostFor, onConquer, onChangePolicy, escortPicker }: ConquestMapProps) {
  const attackable = useMemo(() => attackableFiefs(holdings), [holdings]);
  const stateOf = (fief: Fief): NodeState => (holdings[fief.id] ? 'owned' : attackable.some((item) => item.id === fief.id) ? 'attackable' : 'far');
  const [selectedId, setSelectedId] = useState<string>(() => [...attackable].sort((a, b) => a.cost - b.cost)[0]?.id ?? 'home');
  const [policyId, setPolicyId] = useState<FiefPolicyId>('farming');
  const [notice, setNotice] = useState('');
  const selected = fiefs.find((fief) => fief.id === selectedId) ?? null;
  const owned = ownedFiefCount(holdings);

  // 连线：每条边只画一次；两端都在疆域内画实线金色
  const edges = useMemo(() => {
    const seen = new Set<string>();
    const list: { from: { x: number; y: number }; to: { x: number; y: number }; held: boolean }[] = [];
    for (const fief of fiefs) {
      for (const id of fief.neighbors) {
        const key = [fief.id, id].sort().join('-');
        const other = nodeById(id);
        if (seen.has(key) || !other) continue;
        seen.add(key);
        list.push({ from: fief, to: other, held: Boolean(holdings[fief.id]) && (id === 'home' || Boolean(holdings[id])) });
      }
    }
    return list;
  }, [holdings]);

  const panel = (() => {
    if (!selected) {
      return (
        <div className="conquest-panel">
          <strong>荆州 · 本府</strong>
          <span>家业根基所在。与南阳、长沙相邻，从这里出兵开疆。</span>
        </div>
      );
    }
    const state = stateOf(selected);
    const ownedPolicy = findFiefPolicy(holdings[selected.id] ?? '');
    if (state === 'owned' && ownedPolicy) {
      const changeCost = policyChangeCostFor(selected);
      return (
        <div className="conquest-panel is-owned">
          <strong>{selected.name} · 已归府下</strong>
          <span>方略「{ownedPolicy.name}」：{ownedPolicy.effect}</span>
          <span className="conquest-perk">牌桌特权「{selected.perk.name}」：{selected.perk.detail}</span>
          <div className="conquest-policies" role="group" aria-label="改方略">
            {fiefPolicies.filter((policy) => policy.id !== ownedPolicy.id).map((policy) => (
              <button
                key={policy.id}
                type="button"
                disabled={gold < changeCost}
                onClick={() => setNotice(onChangePolicy(selected.id, policy.id) ? `${selected.name}改行「${policy.name}」` : '金不足')}
              >
                改行{policy.name} · {changeCost.toLocaleString()} 金
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (state === 'far') {
      const via = selected.neighbors.map((id) => nodeById(id)?.name).filter(Boolean).join('或');
      return (
        <div className="conquest-panel is-far">
          <strong>{selected.name} · 尚未接壤</strong>
          <span>先拿下{via}，才能兵临{selected.name}城下。</span>
          <span className="conquest-perk">拿下后牌桌特权「{selected.perk.name}」：{selected.perk.detail}</span>
        </div>
      );
    }
    const stake = stakeFor(selected);
    const blocker = homeLevel < FIEF_UNLOCK_HOME_LEVEL
      ? '宅邸升至侯府后可出兵攻郡'
      : orders < 1
        ? '军令不足，回府处理政务'
        : gold < stake
          ? `军资还差 ${(stake - gold).toLocaleString()} 金`
          : '';
    return (
      <div className="conquest-panel is-attackable">
        <strong>{selected.name} · 守将 {selected.garrison}（{AI_SKILL_LABEL[selected.skill]}）</strong>
        <span>{selected.description}</span>
        <span className="conquest-perk">拿下后牌桌特权「{selected.perk.name}」：{selected.perk.detail}</span>
        <span>和守将打一局斗地主：胜则{selected.name}归府下；败则 {stake.toLocaleString()} 金军资没入敌手，可再攻。</span>
        <div className="conquest-policies" role="radiogroup" aria-label="拿下后行何方略">
          {fiefPolicies.map((policy) => (
            <button key={policy.id} type="button" role="radio" aria-checked={policyId === policy.id} className={policyId === policy.id ? 'is-picked' : ''} onClick={() => setPolicyId(policy.id)}>
              <b>{policy.name}</b>
              <small>{policy.effect}</small>
            </button>
          ))}
        </div>
        {escortPicker}
        <button type="button" className="conquest-go" disabled={Boolean(blocker)} onClick={() => onConquer(selected.id, policyId)}>
          {blocker || `出兵攻取${selected.name} · 耗 1 军令 · 押 ${stake.toLocaleString()} 金`}
        </button>
      </div>
    );
  })();

  return (
    <section className="conquest-map" aria-label="天下疆域">
      <div className="section-title">
        <span>天下疆域 · 已有 {owned}/{fiefs.length} 郡{homeLevel < FIEF_UNLOCK_HOME_LEVEL ? ' · 侯府后可出兵' : ''}</span>
        <strong>攻郡押军资 = 开拓价 {Math.round(CONQUEST_STAKE_RATE * 100)}%</strong>
      </div>
      <svg className="conquest-map__svg" viewBox="0 0 100 72" role="img" aria-label={`疆域图：已有 ${owned} 郡`}>
        <defs>
          <radialGradient id="conquest-land" cx="50%" cy="45%" r="70%">
            <stop offset="0" stopColor="#e9d8ae" />
            <stop offset="1" stopColor="#bfa06a" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="100" height="72" rx="3" fill="url(#conquest-land)" />
        {/* 山脉 */}
        {[[14, 30], [18, 34], [22, 28], [30, 60], [34, 64], [78, 22], [82, 18]].map(([x, y], index) => (
          <path key={index} d={`M${x - 3} ${y + 2} L${x} ${y - 2.5} L${x + 3} ${y + 2} Z`} fill="#9c8452" opacity="0.55" />
        ))}
        {/* 黄河、长江 */}
        <path d="M4 18 C 20 12, 30 26, 44 20 S 70 12, 96 18" fill="none" stroke="#c8a24a" strokeWidth="1.6" opacity="0.8" />
        <path d="M4 54 C 18 48, 28 58, 40 52 S 62 46, 72 52 S 88 58, 96 50" fill="none" stroke="#5f8fb8" strokeWidth="1.8" opacity="0.85" />
        <text x="8" y="13" className="conquest-map__river">黄河</text>
        <text x="90" y="58" className="conquest-map__river">长江</text>
        {edges.map((edge, index) => (
          <line key={index} x1={edge.from.x} y1={edge.from.y} x2={edge.to.x} y2={edge.to.y} className={edge.held ? 'conquest-edge is-held' : 'conquest-edge'} />
        ))}
        {/* 本府 */}
        <g className={`conquest-node is-home ${selectedId === 'home' ? 'is-selected' : ''}`} onClick={() => setSelectedId('home')} role="button" aria-label="荆州 本府">
          <rect x={HOME_NODE.x - 4} y={HOME_NODE.y - 4} width="8" height="8" rx="1.5" />
          <text x={HOME_NODE.x} y={HOME_NODE.y + 8.6}>荆州</text>
        </g>
        {fiefs.map((fief) => {
          const state = stateOf(fief);
          return (
            <g key={fief.id} className={`conquest-node is-${state} ${selectedId === fief.id ? 'is-selected' : ''}`} onClick={() => setSelectedId(fief.id)} role="button" aria-label={`${fief.name} ${state === 'owned' ? '已归府下' : state === 'attackable' ? '可出兵' : '未接壤'}`}>
              {state === 'attackable' && <circle cx={fief.x} cy={fief.y} r="5.6" className="conquest-node__ring" />}
              <circle cx={fief.x} cy={fief.y} r="3.6" />
              {state === 'owned' && <path d={`M${fief.x + 0.6} ${fief.y - 3.4} v-6 l4.6 1.6 -4.6 1.8`} className="conquest-node__flag" />}
              <text x={fief.x} y={fief.y + 7.6}>{fief.name.replace('郡', '')}</text>
            </g>
          );
        })}
      </svg>
      {notice && <p className="conquest-notice" role="status">{notice}</p>}
      {panel}
    </section>
  );
}
