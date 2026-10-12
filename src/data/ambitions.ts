import type { GameState } from '../types';
import { ownedFiefCount } from './fiefs';

/**
 * 本代志向：第二代起每代开局三选一，传位时结算。达成记入家谱，下一代开局多拿金。
 * 目标按世代递增，让每一代都有自己的事要做，而不是把上一代再玩一遍。
 */
export type AmbitionId = 'wealth' | 'might' | 'expansion';

export interface Ambition {
  id: AmbitionId;
  name: string;
  motto: string;
  /** 该世代的目标值 */
  target: (generation: number) => number;
  /** 当前进度（只看本代） */
  progress: (state: GameState) => number;
  unit: string;
  describe: (target: number) => string;
}

export const AMBITION_REWARD_GOLD = 10000;
export const AMBITION_TITLE_COUNT = 3;

export const ambitions: Ambition[] = [
  {
    id: 'wealth',
    name: '富国',
    motto: '仓廪实而知礼节',
    target: (generation) => 500000 + (generation - 2) * 250000,
    progress: (state) => state.gold,
    unit: '金',
    describe: (target) => `传位时府库存金达 ${target.toLocaleString()} 金`
  },
  {
    id: 'might',
    name: '强兵',
    motto: '兵者，国之大事',
    target: (generation) => 30 + (generation - 2) * 10,
    progress: (state) => state.battleWins,
    unit: '胜',
    describe: (target) => `本代累计 ${target} 场胜利`
  },
  {
    id: 'expansion',
    name: '开疆',
    motto: '普天之下，莫非王土',
    target: () => 1,
    progress: (state) => Math.max(0, ownedFiefCount(state.fiefs) - (state.ambition?.baseFiefs ?? 0)),
    unit: '郡',
    describe: (target) => `本代新开拓 ${target} 郡封地`
  }
];

export const ownedFiefCountOf = ownedFiefCount;

export function findAmbition(id: string) {
  return ambitions.find((item) => item.id === id) ?? null;
}

export function isAmbitionId(value: unknown): value is AmbitionId {
  return value === 'wealth' || value === 'might' || value === 'expansion';
}

/** 六郡已满时开疆无从谈起，不给选 */
export function availableAmbitions(state: GameState) {
  return ambitions.filter((item) => item.id !== 'expansion' || ownedFiefCount(state.fiefs) < 6);
}

export function ambitionStatus(state: GameState) {
  if (!state.ambition) return null;
  const ambition = findAmbition(state.ambition.id);
  if (!ambition) return null;
  const target = state.ambition.target;
  const progress = ambition.progress(state);
  return { ambition, target, progress, done: progress >= target };
}

/** 家谱里达成志向的次数 */
export function ambitionsAchieved(state: GameState) {
  return state.chronicle.filter((entry) => entry.ambitionDone).length;
}
