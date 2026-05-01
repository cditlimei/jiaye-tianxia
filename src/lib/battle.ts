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

export function matchEnemy(totalPower: number): Enemy {
  return enemies.find((enemy) => enemy.power >= totalPower) ?? enemies[enemies.length - 1];
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

