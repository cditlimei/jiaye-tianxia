import type { Enemy, HomeLevel, Lord, Partner, Weapon } from '../data/gameData';
import { enemies } from '../data/gameData';

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
  const beatable = enemies.filter((enemy) => enemy.power <= totalPower);
  const tier = beatable[beatable.length - 1] ?? enemies[0];
  return { ...tier, power: Math.round(totalPower * enemyScale(totalPower)) };
}

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

