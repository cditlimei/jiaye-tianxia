import type { GameState } from '../types';
import { ownedFiefCount } from './fiefs';
import { titleBonuses } from './titleEffects';
import { BEQUEST_MAX, treasuryBequestGold } from './factions';

/**
 * 终局与新朝：六郡尽归 + 王城，即「天下归心」（v3.1 起不看家业点，也不看世代）。
 * 可开创新朝（v3.2）：选国号 = 选下一朝的开局势力（factions.ts），再选遗泽（只管下一朝）；旧家谱归入前朝。
 * 国号效果 = 冻结的前朝遗泽 ancestralRealms + 本朝一份（effectiveRealms），不再按朝叠加；realms 计数只给家声、前朝录、HUD。
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
  // v3.2 删掉 court / naval 两个死分支（自动战已收起，只剩老存档中途离开结算会传进来，按 1 倍）
  if (mode === 'doudizhu') return 1 + Math.min(3, realms.wu) * REALM_BATTLE_BONUS;
  return 1;
}

/**
 * v3.2 国号效果口径：冻结的前朝遗泽（ancestralRealms，老档迁移时由历朝计数减本朝得来，之后只读）+ 本朝国号一份。
 * 所有 realm* 效果函数的入参都换成它；realms 计数照旧 +1，只给家声、前朝录与 HUD 用。
 * 缺 ancestralRealms 的局部 state（规则脚本、econ 旧对照）按旧口径直接用 realms。
 */
export function effectiveRealms(state: { realms: RealmCounts; realm?: RealmId | null; ancestralRealms?: RealmCounts | null }): RealmCounts {
  if (!state.ancestralRealms) return state.realms;
  const out = { ...state.ancestralRealms };
  if (state.realm) out[state.realm] += 1;
  return out;
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

/** 离天下归心还差什么（只差一样、且最多差 2 郡时提示，免得王城刚立就霸占「下一步」；文案不提家业点） */
export function endingHint(state: GameState) {
  if (isEndingReached(state)) return null;
  const missing = Math.max(0, 6 - ownedFiefCount(state.fiefs));
  const needHome = state.homeLevel < 6;
  if (missing === 0 && needHome) return '六郡已归，宅邸升至王城即天下归心。';
  if (missing > 0 && missing <= 2 && !needHome) return `王城已立，再得 ${missing} 郡即天下归心。`;
  return null;
}

/** 天下归心：六郡 + 王城 */
export function isEndingReached(state: Pick<GameState, 'fiefs' | 'homeLevel'>) {
  return ownedFiefCount(state.fiefs) >= 6 && state.homeLevel >= 6;
}

/** v3.1 传位后待择新主：没有主公、第二代起、伴侣还在（老存档「传位后待择主」伴侣已清空，走旧流程） */
export function isHeirPending(state: Pick<GameState, 'selectedLordId' | 'generation' | 'ownedPartnerIds'>) {
  return !state.selectedLordId && state.generation > 1 && state.ownedPartnerIds.length > 0;
}

/** 本代日数与胜场（传位不重置，按本代起点算差） */
export const genDays = (state: Pick<GameState, 'day' | 'genStart'>) => Math.max(1, state.day - (state.genStart?.day ?? 1) + 1);
export const genWins = (state: Pick<GameState, 'battleWins' | 'genStart'>) => Math.max(0, state.battleWins - (state.genStart?.wins ?? 0));
export const genDefends = (state: Pick<GameState, 'frontierWins' | 'genStart'>) => Math.max(0, state.frontierWins - (state.genStart?.defends ?? 0));

/** 终局卷轴上的本朝总账（含本代） */
export function dynastySummary(state: GameState, now = Date.now()) {
  const past = state.chronicle;
  // 开府天数（真实天数）：各代相加；v2.3 前传位的代没有这项，就不写
  const current = Number.isFinite(state.foundedAt) && state.foundedAt <= now ? Math.floor((now - state.foundedAt) / 86400000) + 1 : 1;
  const openDays = past.every((entry) => typeof entry.openDays === 'number') ? past.reduce((sum, entry) => sum + (entry.openDays ?? 0), 0) + current : undefined;
  return {
    openDays,
    generations: state.generation,
    // v3.1 起传位不重置日子与战绩：本代 = 当前 − 本代起点（老存档起点为 1 日 0 胜，与旧算法一致）
    days: past.reduce((sum, entry) => sum + entry.days, 0) + genDays(state),
    wins: past.reduce((sum, entry) => sum + entry.wins, 0) + genWins(state),
    // 旧家谱里的志向（v3.2 起志向下线，新朝只看宏愿）
    ambitions: past.filter((entry) => entry.ambitionDone).length,
    vowDone: Boolean(state.vow?.done),
    fiefs: ownedFiefCount(state.fiefs)
  };
}

/**
 * 统一时能选几项遗泽：基础 1；本朝宏愿达成再 +1（家学渊源 +2）；老档有家风补 1（只发一次）；最多 3 项。
 */
export function bequestSlots(state: GameState) {
  const vow = state.vow?.done ? titleBonuses(state).ambitionPoints : 0;
  const tradition = state.migrationComp?.bequest ? 1 : 0;
  return Math.min(BEQUEST_MAX, 1 + vow + tradition);
}

/** 开国金（v3.2）：固定 1,000 + 2 万（不再按朝数累加），遗泽府库另加，老档下一次开朝一次性补发旧版按朝累加的差额 */
export function foundingGoldFor(state: GameState, withTreasury: boolean) {
  const base = 1000 + DYNASTY_START_GOLD;
  const treasury = withTreasury ? treasuryBequestGold(state.legacyPoints) : 0;
  // 旧规则：第 N 朝开局多得 (N − 1) × 2 万；新朝是第 pastDynasties + 2 朝
  const oldRule = (state.pastDynasties.length + 1) * DYNASTY_START_GOLD;
  const comp = state.migrationComp?.founding ? Math.max(0, oldRule - DYNASTY_START_GOLD) : 0;
  return { base, treasury, comp, total: base + treasury + comp };
}
