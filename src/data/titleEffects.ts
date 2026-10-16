import type { GameState } from '../types';
import { ownedFiefCount } from './fiefs';
import { ambitionsAchieved } from './ambitions';

/**
 * v3.1 称号：22 个精简为 11 个，每个都有效果（白身是底座）。
 * - 本朝称号 6 个：现算、不落存档（传位不再重置，battleWins/frontierWins 跟本朝走，开新朝清零）
 * - 家声 5 个：记入 earnedTitles，只增不减
 * - 退役家声 5 个（旧誉）：白名单保留在存档里，只在主公页灰字列出、解锁一块纪念匾，没有效果
 * 所有效果都从 titleBonuses 取，接入点见各常量注释。econ-sim 用 TITLES=0 把 TITLES_ENABLED 改成 false 做对照。
 */
export const TITLES_ENABLED = true;
/** 家学渊源：志向累计达成次数（顶层常量不从 ambitions 取，免得循环引用时取到未初始化的值） */
export const SCHOLARLY_AMBITION_COUNT = 3;

export type CurrentTitleId = 'commoner' | 'gentry' | 'marquis-house' | 'river-tiger' | 'north-general' | 'hegemon';
export type LineageTitleId = 'unifier' | 'restorer' | 'three-dynasties' | 'three-realms' | 'scholarly';
export type RetiredLineageId = 'founder' | 'eternal' | 'marquis' | 'six-commanderies' | 'tradition';

type TitleState = Pick<GameState, 'homeLevel' | 'battleWins' | 'frontierWins' | 'fiefs' | 'pastDynasties' | 'realms' | 'chronicle' | 'earnedTitles'>;

/** 本朝称号条件（档位从低到高） */
export const CURRENT_TITLE_RULES: Record<CurrentTitleId, (s: TitleState) => boolean> = {
  commoner: () => true,
  gentry: (s) => s.homeLevel >= 3,
  'marquis-house': (s) => s.homeLevel >= 5,
  'river-tiger': (s) => s.battleWins >= 20,
  'north-general': (s) => s.frontierWins >= 3,
  hegemon: (s) => s.homeLevel >= 6 && s.battleWins >= 30
};

/** 家声条件：天下归心 = 六郡 + 王城（v3.1 起不看家业点） */
export const LINEAGE_TITLE_RULES: Record<LineageTitleId, (s: TitleState) => boolean> = {
  unifier: (s) => ownedFiefCount(s.fiefs ?? {}) >= 6 && s.homeLevel >= 6,
  restorer: (s) => (s.pastDynasties?.length ?? 0) >= 1,
  'three-dynasties': (s) => (s.pastDynasties?.length ?? 0) >= 2,
  'three-realms': (s) => Boolean(s.realms && s.realms.wei > 0 && s.realms.shu > 0 && s.realms.wu > 0),
  scholarly: (s) => Boolean(s.chronicle) && ambitionsAchieved(s) >= SCHOLARLY_AMBITION_COUNT
};

export const CURRENT_TITLE_IDS = Object.keys(CURRENT_TITLE_RULES) as CurrentTitleId[];
export const LINEAGE_TITLE_IDS = Object.keys(LINEAGE_TITLE_RULES) as LineageTitleId[];
/** 退役家声：读档保留（白名单），显示为旧誉，不再授予 */
export const RETIRED_LINEAGE_IDS: RetiredLineageId[] = ['founder', 'eternal', 'marquis', 'six-commanderies', 'tradition'];
export const RETIRED_LINEAGE_NAMES: Record<RetiredLineageId, string> = {
  founder: '开国元勋',
  eternal: '千秋家业',
  marquis: '裂土封侯',
  'six-commanderies': '六郡之主',
  tradition: '家风传世'
};

