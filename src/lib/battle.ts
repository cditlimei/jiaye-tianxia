import type { Enemy, HomeLevel, Lord, Partner, Weapon } from '../data/gameData';
import type { BattleMode } from '../types';
import { courtEnemies, enemies, frontierEnemies, navalEnemies } from '../data/gameData';

export function weaponBonusForLord(weapon: Weapon, lordId: string) {
  return weapon.bestMatchLordId === lordId ? Math.round(weapon.strengthBonus * 1.5) : weapon.strengthBonus;
}

export function partnerStrengthBonus(partner: Partner, lordId: string) {
  const raw = partner.bonus.strength ?? 0;
  return partner.bestMatchLordId === lordId ? Math.round(raw * 1.3) : raw;
}

export function partnerIntelligenceBonus(partner: Partner, lordId: string) {
  const raw = partner.bonus.intelligence ?? 0;
  return partner.bestMatchLordId === lordId ? Math.round(raw * 1.3) : raw;
}

export function partnerCharismaBonus(partner: Partner, lordId: string) {
  const raw = partner.bonus.charisma ?? 0;
  return partner.bestMatchLordId === lordId ? Math.round(raw * 1.3) : raw;
}

// 智谋每 10 点让处理政务收入 +1%，声望每 10 点让招募伴侣便宜 1%（最多 30%）
export function incomeMultiplier(intelligence: number) {
  return 1 + Math.floor(intelligence / 10) / 100;
}

/** 宅邸收入 × 屯田比例 × 家业点 × 智谋 */
export function totalDailyIncome(homeIncome: number, farmPercent: number, legacyPoints: number, intelligence: number, farmFlat = 0) {
  return effectiveDailyIncome(Math.round((homeIncome * (1 + farmPercent / 100) + farmFlat) * legacyIncomeMultiplier(legacyPoints)), intelligence);
}

export function effectiveDailyIncome(baseIncome: number, intelligence: number) {
  return Math.round(baseIncome * incomeMultiplier(intelligence));
}

export function recruitDiscountPercent(charisma: number) {
  return Math.min(30, Math.floor(charisma / 10));
}

export function effectiveRecruitCost(baseCost: number, charisma: number) {
  return Math.round(baseCost * (1 - recruitDiscountPercent(charisma) / 100));
}

export function calculateTotalPower(lord: Lord, ownedPartners: Partner[], weapon: Weapon, home: HomeLevel) {
  const homeBonus = home.level * 5;
  const partnerBonus = ownedPartners.reduce((sum, partner) => sum + partnerStrengthBonus(partner, lord.id), 0);
  return Math.round(lord.strength + weaponBonusForLord(weapon, lord.id) + partnerBonus + homeBonus);
}

export function calculateIntelligence(lord: Lord, ownedPartners: Partner[]) {
  return Math.round(
    lord.intelligence + ownedPartners.reduce((sum, partner) => sum + partnerIntelligenceBonus(partner, lord.id), 0)
  );
}

export function calculateCharisma(lord: Lord, ownedPartners: Partner[]) {
  return Math.round(
    lord.charisma + ownedPartners.reduce((sum, partner) => sum + partnerCharismaBonus(partner, lord.id), 0)
  );
}

// 敌军档位（名字与缴获）取不高于玩家战力的最强一档；实际战力随玩家浮动，
// 系数由蒙特卡洛标定，使各战力段胜率稳定在 75% 左右（血量公式让高战力段需略降系数）
const ENEMY_SCALE_POINTS: Array<[power: number, scale: number]> = [
  [40, 1.012],
  [130, 1.002],
  [300, 0.992],
  [700, 0.984],
  [1000, 0.981]
];

export function matchEnemy(totalPower: number): Enemy {
  return matchEnemyFrom(enemies, totalPower);
}

export function matchNavalEnemy(navalPower: number): Enemy {
  return matchEnemyFrom(navalEnemies, navalPower);
}

export function matchCourtEnemy(courtPower: number): Enemy {
  return matchEnemyFrom(courtEnemies, courtPower);
}

export function matchFrontierEnemy(totalPower: number): Enemy {
  return matchEnemyFrom(frontierEnemies, totalPower);
}

function matchEnemyFrom(list: Enemy[], power: number): Enemy {
  return enemyForTier(list, recommendedTierIndex(list, power), power);
}

export const ROSTERS: Record<BattleMode, Enemy[]> = { land: enemies, naval: navalEnemies, court: courtEnemies, frontier: frontierEnemies };

