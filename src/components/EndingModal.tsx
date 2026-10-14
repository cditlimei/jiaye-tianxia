import { useState } from 'react';
import { dynastyCount, dynastySummary, findRealm, realms, type RealmId } from '../data/dynasty';
import { findLord } from '../data/gameData';
import { orderCapFor } from '../data/fiefs';
import type { GameState } from '../types';
import { GameButton } from './common/GameButton';
import { ModalShell } from './common/ModalShell';

interface EndingModalProps {
  state: GameState;
  dailyIncome: number;
  /** 本朝军令上限（含整军封地）；国号说明按新朝口径另算，不用它 */
  orderCap: number;
  onClose: () => void;
  onFound: (realm: RealmId) => void;
}

export function EndingModal({ state, dailyIncome, onClose, onFound }: EndingModalProps) {
  const summary = dynastySummary(state);
  const [realm, setRealm] = useState<RealmId>(state.realm ?? 'wei');
  const chosen = findRealm(realm)!;
  const lordName = findLord(state.selectedLordId)?.name ?? '主公';
  // 新朝封地清零，军令上限只剩基础值 + 历朝魏的加成
  const newDynastyOrderCap = orderCapFor({}, state.realms);
  const concrete: Record<RealmId, string> = {
    wei: `新朝军令上限 ${newDynastyOrderCap} → ${newDynastyOrderCap + 1}`,
    shu: `按本朝现在的收入折算约 +${Math.round(dailyIncome / 10).toLocaleString()} 金/日，前期量小后期可观`,
    wu: '相当于 1.5 个教化郡，开局战场即受益'
  };
  return (
    <ModalShell title="天下归心" onClose={onClose}>
      <div className="ending-sheet">
        <p className="ending-sheet__scroll">
          六郡尽归府下，王城巍峨，家业点已满。自开国至{lordName}，共 {summary.generations} 代、{summary.days.toLocaleString()} 日，{summary.wins.toLocaleString()} 场胜利，{summary.ambitions} 代志向达成。天下归心，可开创新朝。
        </p>
        <section className="fief-claim" aria-label="开创新朝">
          <div className="section-title">
            <span>新朝国号</span>
            <strong>第 {dynastyCount(state.realms) + 2} 朝</strong>
          </div>
          <p>定下新朝国号后，金、主公、伴侣、兵器、宅邸、屯田、封地、家业点与家谱全部归入前朝重来；国号加成永久保留，历朝可叠加。新朝开局每朝多得 20,000 金。{state.realm ? `本朝国号「${findRealm(state.realm)?.name}」将随本朝入前朝。` : ''}</p>
          <div className="fief-policies" role="radiogroup" aria-label="选择国号">
            {realms.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={realm === item.id} className={realm === item.id ? 'is-selected' : ''} onClick={() => setRealm(item.id)}>
                <strong>{item.name}</strong>
                <span>{item.effect}</span>
                <small>{concrete[item.id]}{state.realms[item.id] > 0 ? ` · 已立 ${state.realms[item.id]} 朝` : ''}</small>
              </button>
            ))}
          </div>
          <GameButton block variant="danger" onClick={() => onFound(realm)}>
            开创新朝 · 国号{chosen.name}
          </GameButton>
          <GameButton block variant="ghost" onClick={onClose}>
            再经营些时日
          </GameButton>
        </section>
        {state.pastDynasties.length > 0 && (
          <section className="chronicle" aria-label="前朝">
            <div className="section-title">
              <span>前朝</span>
              <strong>{state.pastDynasties.length} 朝</strong>
            </div>
            {state.pastDynasties.map((entry) => (
              <div key={entry.dynasty} className="chronicle-row is-done">
                <strong>第 {entry.dynasty} 朝{entry.realm ? ` · ${findRealm(entry.realm)?.name}` : ' · 开国'}</strong>
                <span>{entry.generations} 代 · {entry.days.toLocaleString()} 日 · {entry.wins.toLocaleString()} 胜 · {entry.ambitions} 代志向达成</span>
              </div>
            ))}
          </section>
        )}
      </div>
    </ModalShell>
  );
}
