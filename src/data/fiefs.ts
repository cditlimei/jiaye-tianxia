import { ORDER_CAP } from '../types';
import { emptyRealms, realmOrderBonus, type RealmCounts } from './dynasty';
import type { AiSkill } from '../lib/doudizhu';
import { FACTIONS, JINGZHOU, nodeIdOf, type FactionId } from './factions';

/**
 * 封地经略：宅邸升至侯府后，在疆域图上攻取与本府或已有封地相邻的郡。
 * 攻郡先押上军资（开拓价的一半），和该郡守将打一局斗地主，胜则郡归府下、失手则军资没入敌手。
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
  /** 相邻的节点（'home' = 荆州的老别名，见 factions.nodeIdOf） */
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

/**
 * 疆域图七个节点（v3.2 起荆州也是普通节点）：本府所在的节点不进郡池，六郡 = 七个节点去掉本府。
 * cost 是 v2 旧价（只给群的 v2 曲线、排序参考用），实际开拓价按「势力 × 郡」的 ladder 取（lib/prices.ts fiefCostOf）。
 */
export const fiefs: Fief[] = [
  { id: JINGZHOU, name: '荆州', cost: 550000, description: '荆襄九郡，沃野千里，刘表坐镇襄阳。', x: 40, y: 46, neighbors: ['nanyang', 'changsha'], garrison: '刘表', skill: 'novice', portrait: 'three-dukes', perk: { name: '荆襄九郡', detail: '牌局胜利缴获 +10%' } },
  { id: 'nanyang', name: '南阳郡', cost: 150000, description: '帝乡沃土，户口殷实，天下第一大郡。', x: 50, y: 34, neighbors: ['home', 'yingchuan', 'runan'], garrison: '张绣', skill: 'novice', portrait: 'enemy-general', perk: { name: '帝乡沃土', detail: '牌局胜利缴获 +20%' } },
  { id: 'runan', name: '汝南郡', cost: 250000, description: '袁氏故里，士族林立，门生遍天下。', x: 68, y: 40, neighbors: ['nanyang'], garrison: '袁术', skill: 'veteran', portrait: 'chaos-warlord', perk: { name: '门生故吏', detail: '牌局失手只付一半' } },
  { id: 'yingchuan', name: '颍川郡', cost: 400000, description: '谋士之乡，荀氏、郭氏皆出于此。', x: 60, y: 22, neighbors: ['nanyang', 'liaodong'], garrison: '荀彧', skill: 'veteran', portrait: 'nine-ministers', perk: { name: '谋士献策', detail: '开局探得下家三张牌' } },
  { id: 'changsha', name: '长沙郡', cost: 700000, description: '湘水之滨，粮米丰足，兵源充沛。', x: 52, y: 62, neighbors: ['home', 'bajun'], garrison: '韩玄', skill: 'novice', portrait: 'prefect', perk: { name: '兵源充沛', detail: '当农民赢了也拿全份' } },
  { id: 'bajun', name: '巴郡', cost: 1100000, description: '巴山蜀水，关隘险固，盐铁之利。', x: 24, y: 50, neighbors: ['changsha'], garrison: '严颜', skill: 'master', portrait: 'enemy-vanguard', perk: { name: '盐铁之利', detail: '赢牌倍数至少 ×2' } },
  { id: 'liaodong', name: '辽东郡', cost: 1600000, description: '极北之地，胡汉杂居，良马成群。', x: 86, y: 8, neighbors: ['yingchuan'], garrison: '公孙度', skill: 'master', portrait: 'regent', perk: { name: '良马斥候', detail: '叫地主前先看到一张底牌' } }
];

/** 攻郡押上的军资占开拓价的比例：胜则得郡，失手则军资没入敌手 */
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

/** 节点短名：去掉「郡」字，两个字的（巴郡）原样保留，免得只剩一个「巴」 */
export function nodeShortName(fief: Pick<Fief, 'name'>) {
  return fief.name.length <= 2 ? fief.name : fief.name.replace(/郡$/, '');
}

/** 相邻节点（'home' 解析为荆州） */
export function neighborIds(fief: Pick<Fief, 'neighbors'>) {
  return fief.neighbors.map(nodeIdOf);
}

/** 疆域：本府 + 已有封地 */
const inTerritory = (holdings: FiefHoldings, seat: string, id: string) => id === seat || Boolean(holdings[id]);

/** 郡池：七个节点去掉本府 */
export function fiefPool(seat: string) {
  return fiefs.filter((fief) => fief.id !== seat);
}

/** 可攻的郡：郡池里还没拿到、且与本府或已有封地相邻（seat：本府节点，按势力） */
export function attackableFiefs(holdings: FiefHoldings, seat: string) {
  return fiefPool(seat).filter((fief) => !holdings[fief.id] && neighborIds(fief).some((id) => inTerritory(holdings, seat, id)));
}

/** 造价顺序：势力的 ladder（群就是原来的目录顺序） */
export function ladderIndex(faction: FactionId, fiefId: string) {
  const index = FACTIONS[faction].ladder.indexOf(fiefId);
  return index < 0 ? FACTIONS[faction].ladder.length : index;
}

/** 「下一郡」：可攻的郡里造价档位最低的那个（给首页提示、宏愿提示、econ 用） */
export function nextFief(holdings: FiefHoldings, faction: FactionId) {
  return [...attackableFiefs(holdings, FACTIONS[faction].seat)].sort((a, b) => ladderIndex(faction, a.id) - ladderIndex(faction, b.id))[0] ?? null;
}

/** 只保留与本府连成一片的封地（本府节点不算封地，剔掉）；旧存档按顺序持有，天然连通 */
export function connectedHoldings(holdings: FiefHoldings, seat: string): FiefHoldings {
  const out: FiefHoldings = {};
  let grew = true;
  while (grew) {
    grew = false;
    for (const fief of fiefPool(seat)) {
      if (out[fief.id] || !holdings[fief.id]) continue;
      if (neighborIds(fief).some((id) => inTerritory(out, seat, id))) {
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