// ===== 效果数值 =====
/** 乡绅：政务收入 +3%（与劝农、国号蜀同一加法项，见 incomePercentOf） */
export const GENTRY_INCOME_PERCENT = 3;
/** 侯门显贵：攻郡押金 −5%（conquestStakeOf） */
export const MARQUIS_STAKE_PERCENT = 5;
/** 百战之将：斗地主缴获 +5%（与国号吴同一乘点，BattleScreen 的 nanyangBoost） */
export const RIVER_TIGER_DDZ_PERCENT = 5;
/** 金汤之将：修城费八折（wallRepairCostOf） */
export const NORTH_GENERAL_REPAIR_PERCENT = 20;
/** 一代枭雄：军令上限 +1（orderCapOf） */
export const HEGEMON_ORDER_BONUS = 1;
/** 再造山河：收复押金减半（RECLAIM_STAKE_RATE 0.25 → 0.125） */
export const RESTORER_RECLAIM_PERCENT = 50;
/** 三分归一：改方略费减半 */
export const THREE_REALMS_POLICY_PERCENT = 50;
/** 志向达成的家业点：1 点，家学渊源 2 点 */
export const AMBITION_LEGACY_POINTS = 1;
export const SCHOLARLY_AMBITION_POINTS = 2;

export interface TitleInfo {
  id: string;
  name: string;
  requirement: string;
  /** 效果（玩家可见，点匾旗弹层里写这一句） */
  effect: string;
  /** 主城上的呈现 */
  look: string;
}

export const TITLE_INFO: Record<CurrentTitleId | LineageTitleId, TitleInfo> = {
  commoner: { id: 'commoner', name: '白身', requirement: '', effect: '无', look: '不挂匾' },
  gentry: { id: 'gentry', name: '乡绅', requirement: '宅邸升至砖瓦宅', effect: `政务收入 +${GENTRY_INCOME_PERCENT}%`, look: '门楣木匾「耕读传家」' },
  'marquis-house': { id: 'marquis-house', name: '侯门显贵', requirement: '宅邸升至侯府', effect: `攻郡押金 −${MARQUIS_STAKE_PERCENT}%`, look: '朱漆金字匾「侯门」' },
  'river-tiger': { id: 'river-tiger', name: '百战之将', requirement: '累计 20 场胜利', effect: `斗地主缴获 +${RIVER_TIGER_DDZ_PERCENT}%`, look: '门前战旗' },
  'north-general': { id: 'north-general', name: '金汤之将', requirement: '守住 3 次邻郡反攻', effect: '修城费八折', look: '城头角楼' },
  hegemon: { id: 'hegemon', name: '一代枭雄', requirement: '宅邸王城且累计 30 场胜利', effect: `军令上限 +${HEGEMON_ORDER_BONUS}`, look: '黑底金字匾「王」与帅旗' },
  unifier: { id: 'unifier', name: '天下归心', requirement: '六郡尽归、宅邸王城', effect: '每朝开局军令满', look: '城头国号大纛' },
  restorer: { id: 'restorer', name: '再造山河', requirement: '开创第二朝', effect: '收复失地押金减半', look: '赤旗「再造」' },
  'three-dynasties': { id: 'three-dynasties', name: '三朝元老', requirement: '开创第三朝', effect: '每朝首次反攻城池必保', look: '三面小旗' },
  'three-realms': { id: 'three-realms', name: '三分归一', requirement: '魏、蜀、吴三个国号都立过', effect: '改方略费减半', look: '三色合一旗' },
  scholarly: { id: 'scholarly', name: '家学渊源', requirement: `志向累计达成 ${SCHOLARLY_AMBITION_COUNT} 次`, effect: `志向达成得 ${SCHOLARLY_AMBITION_POINTS} 点家业点`, look: '书卷旗' }
};

export function isCurrentTitleId(id: string): id is CurrentTitleId {
  return id in CURRENT_TITLE_RULES;
}

export function isLineageTitleId(id: string): id is LineageTitleId {
  return id in LINEAGE_TITLE_RULES;
}

/** 称号是否在手：本朝称号现算；家声看记录或当前满足 */
export function hasTitleId(state: TitleState, id: CurrentTitleId | LineageTitleId) {
  if (isCurrentTitleId(id)) return CURRENT_TITLE_RULES[id](state);
  // 部分字段的状态（规则脚本、econ 的局部 state）也能算，缺的按没有
  return Boolean(state.earnedTitles?.includes(id)) || LINEAGE_TITLE_RULES[id](state);
}

