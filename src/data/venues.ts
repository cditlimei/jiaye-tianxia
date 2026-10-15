import type { AiSkill } from '../lib/doudizhu';
import { bestValueTierIndex, smoothRecommendedValue, COURT_UNLOCK_HOME_LEVEL, expectedTierGold, NAVAL_UNLOCK_HOME_LEVEL, ROSTERS, tierOddsFor } from '../lib/battle';

export type VenueId = 'beginner' | 'middle' | 'high';
export interface Venue {
  id: VenueId;
  name: string;
  requiredPower: number;
  prize: string;
  rewardGold: number;
  aiSkill: AiSkill;
}

export const VENUES: Venue[] = [
  // 斗地主靠真本事：下面是底价，战力上来后按 venueRewardScale 随最佳自动战一起涨
  // 场次越高农民牌艺越好：生手会放水，老手中规中矩，高手会配合卡牌
  { id: 'beginner', name: '初级场', requiredPower: 0, prize: '对手生手', rewardGold: 3000, aiSkill: 'novice' },
  { id: 'middle', name: '中级场', requiredPower: 140, prize: '对手老手', rewardGold: 8000, aiSkill: 'veteran' },
  { id: 'high', name: '高级场', requiredPower: 190, prize: '对手高手', rewardGold: 20000, aiSkill: 'master' }
];

/** 一局斗地主的净期望（以场次缴获为 1）：胜方按倍数×份额拿缴获、负方付两成。
 *  笨玩家（永远出最小可出牌）实测：生手 0.506−0.2×0.282、老手 0.443−0.2×0.49、高手 0.505−0.2×0.464 */
export const DDZ_NET_VALUE: Record<AiSkill, number> = { novice: 0.45, veteran: 0.345, master: 0.412 };
/** 斗地主每道军令的期望收益 ≈ 同战力推荐档自动战的 1.2 倍，且不低于挑最划算那档自动战的 1.1 倍（要真打、耗时更长，得比挂机划算）。
 *  推荐档按战力在两档间连续过渡（smoothRecommendedValue）；10-15 平滑后从 1.5 调到 1.2，econ 轻度玩家王城仍约第 20 次上线 */
export const DDZ_VS_AUTO = 1.2;
export const DDZ_VS_BEST_AUTO = 1.1;

export interface BattlePowers {
  land: number;
  naval: number;
  court: number;
}

/** 当前已解锁的官道 / 江东 / 许都里，每道军令的最高期望缴获；pick 选推荐档或最划算档 */
export function bestAutoBattleValue(powers: BattlePowers, homeLevel: number, pick: 'recommended' | 'bestValue' = 'recommended') {
  const modes: (keyof BattlePowers)[] = ['land'];
  if (homeLevel >= NAVAL_UNLOCK_HOME_LEVEL) modes.push('naval');
  if (homeLevel >= COURT_UNLOCK_HOME_LEVEL) modes.push('court');
  return Math.max(
    0,
    ...modes.map((mode) => {
      const roster = ROSTERS[mode];
      if (pick === 'recommended') return smoothRecommendedValue(roster, powers[mode]);
      const index = bestValueTierIndex(roster, powers[mode]);
      return expectedTierGold(roster[index].rewardGold, tierOddsFor(roster, index, powers[mode]));
    })
  );
}

/** 斗地主缴获倍率：让能进的最高场次的期望收益达到上面两条基准；各场次同乘，保留高低场差距 */
export function venueRewardScale(powers: BattlePowers, homeLevel: number) {
  const top = [...VENUES].reverse().find((venue) => powers.land >= venue.requiredPower) ?? VENUES[0];
  const ddzValue = top.rewardGold * DDZ_NET_VALUE[top.aiSkill];
  const target = Math.max(DDZ_VS_AUTO * bestAutoBattleValue(powers, homeLevel), DDZ_VS_BEST_AUTO * bestAutoBattleValue(powers, homeLevel, 'bestValue'));
  return Math.max(1, target / ddzValue) * venueStageFactor(homeLevel);
}

/**
 * 宅邸档次放开缴获：茅草屋一局牌就顶上千天政务、第 10 日买空伴侣兵器（10-15 整体审视的头号问题），
 * 府邸前按档次打折，府邸起全额
 */
export const VENUE_STAGE_FACTOR = [0.15, 0.3, 0.6, 1, 1, 1];
export function venueStageFactor(homeLevel: number) {
  return VENUE_STAGE_FACTOR[Math.min(VENUE_STAGE_FACTOR.length, Math.max(1, homeLevel)) - 1];
}

/** 场次实际缴获（取整到百位） */
export function venueReward(venue: Venue, scale: number) {
  return Math.round((venue.rewardGold * scale) / 100) * 100;
}
