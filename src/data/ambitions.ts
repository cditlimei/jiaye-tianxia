import type { GameState } from '../types';
import { nextFief, ownedFiefCount } from './fiefs';
import { genDefends, genWins } from './dynasty';
import { AMBITION_FULL_GOLD, legacyPointsGainable, LEGACY_MAX_POINTS, successionPlan } from '../lib/battle';
import { legacyPriceRateFor } from './traditions';
import { fiefCostOf } from '../lib/prices';

/**
 * 本代志向：第二代起每代开局三选一（v3.1 起不再因家业点满而隐藏），传位时结算。
 * 达成记入家谱，传位时得 1 点家业点（家学渊源 2 点；已满 20 点改发 3 万金）。
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
  /** sixFull：定志向时六郡已满（开疆改为守城） */
  describe: (target: number, sixFull?: boolean) => string;
  /** 门槛/预计，给选项卡第三行 */
  hint: (state: GameState, target: number) => string;
}

/** 目标按世代线性递增，封顶在第 20 代 */
const gen = (generation: number) => Math.min(20, Math.max(2, generation));

/** v3.1 前的志向奖励（下一代开局多得的金），只剩老存档「传位后待择主」旧流程用 */
export const AMBITION_REWARD_GOLD = 10000;
export const AMBITION_TITLE_COUNT = 3;
/** 家业点已满时，志向奖励的每 1 点改发多少金（定义在 lib/battle，与传位结算同处） */
export { AMBITION_FULL_GOLD };
/** 六郡已满时开疆改为「本代守住 N 次邻郡反攻」 */
export const EXPANSION_DEFEND_TARGET = 2;
const sixFullOf = (state: GameState) => (state.ambition?.baseFiefs ?? ownedFiefCount(state.fiefs)) >= 6;

export const ambitions: Ambition[] = [
  {
    id: 'wealth',
    name: '富国',
    motto: '仓廪实而知礼节',
    target: (generation) => 500000 + (gen(generation) - 2) * 250000,
    // 传位时府库里没收的金子先并入再结算，所以进度也算上府库
    progress: (state) => state.gold + (state.treasury?.gold ?? 0),
    unit: '金',
    describe: (target) => `传位时府库存金达 ${target.toLocaleString()} 金`,
    hint: (state, target) => {
      const points = legacyPointsGainable(target, state.legacyPoints, legacyPriceRateFor(state));
      return state.legacyPoints >= LEGACY_MAX_POINTS ? `家业点已满，这笔钱留作军资，难度${target >= 500000 ? '高' : '中'}` : `够折 ${points} 点家业点，难度${target >= 500000 ? '高' : '中'}`;
    }
  },
  {
    id: 'might',
    name: '强兵',
    motto: '兵者，国之大事',
    target: (generation) => 30 + (gen(generation) - 2) * 10,
    // v3.1 起传位不清胜场，按本代新增算
    progress: (state) => genWins(state),
    unit: '胜',
    describe: (target) => `本代累计 ${target} 场胜利`,
    hint: (_state, target) => `军令约 2 小时回 1 道，攒够约 ${target * 2} 小时，难度中`
  },
  {
    id: 'expansion',
    name: '开疆',
    motto: '普天之下，莫非王土',
    target: () => 1,
    // 按本代最高郡数算：失郡不倒退，丢了再收复也刷不出进度；六郡已满时改按本代守住反攻的次数
    progress: (state) => sixFullOf(state)
      ? genDefends(state)
      : Math.max(0, Math.max(state.peakFiefs ?? 0, ownedFiefCount(state.fiefs)) - (state.ambition?.baseFiefs ?? 0)),
    unit: '郡',
    describe: (target, sixFull) => (sixFull ? `六郡已满，本代守住 ${target} 次邻郡反攻` : `本代新开拓 ${target} 郡封地`),
    hint: (state) => {
      const next = nextFief(state.fiefs);
      if (!next) return '六郡已满，改为守城：反攻约 2 日一次，难度中';
      const cost = fiefCostOf(state, next);
      return `${state.homeLevel < 5 ? '需侯府，' : ''}${next.name} ${cost.toLocaleString()} 金，难度${cost >= 250000 ? '高' : '中'}`;
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

/** 三项都可选（v3.1：六郡已满时开疆改为守城，不再隐藏） */
export function availableAmbitions(_state: GameState) {
  return ambitions;
}

/** 定志向时的目标：开疆在六郡已满时改为守住 2 次反攻 */
export function ambitionTargetFor(ambition: Ambition, generation: number, baseFiefs: number) {
  return ambition.id === 'expansion' && baseFiefs >= 6 ? EXPANSION_DEFEND_TARGET : ambition.target(generation);
}

/** 志向卡上的一项：按当前郡数算目标与说明 */
export function ambitionPreview(ambition: Ambition, state: GameState) {
  const baseFiefs = Math.max(state.peakFiefs ?? 0, ownedFiefCount(state.fiefs));
  const target = ambitionTargetFor(ambition, state.generation, baseFiefs);
  return { target, text: ambition.describe(target, baseFiefs >= 6), hint: ambition.hint(state, target) };
}

/** 志向达成后传位得几点家业点、超出上限的改发多少金（points：称号定的 1 或 2 点；current：传位前的家业点；金子折点给志向点让位，见 successionPlan） */
export function ambitionLegacyReward(current: number, points: number) {
  const plan = successionPlan(0, current, 1, points);
  return { points: plan.rewardPoints, gold: plan.rewardGold };
}

/** 志向奖励的说法：几点家业点、或已满改发多少金（与 successionPlan 同一算法） */
function ambitionRewardText(reward: { points: number; gold: number }) {
  const parts = [reward.points > 0 ? `${reward.points} 点家业点` : '', reward.gold > 0 ? `${reward.gold.toLocaleString()} 金（家业点已满）` : ''].filter(Boolean);
  return parts.join('、') || '0 点家业点';
}

/** 传位面板/confirm 用的一句话（rewardPoints：志向达成得几点；按传位前的家业点算满没满，与 successionPlan 实扣一致） */
export function ambitionSummary(state: GameState, rewardPoints = 1) {
  if (state.generation < 2) return null;
  const status = ambitionStatus(state);
  const reward = ambitionRewardText(ambitionLegacyReward(state.legacyPoints, rewardPoints));
  if (!status) return `本代未定志向，传位后家谱记「未定志向」，拿不到 ${reward}。`;
  return status.done
    ? `本代志向「${status.ambition.name}」已达成，传位即载入家谱，得 ${reward}。`
    : `本代志向「${status.ambition.name}」${status.progress.toLocaleString()}/${status.target.toLocaleString()} ${status.unit}未竟，现在传位将记未竟。`;
}

export function ambitionStatus(state: GameState) {
  if (!state.ambition) return null;
  const ambition = findAmbition(state.ambition.id);
  if (!ambition) return null;
  const target = state.ambition.target;
  const progress = ambition.progress(state);
  const sixFull = ambition.id === 'expansion' && state.ambition.baseFiefs >= 6;
  return { ambition, target, progress, done: progress >= target, unit: sixFull ? '次' : ambition.unit, text: ambition.describe(target, sixFull) };
}

/** 家谱里达成志向的次数 */
export function ambitionsAchieved(state: Pick<GameState, 'chronicle'>) {
  return state.chronicle.filter((entry) => entry.ambitionDone).length;
}
