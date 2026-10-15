import type { GameState } from '../types';
import { nextFief, ownedFiefCount } from './fiefs';

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
  /** 门槛/预计，给选项卡第三行 */
  hint: (state: GameState, target: number) => string;
}

/** 目标按世代线性递增，封顶在第 20 代 */
const gen = (generation: number) => Math.min(20, Math.max(2, generation));

export const AMBITION_REWARD_GOLD = 10000;
export const AMBITION_TITLE_COUNT = 3;

export const ambitions: Ambition[] = [
  {
    id: 'wealth',
    name: '富国',
    motto: '仓廪实而知礼节',
    target: (generation) => 500000 + (gen(generation) - 2) * 250000,
    progress: (state) => state.gold,
    unit: '金',
    describe: (target) => `传位时府库存金达 ${target.toLocaleString()} 金`,
    hint: (_state, target) => `约 ${Math.floor(target / 100000)} 点家业点的钱，难度${target >= 500000 ? '高' : '中'}`
  },
  {
    id: 'might',
    name: '强兵',
    motto: '兵者，国之大事',
    target: (generation) => 30 + (gen(generation) - 2) * 10,
    progress: (state) => state.battleWins,
    unit: '胜',
    describe: (target) => `本代累计 ${target} 场胜利`,
    hint: (_state, target) => `军令 2 日回 1 道，约 ${target * 2} 日，难度中`
  },
  {
    id: 'expansion',
    name: '开疆',
    motto: '普天之下，莫非王土',
    target: () => 1,
    // 按本代最高郡数算：失郡不倒退，丢了再收复也刷不出进度
    progress: (state) => Math.max(0, Math.max(state.peakFiefs ?? 0, ownedFiefCount(state.fiefs)) - (state.ambition?.baseFiefs ?? 0)),
    unit: '郡',
    describe: (target) => `本代新开拓 ${target} 郡封地`,
    hint: (state) => {
      const next = nextFief(state.fiefs);
      return next ? `${state.homeLevel < 5 ? '需侯府，' : ''}${next.name} ${next.cost.toLocaleString()} 金，难度${next.cost >= 250000 ? '高' : '中'}` : '六郡已满';
    }
  }
];

export const ownedFiefCountOf = ownedFiefCount;

export const CHRONICLE_MAX = 40;

/** 家谱超长时留开国第一代 + 最近的几代 */
export function trimChronicle<T>(entries: T[]) {
  if (entries.length <= CHRONICLE_MAX) return entries;
  return [entries[0], ...entries.slice(-(CHRONICLE_MAX - 1))];
}

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

/** 传位面板/confirm 用的一句话 */
export function ambitionSummary(state: GameState) {
  if (state.generation < 2) return null;
  const status = ambitionStatus(state);
  if (!status) return '本代未定志向，传位后家谱记「未定志向」，拿不到下一代的 10,000 金。';
  return status.done
    ? `本代志向「${status.ambition.name}」已达成，传位即载入家谱，下一代开局多得 ${AMBITION_REWARD_GOLD.toLocaleString()} 金。`
    : `本代志向「${status.ambition.name}」${status.progress.toLocaleString()}/${status.target.toLocaleString()} ${status.ambition.unit}未竟，现在传位将记未竟。`;
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
