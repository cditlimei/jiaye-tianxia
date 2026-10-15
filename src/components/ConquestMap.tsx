import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AI_SKILL_LABEL } from '../lib/doudizhu';
import { attackableFiefs, CONQUEST_STAKE_RATE, FIEF_UNLOCK_HOME_LEVEL, fiefPolicies, fiefs, findFiefPolicy, HOME_NODE, ownedFiefCount, type Fief, type FiefHoldings, type FiefPolicyId } from '../data/fiefs';
import { formatRemaining } from '../lib/frontier';
import { FIEF_WALLS, reclaimRemainingMs, RECLAIM_STAKE_RATE, siegeBounty, wallRepairCost, type Siege } from '../lib/siege';

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
  /** 邻郡反攻：各郡城防、失郡时刻、进行中的反攻 */
  fiefWalls?: Record<string, number>;
  lostFiefs?: Record<string, number>;
  siege?: Siege | null;
  /** 打开时先选中的郡（首页告急条直达） */
  initialFiefId?: string;
  onDefend?: () => void;
  onAbandon?: () => void;
  onRepair?: (fiefId: string) => boolean;
}

type NodeState = 'owned' | 'attackable' | 'far';

const nodeById = (id: string) => (id === 'home' ? HOME_NODE : fiefs.find((fief) => fief.id === id) ?? null);

/** 地图上的倒计时写短：约 18 时 / 40 分 */
function shortRemaining(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  return minutes >= 60 ? `约${Math.floor(minutes / 60)}时` : `${minutes}分`;
}

/**
 * 疆域图：本府荆州 + 六郡。已归府下的郡染金插旗（旗下两格是城防），与疆域相邻的郡可出兵（红圈），其余待开疆。
 * 被反攻的郡红色脉动并写倒计时；城防不满的郡旗色转橙（特权暂停）；失去的郡褪色，72 小时内半价收复。
 * 点城看守将、特权与军资；攻郡打一局斗地主，胜则得郡；守城也打一局斗地主，城主坐庄、不耗军令。
 */
