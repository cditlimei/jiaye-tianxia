import type { GameState } from '../types';
import { ownedFiefCount } from './fiefs';
import { LEGACY_MAX_POINTS } from '../lib/battle';
import { ambitionStatus } from './ambitions';

/**
 * 终局与新朝：六郡尽归 + 王城 + 家业点满，即「天下归心」。
 * 可开创新朝：定一国号，全部重来，但国号带来的加成永久保留并可跨朝叠加；旧家谱归入前朝。
 */
export type RealmId = 'wei' | 'shu' | 'wu';

export interface Realm {
  id: RealmId;
  name: string;
  motto: string;
  effect: string;
}

export const REALM_ORDER_BONUS = 1;
export const REALM_INCOME_PERCENT = 10;
export const REALM_STAT_BONUS = 6;
export const DYNASTY_START_GOLD = 20000;

export const realms: Realm[] = [
  { id: 'wei', name: '魏', motto: '挟天子以令诸侯', effect: `军令上限 +${REALM_ORDER_BONUS}，攻郡军资九折` },
  { id: 'shu', name: '蜀', motto: '兴复汉室，还于旧都', effect: `政务收入 +${REALM_INCOME_PERCENT}%，西蜀屯田九折` },
  { id: 'wu', name: '吴', motto: '据长江之险，保江东之地', effect: `武力、智谋、声望各 +${REALM_STAT_BONUS}，斗地主胜利缴获 +20%` }
];

export type RealmCounts = Record<RealmId, number>;

export const emptyRealms: RealmCounts = { wei: 0, shu: 0, wu: 0 };

export function isRealmId(value: unknown): value is RealmId {
  return value === 'wei' || value === 'shu' || value === 'wu';
}

export function findRealm(id: string) {
  return realms.find((item) => item.id === id) ?? null;
}

export const realmOrderBonus = (realms: RealmCounts) => realms.wei * REALM_ORDER_BONUS;
export const realmIncomePercent = (realms: RealmCounts) => realms.shu * REALM_INCOME_PERCENT;
export const realmStatBonus = (realms: RealmCounts) => realms.wu * REALM_STAT_BONUS;
export const dynastyCount = (realms: RealmCounts) => realms.wei + realms.shu + realms.wu;

/** 国号专属：魏 许都朝议缴获 +20%/朝、吴 江东水战缴获 +20%/朝（各封顶 +60%）、蜀 西蜀屯田九折/朝（封顶七折） */
export const REALM_BATTLE_BONUS = 0.2;
export const REALM_FARM_DISCOUNT = 0.1;
export function realmRewardScale(realms: RealmCounts, mode: string) {
  // 10-15 起官道/江东/许都自动战收起：吴的加成改给斗地主，魏改为攻郡军资折扣（realmConquestDiscount）
  if (mode === 'doudizhu') return 1 + Math.min(3, realms.wu) * REALM_BATTLE_BONUS;
  if (mode === 'court') return 1 + Math.min(3, realms.wei) * REALM_BATTLE_BONUS;
  if (mode === 'naval') return 1 + Math.min(3, realms.wu) * REALM_BATTLE_BONUS;
  return 1;
}

/** 魏：每立一次攻郡军资再打九折（最多三次） */
export function realmConquestDiscount(realms: RealmCounts) {
  return Math.pow(0.9, Math.min(3, realms.wei));
}
/** 今日军功：官道/江东/许都按日轮换，当日该战场缴获 +30%，让后期不只盯着一个战场 */
export const BOUNTY_MODES = ['land', 'naval', 'court'] as const;
export const BOUNTY_BONUS = 0.3;
export function bountyMode(day: number) {
  return BOUNTY_MODES[day % BOUNTY_MODES.length];
}
export function bountyScale(day: number, mode: string) {
  return bountyMode(day) === mode ? 1 + BOUNTY_BONUS : 1;
}

export function realmFarmCost(realms: RealmCounts, cost: number) {
  return Math.round(cost * (1 - Math.min(3, realms.shu) * REALM_FARM_DISCOUNT));
}

/** 离天下归心还差什么（六郡 + 王城齐了才提示家业点） */
export function endingHint(state: GameState) {
  if (isEndingReached(state) || ownedFiefCount(state.fiefs) < 6 || state.homeLevel < 6) return null;
  return `再得 ${LEGACY_MAX_POINTS - state.legacyPoints} 点家业点即天下归心，可开创新朝。`;
}

/**
 * 家业点已满但还没天下归心：传位不再加点（按钮灰），志向也无从结算，改提示还差几郡/王城。
 * 与 endingHint 互斥（那边要求六郡 + 王城已齐）。
 */
export function legacyMaxedHint(state: GameState) {
  if (state.legacyPoints < LEGACY_MAX_POINTS || isEndingReached(state)) return null;
  const missing = Math.max(0, 6 - ownedFiefCount(state.fiefs));
  const needHome = state.homeLevel < 6;
  if (missing > 0) return `家业点已满，只差 ${missing} 郡${needHome ? '并升至王城' : ''}即天下归心。`;
  return '家业点已满、六郡已归，宅邸升至王城即天下归心。';
}

/** 天下归心：六郡 + 王城 + 家业点满 */
export function isEndingReached(state: GameState) {
  return ownedFiefCount(state.fiefs) >= 6 && state.homeLevel >= 6 && state.legacyPoints >= LEGACY_MAX_POINTS;
}

/** 终局卷轴上的本朝总账（含本代） */
export function dynastySummary(state: GameState, now = Date.now()) {
  const past = state.chronicle;
  // 开府天数（真实天数）：各代相加；v2.3 前传位的代没有这项，就不写
  const current = Number.isFinite(state.foundedAt) && state.foundedAt <= now ? Math.floor((now - state.foundedAt) / 86400000) + 1 : 1;
  const openDays = past.every((entry) => typeof entry.openDays === 'number') ? past.reduce((sum, entry) => sum + (entry.openDays ?? 0), 0) + current : undefined;
  return {
    openDays,
    generations: state.generation,
    days: past.reduce((sum, entry) => sum + entry.days, 0) + state.day,
    wins: past.reduce((sum, entry) => sum + entry.wins, 0) + state.battleWins,
    // 本代志向此时一并计入
    ambitions: past.filter((entry) => entry.ambitionDone).length + (ambitionStatus(state)?.done ? 1 : 0),
    fiefs: ownedFiefCount(state.fiefs)
  };
}
