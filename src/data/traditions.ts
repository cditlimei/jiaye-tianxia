import type { GameState } from '../types';
import type { AmbitionId } from './ambitions';
import type { Fief } from './fiefs';
import { policyChangeCost } from './fiefs';
import { LEGACY_GOLD_PER_POINT } from '../lib/battle';

/**
 * 家风：连续两代达成同一志向即成家风，只认最近两代（换志向就断）。
 * 富国家风 家业点更便宜 / 强兵家风 每代开局军令满 / 开疆家风 封地开拓与改方略九折。
 */
export interface Tradition {
  id: AmbitionId;
  name: string;
  effect: string;
}

export const TRADITION_LEGACY_GOLD_PER_POINT = 80000;
export const TRADITION_FIEF_DISCOUNT = 0.9;

export const traditions: Tradition[] = [
  { id: 'wealth', name: '富国家风', effect: `传位时每 ${TRADITION_LEGACY_GOLD_PER_POINT.toLocaleString()} 金换 1 点家业点` },
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

export function legacyGoldPerPointFor(state: Pick<GameState, 'chronicle'>) {
  return traditionOf(state.chronicle)?.id === 'wealth' ? TRADITION_LEGACY_GOLD_PER_POINT : LEGACY_GOLD_PER_POINT;
}

export function fiefCostFor(state: Pick<GameState, 'chronicle'>, fief: Fief) {
  return traditionOf(state.chronicle)?.id === 'expansion' ? Math.round(fief.cost * TRADITION_FIEF_DISCOUNT) : fief.cost;
}

export function policyChangeCostFor(state: Pick<GameState, 'chronicle'>, fief: Fief) {
  return traditionOf(state.chronicle)?.id === 'expansion' ? Math.round(policyChangeCost(fief) * TRADITION_FIEF_DISCOUNT) : policyChangeCost(fief);
}
