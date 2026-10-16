import type { GameState, PaceCurve } from '../types';
import { homeUpgradeCost } from '../data/gameData';
import { CONQUEST_STAKE_RATE, FIEF_POLICY_CHANGE_RATE, fiefIncomePercent, fiefStatBonus, ladderIndex, orderCapFor, ownedFiefCount, type Fief } from '../data/fiefs';
import { effectiveRealms, realmConquestDiscount, realmIncomePercent, realmStatBonus } from '../data/dynasty';
import { activeTradition, legacyPriceRateFor, TRADITION_FIEF_DISCOUNT } from '../data/traditions';
import { successionPlan } from './battle';
import { titleBonuses } from '../data/titleEffects';
import { RECLAIM_STAKE_RATE, reclaimRemainingMs, siegeBounty, wallRepairCost } from './siege';
import { BEQUEST_HOMELAND_RATE, BEQUEST_VETERANS_ORDERS, factionOf, LADDER_BASE_COSTS, loyalBonusFor } from '../data/factions';
import { findLord } from '../data/gameData';

/**
 * 唯一的取价入口（v3.1 起）。所有读郡价的地方都走 fiefCostOf，reducer 校验 action.cost 也走它；
 * 漏一处（比如面板按旧价显示、reducer 按新价校验）玩家看到的就是「点了没反应」。
 * - v3.2：郡价按「势力 × 郡」固定 = 势力 ladder 上的档位价（群 ×1、魏 ×1.2、蜀 ×1、吴 ×1.15），不按本朝第几郡现算（丢郡再收复不会更便宜）
 * - 造价曲线 paceCurve：v2 旧价（老存档进行中的本朝，只会是群），v3 再 ×PACE_V3_FIEF_SCALE、王城按势力（群魏蜀 36 万、吴 40 万）
 * - 家风（老档冻结）、遗泽故地、称号、国号的折扣都在这里乘
 */
// 10-16 由 ×2 调到 ×2.2：称号效果开着时 3 次/日六郡 17.5 天，低于 18~22 目标；×2.2 实测 18.9 天
export const PACE_V3_FIEF_SCALE = 2.2;

type FactionFields = Partial<Pick<GameState, 'faction' | 'ancestralRealms' | 'realm' | 'bequests' | 'legacyTradition' | 'peakFiefs' | 'selectedLordId'>>;
type PriceState = Pick<GameState, 'paceCurve' | 'chronicle' | 'realms' | 'earnedTitles' | 'homeLevel' | 'battleWins' | 'frontierWins' | 'fiefs' | 'pastDynasties'> & FactionFields;

export function paceOf(state: Pick<GameState, 'paceCurve'>): PaceCurve {
  return state.paceCurve === 'v3' ? 'v3' : 'v2';
}

/** 势力造价曲线（第 1→6 档）：群的旧价六档 × 势力倍数（v3 再 ×PACE_V3_FIEF_SCALE） */
export function factionCurve(state: Pick<GameState, 'paceCurve'> & FactionFields) {
  const faction = factionOf(state);
  const scale = faction.curveScale * (paceOf(state) === 'v3' ? PACE_V3_FIEF_SCALE : 1);
  return LADDER_BASE_COSTS.map((cost) => Math.round(cost * scale));
}

/** 郡的标价（未计家风与遗泽）：势力 ladder 上的档位价 —— 修城费、守城犒赏、改方略都按它 */
export function fiefListPrice(state: Pick<GameState, 'paceCurve'> & FactionFields, fief: Fief) {
  const faction = factionOf(state);
  const index = ladderIndex(faction.id, fief.id);
  // 本府节点不在 ladder 里（不能攻）：兜底按原价，不会被用到
  if (index >= LADDER_BASE_COSTS.length) return fiefBaseCost(fief, paceOf(state));
  return factionCurve(state)[index];
}

/** 旧口径：郡自己的 v2 旧价（v3 ×PACE_V3_FIEF_SCALE）；只剩兜底与 econ 对照用 */
export function fiefBaseCost(fief: Fief, pace: PaceCurve) {
  return pace === 'v3' ? fief.cost * PACE_V3_FIEF_SCALE : fief.cost;
}

/** 遗泽「故地」还生效：本朝还没拿下过任何一郡 */
export function homelandActive(state: FactionFields & Pick<GameState, 'fiefs'>) {
  return Boolean(state.bequests?.includes('homeland')) && (state.peakFiefs ?? 0) === 0 && ownedFiefCount(state.fiefs) === 0;
}

/** 开拓价：势力 × 郡的标价，开疆家风（老档冻结）九折，遗泽故地第一郡减半 */
export function fiefCostOf(state: Pick<GameState, 'paceCurve' | 'fiefs'> & FactionFields, fief: Fief) {
  let cost = fiefListPrice(state, fief);
  if (activeTradition(state)?.id === 'expansion') cost = Math.round(cost * TRADITION_FIEF_DISCOUNT);
  if (homelandActive(state)) cost = Math.round(cost * BEQUEST_HOMELAND_RATE);
  return cost;
}

