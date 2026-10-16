import type { GameState, PaceCurve } from '../types';
import { homeUpgradeCost } from '../data/gameData';
import { CONQUEST_STAKE_RATE, FIEF_POLICY_CHANGE_RATE, fiefIncomePercent, orderCapFor, type Fief } from '../data/fiefs';
import { realmConquestDiscount, realmIncomePercent } from '../data/dynasty';
import { legacyPriceRateFor, TRADITION_FIEF_DISCOUNT, traditionOf } from '../data/traditions';
import { successionPlan } from './battle';
import { ambitionStatus } from '../data/ambitions';
import { titleBonuses } from '../data/titleEffects';
import { RECLAIM_STAKE_RATE, reclaimRemainingMs, siegeBounty, wallRepairCost } from './siege';

/**
 * 唯一的取价入口（v3.1）。所有读郡价的地方都走 fiefCostOf，reducer 校验 action.cost 也走它；
 * 漏一处（比如面板按旧价显示、reducer 按新价校验）玩家看到的就是「点了没反应」。
 * - 造价曲线 paceCurve：v2 旧价（老存档进行中的本朝），v3 郡价 ×2.2、王城 36 万（新档、新朝、重开）
 * - 家风、称号、国号的折扣都在这里乘
 */
// 10-16 由 ×2 调到 ×2.2：称号效果开着时 3 次/日六郡 17.5 天，低于 18~22 目标；×2.2 实测 18.9 天
export const PACE_V3_FIEF_SCALE = 2.2;

type PriceState = Pick<GameState, 'paceCurve' | 'chronicle' | 'realms' | 'earnedTitles' | 'homeLevel' | 'battleWins' | 'frontierWins' | 'fiefs' | 'pastDynasties'>;

export function paceOf(state: Pick<GameState, 'paceCurve'>): PaceCurve {
  return state.paceCurve === 'v3' ? 'v3' : 'v2';
}

/** 郡的开拓价（未计家风）：fief.cost 是 v2 旧价，v3 ×PACE_V3_FIEF_SCALE —— 全仓库只有这里读 fief.cost */
export function fiefBaseCost(fief: Fief, pace: PaceCurve) {
  return pace === 'v3' ? fief.cost * PACE_V3_FIEF_SCALE : fief.cost;
}

/** 开拓价：按造价曲线，开疆家风九折 */
export function fiefCostOf(state: Pick<GameState, 'paceCurve' | 'chronicle'>, fief: Fief) {
  const base = fiefBaseCost(fief, paceOf(state));
  return traditionOf(state.chronicle)?.id === 'expansion' ? Math.round(base * TRADITION_FIEF_DISCOUNT) : base;
}

/** 改方略：开拓价（未计家风）的一成，开疆家风九折，三分归一再减半 */
export function policyChangeCostOf(state: PriceState, fief: Fief) {
  let cost = Math.round(fiefBaseCost(fief, paceOf(state)) * FIEF_POLICY_CHANGE_RATE);
  if (traditionOf(state.chronicle)?.id === 'expansion') cost = Math.round(cost * TRADITION_FIEF_DISCOUNT);
  const cut = titleBonuses(state).policyPct;
  return cut > 0 ? Math.round(cost * (1 - cut / 100)) : cost;
}

/** 收复押金比例：失郡 72 小时内押开拓价 25%，再造山河再减半 */
export function reclaimStakeRateOf(state: PriceState) {
  return RECLAIM_STAKE_RATE * (1 - titleBonuses(state).reclaimPct / 100);
}

/** 攻郡押金：开拓价（含家风）× 50%（收复期内按收复比例）× 国号魏折扣 × 侯门显贵 −5% */
export function conquestStakeOf(state: PriceState & Partial<Pick<GameState, 'lostFiefs'>>, fief: Fief, now = Date.now()) {
  const reclaim = Boolean(state.lostFiefs) && reclaimRemainingMs({ lostFiefs: state.lostFiefs ?? {}, fiefs: state.fiefs }, fief.id, now) > 0;
  const rate = reclaim ? reclaimStakeRateOf(state) : CONQUEST_STAKE_RATE;
  return Math.round(fiefCostOf(state, fief) * rate * realmConquestDiscount(state.realms) * (1 - titleBonuses(state).stakePct / 100));
}