/** 旧誉：存档里留着的退役家声 */
export function retiredHonors(state: Pick<GameState, 'earnedTitles'>): RetiredLineageId[] {
  return RETIRED_LINEAGE_IDS.filter((id) => state.earnedTitles?.includes(id));
}

export interface TitleBonuses {
  /** 政务收入 +%（加法） */
  incomePct: number;
  /** 攻郡/收复押金 −% */
  stakePct: number;
  /** 斗地主胜利缴获 +% */
  ddzPct: number;
  /** 修城费 −% */
  repairPct: number;
  /** 军令上限 + */
  orderCap: number;
  /** 收复押金再 −% */
  reclaimPct: number;
  /** 改方略费 −% */
  policyPct: number;
  /** 志向达成得几点家业点 */
  ambitionPoints: number;
  /** 本朝第一次反攻城防不扣 */
  firstSiegeGuard: boolean;
  /** 每朝开局军令满 */
  dynastyFullOrders: boolean;
}

const NO_BONUS: TitleBonuses = { incomePct: 0, stakePct: 0, ddzPct: 0, repairPct: 0, orderCap: 0, reclaimPct: 0, policyPct: 0, ambitionPoints: AMBITION_LEGACY_POINTS, firstSiegeGuard: false, dynastyFullOrders: false };

/** 称号效果总表：所有接入点都从这里取（econ-sim TITLES=0 把开关关掉做对照） */
export function titleBonuses(state: TitleState): TitleBonuses {
  if (!TITLES_ENABLED) return NO_BONUS;
  const has = (id: CurrentTitleId | LineageTitleId) => hasTitleId(state, id);
  return {
    incomePct: has('gentry') ? GENTRY_INCOME_PERCENT : 0,
    stakePct: has('marquis-house') ? MARQUIS_STAKE_PERCENT : 0,
    ddzPct: has('river-tiger') ? RIVER_TIGER_DDZ_PERCENT : 0,
    repairPct: has('north-general') ? NORTH_GENERAL_REPAIR_PERCENT : 0,
    orderCap: has('hegemon') ? HEGEMON_ORDER_BONUS : 0,
    reclaimPct: has('restorer') ? RESTORER_RECLAIM_PERCENT : 0,
    policyPct: has('three-realms') ? THREE_REALMS_POLICY_PERCENT : 0,
    ambitionPoints: has('scholarly') ? SCHOLARLY_AMBITION_POINTS : AMBITION_LEGACY_POINTS,
    firstSiegeGuard: has('three-dynasties'),
    dynastyFullOrders: has('unifier')
  };
}

/** 匾额：可挂的本朝称号匾 + 旧誉纪念匾（纪念匾只有外观） */
export const PLAQUE_TEXT: Record<string, string> = {
  gentry: '耕读传家',
  'marquis-house': '侯门',
  hegemon: '王',
  founder: '开国元勋',
  eternal: '千秋家业',
  marquis: '裂土封侯',
  'six-commanderies': '六郡之主',
  tradition: '家风传世'
};
const PLAQUE_RANK = ['hegemon', 'marquis-house', 'gentry'] as const;

/** 能挂的匾：已得的本朝称号匾（高档在前）+ 旧誉纪念匾 */
export function availablePlaques(state: TitleState): string[] {
  return [...PLAQUE_RANK.filter((id) => hasTitleId(state, id)), ...retiredHonors(state)];
}

/** 挂哪一块：玩家固定的那块（还在手）优先，否则最高档的本朝称号匾；白身不挂 */
export function plaqueOf(state: TitleState & Pick<GameState, 'plaque'>): string | null {
  const options = availablePlaques(state);
  if (state.plaque && options.includes(state.plaque)) return state.plaque;
  return PLAQUE_RANK.find((id) => hasTitleId(state, id)) ?? null;
}