export function ConquestMap({ holdings, homeLevel, gold, orders, stakeFor, policyChangeCostFor, onConquer, onChangePolicy, escortPicker, fiefWalls = {}, lostFiefs = {}, siege = null, initialFiefId, onDefend, onAbandon, onRepair }: ConquestMapProps) {
  const attackable = useMemo(() => attackableFiefs(holdings), [holdings]);
  const stateOf = (fief: Fief): NodeState => (holdings[fief.id] ? 'owned' : attackable.some((item) => item.id === fief.id) ? 'attackable' : 'far');
  const [selectedId, setSelectedId] = useState<string>(() => {
    if (initialFiefId && fiefs.some((fief) => fief.id === initialFiefId)) return initialFiefId;
    if (siege && holdings[siege.fiefId]) return siege.fiefId;
    return [...attackable].sort((a, b) => a.cost - b.cost)[0]?.id ?? 'home';
  });
  const [policyId, setPolicyId] = useState<FiefPolicyId>('farming');
  const [notice, setNotice] = useState('');
  // 倒计时：半分钟刷一次
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  // 从首页告急条直达（去守城/去修城/去收复）：把该郡的主按钮滚进视口，免得点进来还要再找
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!initialFiefId) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = sectionRef.current?.querySelector('.conquest-panel');
      const target = panel?.querySelector('.conquest-defend, .conquest-repair, .conquest-go') ?? panel;
      target?.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
    // 只在打开时滚一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const selected = fiefs.find((fief) => fief.id === selectedId) ?? null;
  const owned = ownedFiefCount(holdings);
  const walls = (id: string) => fiefWalls[id] ?? FIEF_WALLS;
  const besieged = (id: string) => Boolean(siege && siege.fiefId === id && holdings[id]);
  const reclaimMs = (id: string) => reclaimRemainingMs({ lostFiefs, fiefs: holdings }, id, now);

  // 连线：每条边只画一次；两端都在疆域内画实线金色（失郡后自动收回）
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

  const repairButton = (fief: Fief) => {
    const cost = wallRepairCost(fief);
    return (
      <button
        type="button"
        className="conquest-repair"
        disabled={gold < cost}
        onClick={() => setNotice(onRepair?.(fief.id) ? `${fief.name}城防已修满，「${fief.perk.name}」恢复` : '金不足')}
      >
        {gold >= cost ? `修城 · ${cost.toLocaleString()} 金` : `修城 · 差 ${(cost - gold).toLocaleString()} 金`}
      </button>
    );
  };

  const wallLine = (fief: Fief) => {
    const w = walls(fief.id);
    return (
      <span className={`conquest-walls ${w < FIEF_WALLS ? 'is-alert' : ''}`}>
        城防 {w}/{FIEF_WALLS}{w < FIEF_WALLS ? ` · 告急：牌桌特权「${fief.perk.name}」暂停（劝农、整军、教化照常）` : ''}
      </span>
    );
  };

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
    if (state === 'owned' && ownedPolicy && besieged(selected.id) && siege) {
      const left = Math.max(0, siege.dueAt - now);
      return (
        <div className="conquest-panel is-owned is-besieged">
          <strong>{selected.name} · 告急</strong>
          <span className="conquest-siege-line">{siege.attacker}（{AI_SKILL_LABEL[siege.skill]}）卷土重来，{formatRemaining(left)}内应战守城。</span>
          {wallLine(selected)}
          <span>守城局：城主坐庄，不耗军令、不押军资，失手不扣金，随行伴侣照常出招。守住犒赏 {siegeBounty(selected).toLocaleString()} 金、城防回满；失手城防 −1，城防归零则郡暂归{siege.attacker}。逾期不应战城防 −1，最低留 1。</span>
          <button type="button" className="conquest-go conquest-defend" onClick={() => onDefend?.()}>
            迎战守城 · {siege.attacker}
          </button>
          <div className="conquest-siege-actions">
            {walls(selected.id) < FIEF_WALLS && repairButton(selected)}
            <button
              type="button"
              className="conquest-abandon"
              onClick={() => {
                if (!window.confirm(`弃城按守城未克处理：${selected.name}城防 −1${walls(selected.id) <= 1 ? '，城防归零，此郡暂归' + siege.attacker : ''}（不扣金）。确定弃城？`)) return;
                onAbandon?.();
                setNotice(`已弃守${selected.name}`);
              }}
            >
              弃城
            </button>
          </div>
        </div>
      );
    }
    if (state === 'owned' && ownedPolicy) {
      const changeCost = policyChangeCostFor(selected);
      return (
        <div className="conquest-panel is-owned">
          <strong>{selected.name} · 已归府下</strong>
          <span>方略「{ownedPolicy.name}」：{ownedPolicy.effect}</span>
          <span className="conquest-perk">牌桌特权「{selected.perk.name}」：{selected.perk.detail}</span>
          {wallLine(selected)}
          {walls(selected.id) < FIEF_WALLS && repairButton(selected)}
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
    const reclaimLeft = reclaimMs(selected.id);
    const blocker = homeLevel < FIEF_UNLOCK_HOME_LEVEL
      ? '宅邸升至侯府后可出兵攻郡'
      : orders < 1
        ? '军令不足，稍候回复（可先切磋）'
        : gold < stake
          ? `军资还差 ${(stake - gold).toLocaleString()} 金`
          : '';
    return (
      <div className={`conquest-panel is-attackable ${reclaimLeft > 0 ? 'is-lost' : ''}`}>
        <strong>{selected.name} · {reclaimLeft > 0 ? `暂归${selected.garrison}` : `守将 ${selected.garrison}`}（{AI_SKILL_LABEL[selected.skill]}）</strong>
        {reclaimLeft > 0
          ? <span className="conquest-siege-line">{formatRemaining(reclaimLeft)}内半价收复：只押开拓价 {Math.round(RECLAIM_STAKE_RATE * 100)}%（平时 {Math.round(CONQUEST_STAKE_RATE * 100)}%）。</span>
          : <span>{selected.description}</span>}
        <span className="conquest-perk">拿下后牌桌特权「{selected.perk.name}」：{selected.perk.detail}</span>
        <span>和守将打一局斗地主：胜则{selected.name}{reclaimLeft > 0 ? '重' : ''}归府下；未克则 {stake.toLocaleString()} 金军资没入敌手，可再攻。</span>
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
          {blocker || (reclaimLeft > 0 ? `收复${selected.name} · 耗 1 军令 · 押 ${stake.toLocaleString()} 金` : `出兵攻取${selected.name} · 耗 1 军令 · 押 ${stake.toLocaleString()} 金`)}
        </button>
      </div>
    );
  })();

  const alertFiefs = fiefs.filter((fief) => holdings[fief.id] && walls(fief.id) < FIEF_WALLS);

  return (
    <section ref={sectionRef} className="conquest-map" aria-label="天下疆域">
      <div className="section-title">
        <span>天下疆域 · 已有 {owned}/{fiefs.length} 郡{homeLevel < FIEF_UNLOCK_HOME_LEVEL ? ' · 侯府后可出兵' : ''}{siege && holdings[siege.fiefId] ? ` · ${fiefs.find((fief) => fief.id === siege.fiefId)?.name ?? ''}告急` : alertFiefs.length > 0 ? ` · ${alertFiefs.map((fief) => fief.name).join('、')}城防告急` : ''}</span>
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
          const w = walls(fief.id);
          const underSiege = besieged(fief.id);
          const lost = state !== 'owned' && reclaimMs(fief.id) > 0;
          const label = state === 'owned'
            ? `已归府下 · 城防 ${w}/${FIEF_WALLS}${underSiege ? ' · 告急' : w < FIEF_WALLS ? ' · 城防告急' : ''}`
            : state === 'attackable'
              ? lost ? `可出兵 · 暂归${fief.garrison} · 可半价收复` : '可出兵'
              : '未接壤';
          return (
            <g key={fief.id} className={`conquest-node is-${state} ${selectedId === fief.id ? 'is-selected' : ''} ${underSiege ? 'is-besieged' : ''} ${state === 'owned' && w < FIEF_WALLS ? 'is-wall-alert' : ''} ${lost ? 'is-lost' : ''}`} onClick={() => setSelectedId(fief.id)} role="button" aria-label={`${fief.name} ${label}`}>
              {(state === 'attackable' || underSiege) && <circle cx={fief.x} cy={fief.y} r="5.6" className="conquest-node__ring" />}
              <circle cx={fief.x} cy={fief.y} r="3.6" />
              {state === 'owned' && <path d={`M${fief.x + 0.6} ${fief.y - 3.4} v-6 l4.6 1.6 -4.6 1.8`} className="conquest-node__flag" />}
              {/* 城左两格城防：满格金、缺格空 */}
              {state === 'owned' && Array.from({ length: FIEF_WALLS }, (_v, i) => (
                <rect key={i} x={fief.x - 7.4 + i * 1.9} y={fief.y - 0.75} width="1.5" height="1.5" rx="0.3" className={`conquest-node__wall ${i < w ? 'is-full' : ''}`} />
              ))}
              {underSiege && siege && <text x={fief.x + 2.6} y={fief.y - 10.4} className="conquest-node__timer">{shortRemaining(siege.dueAt - now)}</text>}
              <text x={fief.x} y={fief.y + 7.6}>{fief.name.replace('郡', '')}</text>
              {lost && <text x={fief.x} y={fief.y + 11} className="conquest-node__lost">暂归{fief.garrison}</text>}
            </g>
          );
        })}
      </svg>
      {notice && <p className="conquest-notice" role="status">{notice}</p>}
      {panel}
    </section>
  );
}
