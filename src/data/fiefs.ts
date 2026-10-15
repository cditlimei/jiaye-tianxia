import { ORDER_CAP } from '../types';
import { emptyRealms, realmOrderBonus, type RealmCounts } from './dynasty';
import type { AiSkill } from '../lib/doudizhu';

/**
 * 封地经略：宅邸升至侯府后，在疆域图上攻取与本府或已有封地相邻的郡。
 * 攻郡先押上军资（开拓价的一半），和该郡守将打一局斗地主，胜则郡归府下、输则军资没入敌手。
 * 每郡出兵前定一条方略（收入、军令上限或三项属性），拿下后还给所有牌局一项特权。封地是家业田产，传位随之传下。
 */
export type FiefPolicyId = 'farming' | 'military' | 'schooling';

export interface Fief {
  id: string;
  name: string;
  cost: number;
  description: string;
  /** 疆域图坐标（viewBox 0~100 × 0~72） */
  x: number;
  y: number;
  /** 相邻的郡（'home' = 本府） */
  neighbors: string[];
  /** 守将：攻郡牌局里坐在对面的人 */
  garrison: string;
  /** 守将牌艺 */
  skill: AiSkill;
  /** 守将立绘（复用 assets/enemies 的敌将图） */
  portrait: string;
  /** 拿下后所有牌局生效的特权 */
  perk: { name: string; detail: string };
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
  { id: 'nanyang', name: '南阳郡', cost: 150000, description: '帝乡沃土，户口殷实，天下第一大郡。', x: 50, y: 34, neighbors: ['home', 'yingchuan', 'runan'], garrison: '张绣', skill: 'novice', portrait: 'enemy-general', perk: { name: '帝乡沃土', detail: '牌局胜利缴获 +20%' } },
  { id: 'runan', name: '汝南郡', cost: 250000, description: '袁氏故里，士族林立，门生遍天下。', x: 68, y: 40, neighbors: ['nanyang'], garrison: '袁术', skill: 'veteran', portrait: 'chaos-warlord', perk: { name: '门生故吏', detail: '牌局失手只付一半' } },
  { id: 'yingchuan', name: '颍川郡', cost: 400000, description: '谋士之乡，荀氏、郭氏皆出于此。', x: 60, y: 22, neighbors: ['nanyang', 'liaodong'], garrison: '荀彧', skill: 'veteran', portrait: 'nine-ministers', perk: { name: '谋士献策', detail: '开局探得下家三张牌' } },
  { id: 'changsha', name: '长沙郡', cost: 700000, description: '湘水之滨，粮米丰足，兵源充沛。', x: 52, y: 62, neighbors: ['home', 'bajun'], garrison: '韩玄', skill: 'novice', portrait: 'prefect', perk: { name: '兵源充沛', detail: '当农民赢了也拿全份' } },
  { id: 'bajun', name: '巴郡', cost: 1100000, description: '巴山蜀水，关隘险固，盐铁之利。', x: 24, y: 50, neighbors: ['changsha'], garrison: '严颜', skill: 'master', portrait: 'enemy-vanguard', perk: { name: '盐铁之利', detail: '赢牌倍数至少 ×2' } },
  { id: 'liaodong', name: '辽东郡', cost: 1600000, description: '极北之地，胡汉杂居，良马成群。', x: 86, y: 8, neighbors: ['yingchuan'], garrison: '公孙度', skill: 'master', portrait: 'regent', perk: { name: '良马斥候', detail: '叫地主前先看到一张底牌' } }
];

/** 本府（荆州）在疆域图上的位置，与南阳、长沙相邻 */
export const HOME_NODE = { id: 'home', name: '荆州', x: 40, y: 46, neighbors: ['nanyang', 'changsha'] };

/** 攻郡押上的军资占开拓价的比例：胜则得郡，输则军资没入敌手 */
export const CONQUEST_STAKE_RATE = 0.5;

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

/** 可攻的郡：还没拿到、且与本府或已有封地相邻 */
export function attackableFiefs(holdings: FiefHoldings) {
  return fiefs.filter((fief) => !holdings[fief.id] && fief.neighbors.some((id) => id === 'home' || Boolean(holdings[id])));
}

/** 「下一郡」：可攻的郡里最便宜的那个（给首页提示、志向提示用） */
export function nextFief(holdings: FiefHoldings) {
  return [...attackableFiefs(holdings)].sort((a, b) => a.cost - b.cost)[0] ?? null;
}

/** 只保留与本府连成一片的封地（旧存档按顺序持有，天然连通） */
export function connectedHoldings(holdings: FiefHoldings): FiefHoldings {
  const out: FiefHoldings = {};
  let grew = true;
  while (grew) {
    grew = false;
    for (const fief of fiefs) {
      if (out[fief.id] || !holdings[fief.id]) continue;
      if (fief.neighbors.some((id) => id === 'home' || Boolean(out[id]))) {
        out[fief.id] = holdings[fief.id];
        grew = true;
      }
    }
  }
  return out;
}

/** 已拿下的郡（牌局特权按郡 id 生效） */
export function ownedFiefIds(holdings: FiefHoldings) {
  return fiefs.filter((fief) => holdings[fief.id]).map((fief) => fief.id);
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

export function orderCapFor(holdings: FiefHoldings, realms: RealmCounts = emptyRealms) {
  return ORDER_CAP + countPolicy(holdings, 'military') * FIEF_ORDER_BONUS + realmOrderBonus(realms);
}

export function policyChangeCost(fief: Fief) {
  return Math.round(fief.cost * FIEF_POLICY_CHANGE_RATE);
}
