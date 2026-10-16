import type { GameState } from '../types';
import type { AmbitionId } from './ambitions';

/**
 * 家风：连续两代达成同一志向即成家风，只认最近两代（换志向就断）。
 * 富国家风 家业点更便宜 / 强兵家风 每代开局军令满 / 开疆家风 封地开拓与改方略九折。
 * v3.2 起志向下线、家风不再新立：traditionOf 只给家谱显示；老档迁移时把已有家风冻结进 legacyTradition，
 * 效果只管到本朝结束（价格不变、不吃亏），下一次统一时遗泽多选 1 项补回（migrationComp.bequest）。
 */
export interface Tradition {
  id: AmbitionId;
  name: string;
  effect: string;
}

/** 富国家风：传位折家业点八折（v3.1 起家业点递增价，见 lib/battle.ts legacyPointCost） */
export const TRADITION_LEGACY_PRICE_RATE = 0.8;
export const TRADITION_FIEF_DISCOUNT = 0.9;

export const traditions: Tradition[] = [
  { id: 'wealth', name: '富国家风', effect: '传位折家业点八折' },
  { id: 'might', name: '强兵家风', effect: '每代开局军令直接满额' },
  { id: 'expansion', name: '开疆家风', effect: '封地开拓与改方略九折' }
];

export function traditionOf(chronicle: GameState['chronicle']) {
  if (chronicle.length < 2) return null;
  const [prev, last] = chronicle.slice(-2);
  if (!last.ambitionDone || !prev.ambitionDone || !last.ambition || last.ambition !== prev.ambition) return null;
  return traditions.find((item) => item.id === last.ambition) ?? null;
}

/** 上一代刚达成的志向：这一代再达成一次就成家风 */
export function traditionCandidate(chronicle: GameState['chronicle']) {
  const last = chronicle[chronicle.length - 1];
  return last?.ambitionDone && last.ambition && !traditionOf(chronicle) ? last.ambition : null;
}

/** 本朝还生效的家风（老档迁移冻结的那一个） */
export function activeTradition(state: Partial<Pick<GameState, 'legacyTradition'>>) {
  return state.legacyTradition ? traditions.find((item) => item.id === state.legacyTradition) ?? null : null;
}

/** 传位折家业点的价格系数：富国家风 0.8 */
export function legacyPriceRateFor(state: Partial<Pick<GameState, 'legacyTradition'>>) {
  return activeTradition(state)?.id === 'wealth' ? TRADITION_LEGACY_PRICE_RATE : 1;
}
// 开拓价、改方略价 v3.1 起统一走 lib/prices.ts（fiefCostOf / policyChangeCostOf），这里只留家风判定