/** 推荐档：不高于己方实力的最强一档 */
export function recommendedTierIndex(list: Enemy[], power: number) {
  let index = 0;
  list.forEach((enemy, i) => {
    if (enemy.power <= power) index = i;
  });
  return index;
}

// 对手实力相对推荐档的倍率。伤害公式对实力比很敏感，直接用档位原始实力会让高一档就 0% 胜率，
// 所以按与推荐档的档位差定倍率：约 -2 档 ~100%、-1 档 ~95%、推荐 ~75%、+1 档 ~45%、+2 档 ~20%、+3 档 ~5%
// 目标胜率：按己方实力与该档的连续距离插值（推荐档 75%，高一档 45%，高两档 20%……），
// 再反推敌人实力。直接用实力倍率时，低战力段血量里的固定值占比大，会出现战力越高胜率越低
const TARGET_ODDS: Array<[offset: number, odds: number]> = [[-3, 0.99], [-2, 0.97], [-1, 0.92], [0, 0.75], [1, 0.45], [2, 0.2], [3, 0.06], [4, 0.02]];

/** 己方实力在档位表里的连续位置：刚到某档门槛 = 该档序号，介于两档之间按比例插值 */
function tierPosition(list: Enemy[], power: number) {
  if (power <= list[0].power) return 0;
  for (let i = 0; i < list.length - 1; i += 1) {
    if (power < list[i + 1].power) return i + (power - list[i].power) / (list[i + 1].power - list[i].power);
  }
  // 超过最高档门槛后继续按最后一段的间距外推，战力再涨胜率也会跟着涨
  const last = list.length - 1;
  const gap = list.length > 1 ? list[last].power - list[last - 1].power : list[last].power;
  return last + (power - list[last].power) / Math.max(1, gap);
}

/**
 * 战败折损：胜率越低折损越重（胜率 100% 时 20%，0% 时 70%），
 * 让期望收益在推荐档（约 75%）附近最高，往上硬冲不再稳赚。
 */
/** 胜率显示：按 5% 取整，但永远不写 100% 或 0%（实际最高 99%） */
export function oddsPercentLabel(odds: number) {
  return Math.min(99, Math.max(1, Math.round(odds * 20) * 5));
}

export function battleLossRate(odds: number) {
  return 0.2 + 0.5 * (1 - Math.min(1, Math.max(0, odds)));
}

export function battleLossGold(rewardGold: number, odds: number) {
  return Math.round(rewardGold * battleLossRate(odds));
}

/** 每道军令的期望得失 */
export function expectedTierGold(rewardGold: number, odds: number) {
  return odds * rewardGold - (1 - odds) * battleLossGold(rewardGold, odds);
}

/** 期望得失最高的档位，作为「推荐」 */
export function bestValueTierIndex(list: Enemy[], power: number) {
  let best = 0;
  let bestValue = -Infinity;
  list.forEach((tier, index) => {
    const value = expectedTierGold(tier.rewardGold, tierOddsFor(list, index, power));
    if (value > bestValue) {
      bestValue = value;
      best = index;
    }
  });
  return best;
}

function targetOdds(offset: number) {
  if (offset <= TARGET_ODDS[0][0]) return TARGET_ODDS[0][1];
  for (let i = 1; i < TARGET_ODDS.length; i += 1) {
    const [o1, p1] = TARGET_ODDS[i];
    if (offset <= o1) {
      const [o0, p0] = TARGET_ODDS[i - 1];
      return p0 + ((offset - o0) / (o1 - o0)) * (p1 - p0);
    }
  }
  return TARGET_ODDS[TARGET_ODDS.length - 1][1];
}

const enemyPowerCache = new Map<string, number>();

/** 二分出让胜率等于目标值的敌人实力（胜率随敌人实力单调下降） */
function solveEnemyPower(power: number, odds: number) {
  const key = `${power}:${odds.toFixed(3)}`;
  const cached = enemyPowerCache.get(key);
  if (cached !== undefined) return cached;
  let low = power * 0.5;
  let high = power * 1.6;
  for (let step = 0; step < 14; step += 1) {
    const mid = (low + high) / 2;
    // 公共随机数：同一己方实力下各候选敌人用同一串随机数，胜率随敌人实力平滑单调
    if (estimateWinRate(power, mid, 1500, power * 7919) > odds) low = mid;
    else high = mid;
  }
  // 战斗公式对实力比极敏感，敌人实力差 1 点胜率就能跳几个百分点，所以保留两位小数
  const result = Math.round(((low + high) / 2) * 100) / 100;
  enemyPowerCache.set(key, result);
  return result;
}