/** 押金在开拓价×比例之外还打的折（疆域图标题与押金说明写出来，免得玩家对不上数） */
export function stakeDiscountNotes(state: PriceState): string[] {
  const wei = realmConquestDiscount(state.realms);
  const stakePct = titleBonuses(state).stakePct;
  return [
    wei < 1 ? `国号魏 −${Math.round((1 - wei) * 1000) / 10}%` : '',
    stakePct > 0 ? `侯门显贵 −${stakePct}%` : ''
  ].filter(Boolean);
}

/** 修满城防：开拓价（按曲线，不计家风）的 5%，金汤之将八折 */
export function wallRepairCostOf(state: PriceState, fief: Fief) {
  const cost = wallRepairCost(fiefBaseCost(fief, paceOf(state)));
  const cut = titleBonuses(state).repairPct;
  return cut > 0 ? Math.round(cost * (1 - cut / 100)) : cost;
}

/** 守城犒赏：开拓价（按曲线，不计家风）的 1% */
export function siegeBountyOf(state: Pick<GameState, 'paceCurve'>, fief: Fief) {
  return siegeBounty(fiefBaseCost(fief, paceOf(state)));
}

/** 升到 level 级宅邸的价（只有王城分曲线） */
export function homeUpgradeCostOf(state: Pick<GameState, 'paceCurve'>, level: number) {
  return homeUpgradeCost(level, paceOf(state));
}

/** 军令上限：基础 + 整军郡 + 国号魏 + 一代枭雄 */
export function orderCapOf(state: PriceState) {
  return orderCapFor(state.fiefs, state.realms) + titleBonuses(state).orderCap;
}

/** 政务收入加成（加法）：劝农郡 + 国号蜀 + 乡绅 */
export function incomePercentOf(state: PriceState) {
  return fiefIncomePercent(state.fiefs) + realmIncomePercent(state.realms) + titleBonuses(state).incomePct;
}

/** 斗地主胜利缴获的称号乘数（百战之将 +5%），与国号吴同一乘点 */
export function titleDdzScale(state: PriceState) {
  return 1 + titleBonuses(state).ddzPct / 100;
}

/**
 * 传位预览：府库未收的金先并入，按递增价能折几点、花多少、余多少、下一点多少钱。
 * 传位面板、机会栏、确认框都用它，reducer 的 succeed 用同一组函数实扣，显示与实扣一致。
 */
export function legacyPreview(state: GameState) {
  const heirGold = state.gold + state.treasury.gold;
  const rate = legacyPriceRateFor(state);
  const ambitionPoints = titleBonuses(state).ambitionPoints;
  // 志向达成的点不走金价（金子只折到 20 − 志向点，志向点记在最上面）；与 reducer succeed 同一个 successionPlan
  const ambitionDone = Boolean(ambitionStatus(state)?.done);
  const plan = successionPlan(heirGold, state.legacyPoints, rate, ambitionDone ? ambitionPoints : 0);
  return {
    heirGold,
    rate,
    gained: plan.gained,
    spent: plan.spent,
    /** 传位后留给新主的金（含家业点已满时志向改发的金） */
    left: plan.left,
    after: plan.after,
    /** 再下一点的价格（已满为 null） */
    nextPrice: plan.nextPrice,
    /** 志向达成得几点（家学渊源 2 点） */
    ambitionPoints,
    ambitionDone,
    /** 本次传位志向实得的点与改发的金（未达成为 0） */
    rewardPoints: plan.rewardPoints,
    rewardGold: plan.rewardGold
  };
}
