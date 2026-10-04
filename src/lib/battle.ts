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
const TIER_OFFSET_MULTIPLIER: Record<number, number> = { [-3]: 0.8, [-2]: 0.86, [-1]: 0.93, 0: 1, 1: 1.04, 2: 1.08, 3: 1.16 };

/** 推荐档按己方实力浮动（胜率约 75%）；自选其他档位按档位差加减实力：打弱的稳赢拿小钱，打强的赌运气拿大钱 */
export function enemyForTier(list: Enemy[], index: number, power: number): Enemy {
  const safeIndex = Math.min(Math.max(0, index), list.length - 1);
  const tier = list[safeIndex];
  const offset = safeIndex - recommendedTierIndex(list, power);
  const multiplier = TIER_OFFSET_MULTIPLIER[offset] ?? (offset > 0 ? 1.24 : 0.8);
  return { ...tier, power: Math.round(power * enemyScale(power) * multiplier) };
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
export function estimateWinRate(attackPower: number, enemyPower: number, runs = 400) {
  let wins = 0;
  for (let i = 0; i < runs; i += 1) {
    let playerHp = playerMaxHp(attackPower);
    let enemyHp = enemyMaxHp(enemyPower);
    for (let round = 0; round < 500; round += 1) {
      enemyHp -= rollDamage(attackPower, enemyPower, Math.random() < PLAYER_CRIT_RATE);
      if (enemyHp <= 0) {
        wins += 1;
        break;
      }
      playerHp -= rollDamage(enemyPower, attackPower, Math.random() < ENEMY_CRIT_RATE);
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

export function rollDamage(attackerPower: number, defenderPower: number, isCritical: boolean) {
  const base = randomBetween(attackerPower * 0.1, attackerPower * 0.4);
  const scaled = (base / Math.max(1, defenderPower)) * 20;
  const damage = Math.max(1, Math.round(isCritical ? scaled * 2 : scaled));
  return damage;
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