/** 界面显示的胜率：就是反推敌人实力时用的目标值，随己方实力单调上升 */
export function tierOddsFor(list: Enemy[], index: number, power: number) {
  const safeIndex = Math.min(Math.max(0, index), list.length - 1);
  return targetOdds(safeIndex - tierPosition(list, power));
}

/** 推荐档胜率约 75%；其他档位按连续距离给目标胜率，保证战力越高同一档胜率只升不降 */
export function enemyForTier(list: Enemy[], index: number, power: number): Enemy {
  const safeIndex = Math.min(Math.max(0, index), list.length - 1);
  const tier = list[safeIndex];
  const offset = safeIndex - tierPosition(list, power);
  return { ...tier, power: solveEnemyPower(Math.max(1, Math.round(power)), targetOdds(offset)) };
}

// 传位：宅邸到王城后可把家业传给下一代。全部金币换成家业点（每 10 万金 1 点，最多累计 20 点），
// 每点让处理政务与屯田收入永久 +5%；主公、伴侣、兵器、宅邸、屯田、任务全部重来
export const SUCCESSION_HOME_LEVEL = 6;
export const LEGACY_GOLD_PER_POINT = 100000;
export const LEGACY_MAX_POINTS = 20;
export const LEGACY_INCOME_PER_POINT = 0.05;
export const LEGACY_START_GOLD_PER_POINT = 3000;

/** 这次传位实际能新增的家业点（已扣掉累计上限） */
export function legacyPointsGainable(gold: number, currentPoints: number) {
  return Math.max(0, Math.min(legacyPointsFor(gold), LEGACY_MAX_POINTS - currentPoints));
}

export function legacyPointsFor(gold: number) {
  return Math.floor(Math.max(0, gold) / LEGACY_GOLD_PER_POINT);
}

export function legacyIncomeMultiplier(points: number) {
  return 1 + Math.min(LEGACY_MAX_POINTS, Math.max(0, points)) * LEGACY_INCOME_PER_POINT;
}

export const PLAYER_CRIT_RATE = 0.18;
export const ENEMY_CRIT_RATE = 0.12;

export function playerMaxHp(attackPower: number) {
  return 100 + Math.round(attackPower * 0.5);
}

export function enemyMaxHp(enemyPower: number) {
  return 90 + Math.round(enemyPower * 0.55);
}

/** 与战斗页同一套回合规则的快速模拟，给玩家看预估胜率 */
export function estimateWinRate(attackPower: number, enemyPower: number, runs = 600, seed = attackPower * 7919 + enemyPower * 104729) {
  const rand = seededRandom(seed);
  let wins = 0;
  for (let i = 0; i < runs; i += 1) {
    let playerHp = playerMaxHp(attackPower);
    let enemyHp = enemyMaxHp(enemyPower);
    for (let round = 0; round < 500; round += 1) {
      enemyHp -= rollDamage(attackPower, enemyPower, rand() < PLAYER_CRIT_RATE, rand);
      if (enemyHp <= 0) {
        wins += 1;
        break;
      }
      playerHp -= rollDamage(enemyPower, attackPower, rand() < ENEMY_CRIT_RATE, rand);
      if (playerHp <= 0) break;
    }
  }
  return wins / runs;
}

// 水战不看兵器：智谋 + 宅邸
export function calculateNavalPower(lord: Lord, ownedPartners: Partner[], home: HomeLevel) {
  return calculateIntelligence(lord, ownedPartners) + home.level * 5;
}

// 朝堂不看兵器：声望 + 宅邸
export function calculateCourtPower(lord: Lord, ownedPartners: Partner[], home: HomeLevel) {
  return calculateCharisma(lord, ownedPartners) + home.level * 5;
}

export const NAVAL_UNLOCK_HOME_LEVEL = 3;
export const COURT_UNLOCK_HOME_LEVEL = 4;

function enemyScale(totalPower: number) {
  const points = ENEMY_SCALE_POINTS;
  if (totalPower <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    const [rightPower, rightScale] = points[index];
    if (totalPower <= rightPower) {
      const [leftPower, leftScale] = points[index - 1];
      return leftScale + ((totalPower - leftPower) / (rightPower - leftPower)) * (rightScale - leftScale);
    }
  }
  return points[points.length - 1][1];
}

export function rollDamage(attackerPower: number, defenderPower: number, isCritical: boolean, rand: () => number = Math.random) {
  const base = attackerPower * 0.1 + rand() * attackerPower * 0.3;
  const scaled = (base / Math.max(1, defenderPower)) * 20;
  const damage = Math.max(1, Math.round(isCritical ? scaled * 2 : scaled));
  return damage;
}



/** mulberry32：给胜率估算一个可复现的随机序列 */
function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
