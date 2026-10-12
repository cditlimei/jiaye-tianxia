import { ORDER_CAP } from '../types';

/**
 * 封地经略：宅邸升至侯府后，可按顺序开拓六郡。每郡开拓时选一条方略，
 * 方略决定这郡给家业什么——收入、军令上限或三项属性。封地是家业田产，传位随之传下。
 */
export type FiefPolicyId = 'farming' | 'military' | 'schooling';

export interface Fief {
  id: string;
  name: string;
  cost: number;
  description: string;
}

export interface FiefPolicy {
  id: FiefPolicyId;
  name: string;
  effect: string;
  detail: string;
}

export const FIEF_UNLOCK_HOME_LEVEL = 5;
export const FIEF_INCOME_PERCENT = 8;
export const FIEF_ORDER_BONUS = 1;
export const FIEF_STAT_BONUS = 4;
/** 改弦更张：换方略按开拓价的一成收费 */
export const FIEF_POLICY_CHANGE_RATE = 0.1;

export const fiefs: Fief[] = [
  { id: 'nanyang', name: '南阳郡', cost: 150000, description: '帝乡沃土，户口殷实，天下第一大郡。' },
  { id: 'runan', name: '汝南郡', cost: 300000, description: '袁氏故里，士族林立，门生遍天下。' },
  { id: 'yingchuan', name: '颍川郡', cost: 600000, description: '谋士之乡，荀氏、郭氏皆出于此。' },
  { id: 'changsha', name: '长沙郡', cost: 1200000, description: '湘水之滨，粮米丰足，兵源充沛。' },
  { id: 'bajun', name: '巴郡', cost: 2000000, description: '巴山蜀水，关隘险固，盐铁之利。' },
  { id: 'liaodong', name: '辽东郡', cost: 3200000, description: '极北之地，胡汉杂居，良马成群。' }
];

export const fiefPolicies: FiefPolicy[] = [
  { id: 'farming', name: '劝农', effect: `政务收入 +${FIEF_INCOME_PERCENT}%`, detail: '轻徭薄赋，开垦荒地，郡中粮税归入府库。' },
  { id: 'military', name: '整军', effect: `军令上限 +${FIEF_ORDER_BONUS}`, detail: '郡兵归府调遣，能同时发出更多军令。' },
  { id: 'schooling', name: '教化', effect: `武力、智谋、声望各 +${FIEF_STAT_BONUS}`, detail: '兴学授徒、礼聘贤才，主公威望随之而涨。' }
];

export type FiefHoldings = Record<string, FiefPolicyId>;

export function findFief(id: string) {
  return fiefs.find((fief) => fief.id === id) ?? null;
}

export function findFiefPolicy(id: string) {
  return fiefPolicies.find((policy) => policy.id === id) ?? null;
}

export function isFiefPolicyId(value: unknown): value is FiefPolicyId {
  return value === 'farming' || value === 'military' || value === 'schooling';
}

/** 六郡按顺序开拓，下一郡是第一个还没拿到的 */
export function nextFief(holdings: FiefHoldings) {
  return fiefs.find((fief) => !holdings[fief.id]) ?? null;
}

export function ownedFiefCount(holdings: FiefHoldings) {
  return fiefs.filter((fief) => holdings[fief.id]).length;
}

export function countPolicy(holdings: FiefHoldings, policy: FiefPolicyId) {
  return fiefs.filter((fief) => holdings[fief.id] === policy).length;
}

export function fiefIncomePercent(holdings: FiefHoldings) {
  return countPolicy(holdings, 'farming') * FIEF_INCOME_PERCENT;
}

export function fiefStatBonus(holdings: FiefHoldings) {
  return countPolicy(holdings, 'schooling') * FIEF_STAT_BONUS;
}

export function orderCapFor(holdings: FiefHoldings) {
  return ORDER_CAP + countPolicy(holdings, 'military') * FIEF_ORDER_BONUS;
}

export function policyChangeCost(fief: Fief) {
  return Math.round(fief.cost * FIEF_POLICY_CHANGE_RATE);
}