/** 改方略：标价的一成，开疆家风九折，三分归一再减半 */
export function policyChangeCostOf(state: PriceState, fief: Fief) {
  let cost = Math.round(fiefListPrice(state, fief) * FIEF_POLICY_CHANGE_RATE);
  if (activeTradition(state)?.id === 'expansion') cost = Math.round(cost * TRADITION_FIEF_DISCOUNT);
  const cut = titleBonuses(state).policyPct;
  return cut > 0 ? Math.round(cost * (1 - cut / 100)) : cost;
}

/** 收复押金比例：失郡 72 小时内押开拓价 25%，再造山河再减半 */
export function reclaimStakeRateOf(state: PriceState) {
  return RECLAIM_STAKE_RATE * (1 - titleBonuses(state).reclaimPct / 100);
}

/** 攻郡押金：开拓价（含家风、故地）× 50%（收复期内按收复比例）× 国号魏折扣 × 侯门显贵 −5% */
export function conquestStakeOf(state: PriceState & Partial<Pick<GameState, 'lostFiefs'>>, fief: Fief, now = Date.now()) {
  const reclaim = Boolean(state.lostFiefs) && reclaimRemainingMs({ lostFiefs: state.lostFiefs ?? {}, fiefs: state.fiefs }, fief.id, now) > 0;
  const rate = reclaim ? reclaimStakeRateOf(state) : CONQUEST_STAKE_RATE;
  return Math.round(fiefCostOf(state, fief) * rate * realmConquestDiscount(effectiveRealms(state)) * (1 - titleBonuses(state).stakePct / 100));
}

/** 押金在开拓价×比例之外还打的折（疆域图标题与押金说明写出来，免得玩家对不上数） */
export function stakeDiscountNotes(state: PriceState): string[] {
  const wei = realmConquestDiscount(effectiveRealms(state));
  const stakePct = titleBonuses(state).stakePct;
  return [
    homelandActive(state) ? '故地首郡半价' : '',
    wei < 1 ? `国号魏 −${Math.round((1 - wei) * 1000) / 10}%` : '',
    stakePct > 0 ? `侯门显贵 −${stakePct}%` : ''
  ].filter(Boolean);
}

/** 修满城防：标价的 5%，金汤之将八折 */
export function wallRepairCostOf(state: PriceState, fief: Fief) {
  const cost = wallRepairCost(fiefListPrice(state, fief));
  const cut = titleBonuses(state).repairPct;
  return cut > 0 ? Math.round(cost * (1 - cut / 100)) : cost;
}

/** 守城犒赏：标价的 1% */
export function siegeBountyOf(state: Pick<GameState, 'paceCurve'> & FactionFields, fief: Fief) {
  return siegeBounty(fiefListPrice(state, fief));
}

/** 升到 level 级宅邸的价（只有王城分曲线；v3 王城按势力：吴 40 万，其余 36 万） */
export function homeUpgradeCostOf(state: Pick<GameState, 'paceCurve'> & FactionFields, level: number) {
  if (level === 6 && paceOf(state) === 'v3') return factionOf(state).royalCost;
  return homeUpgradeCost(level, paceOf(state));
}

/** 军令上限：基础 + 整军郡 + 国号魏（冻结遗泽 + 本朝） + 一代枭雄 + 遗泽旧部 */
export function orderCapOf(state: PriceState) {
  return orderCapFor(state.fiefs, effectiveRealms(state)) + titleBonuses(state).orderCap + (state.bequests?.includes('veterans') ? BEQUEST_VETERANS_ORDERS : 0);
}

/** 政务收入加成（加法）：劝农郡 + 国号蜀 + 乡绅 */
export function incomePercentOf(state: PriceState) {
  return fiefIncomePercent(state.fiefs) + realmIncomePercent(effectiveRealms(state)) + titleBonuses(state).incomePct;
}

/** 三项属性的额外加成：教化郡 + 国号吴 + 主公旧部（同阵营 +3，群不加）；政务练出的属性另算 */
export function statBonusOf(state: Pick<GameState, 'fiefs' | 'realms'> & FactionFields) {
  return fiefStatBonus(state.fiefs) + realmStatBonus(effectiveRealms(state)) + loyalBonusFor(findLord(state.selectedLordId ?? null)?.camp, state.faction);
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
  // v3.2 志向下线（改势力宏愿，奖励是下一朝遗泽），传位不再结算志向点；与 reducer succeed 同一个 successionPlan
  const plan = successionPlan(heirGold, state.legacyPoints, rate, 0);
  return {
    heirGold,
    rate,
    gained: plan.gained,
    spent: plan.spent,
    /** 传位后留给新主的金（含家业点已满时志向改发的金） */
    left: plan.left,
    after: plan.after,
    /** 再下一点的价格（已满为 null） */
    nextPrice: plan.nextPrice
  };
}
