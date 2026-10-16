import type { RealmId } from './dynasty';

/**
 * v3.2 新朝换势力：一朝从一个势力起家，本府落在该势力的老巢，郡池 = 七个节点去掉本府。
 * - seat：本府节点（不进郡池，不能攻、不会被反攻），本府节点的牌桌特权就是势力自带特权（群没有）
 * - ladder：六郡的造价顺序（离本府 BFS 距离优先，同距离按原价排；荆州按原价 55 万排），价格按「势力 × 郡」固定，不按第几郡现算
 * - curveScale：造价曲线相对群的倍数（v3 下再乘 PACE_V3_FIEF_SCALE，见 lib/prices.ts）
 * - realm：势力包 = 该国号单朝效果 ×1（群无）；跨朝的国号效果冻结在 ancestralRealms 里，不再按朝叠加
 * 汉（南阳起家，三分归一后解锁）推迟到 v3.3：加一行 FACTIONS 与 FOUNDABLE_FACTIONS 即可，ladder / unlock 字段已留好。
 */
export type FactionId = 'qun' | 'wei' | 'shu' | 'wu';
export type BequestId = 'treasury' | 'veterans' | 'homeland' | 'keeper';

/** 节点 id：荆州 + 原六郡；'home' 是荆州的老别名（老存档、neighbors 里还在用） */
export const JINGZHOU = 'jingzhou';
export const HOME_ALIAS = 'home';
export const nodeIdOf = (id: string) => (id === HOME_ALIAS ? JINGZHOU : id);

export interface Faction {
  id: FactionId;
  name: string;
  /** 本府节点 */
  seat: string;
  /** 都城名（许都、成都、建业；群就是荆州） */
  capital: string;
  ladder: string[];
  curveScale: number;
  /** v3 王城价 */
  royalCost: number;
  realm: RealmId | null;
  /** 自带牌桌特权（本府节点的特权 id），群为 null */
  ownPerk: string | null;
  color: string;
  softColor: string;
  motto: string;
  /** 开新朝时能不能选（汉留给 v3.3 读 three-realms） */
  unlocked: (state: { realms?: Record<RealmId, number> }) => boolean;
}

/** 群（新档首朝、老档默认）的旧价六档（v2，万：15/25/40/70/110/160），v3 再 ×PACE_V3_FIEF_SCALE */
export const LADDER_BASE_COSTS = [150000, 250000, 400000, 700000, 1100000, 1600000];
export const FIEF_POOL_SIZE = 6;

export const FACTIONS: Record<FactionId, Faction> = {
  qun: {
    id: 'qun', name: '群', seat: JINGZHOU, capital: '荆州',
    ladder: ['nanyang', 'runan', 'yingchuan', 'changsha', 'bajun', 'liaodong'],
    curveScale: 1, royalCost: 360000, realm: null, ownPerk: null,
    color: '#C9783D', softColor: 'rgba(201, 120, 61, 0.18)', motto: '群雄并起，荆州立业',
    unlocked: () => false
  },
  wei: {
    id: 'wei', name: '魏', seat: 'yingchuan', capital: '许都',
    ladder: ['nanyang', 'runan', JINGZHOU, 'liaodong', 'changsha', 'bajun'],
    curveScale: 1.2, royalCost: 360000, realm: 'wei', ownPerk: 'yingchuan',
    color: '#6EA7D8', softColor: 'rgba(110, 167, 216, 0.16)', motto: '挟天子以令诸侯',
    unlocked: () => true
  },
  shu: {
    id: 'shu', name: '蜀', seat: 'bajun', capital: '成都',
    ladder: ['changsha', JINGZHOU, 'nanyang', 'runan', 'yingchuan', 'liaodong'],
    // 设计稿初值同群（×1）；econ 补上郡特权系数后，蜀开局自带「盐铁之利」（笨玩家实测斗地主净期望 ×1.43~1.64）快出一截，
    // 10-16 单独抬到 ×1.2（与魏同档）：无特权口径 3 次/天六郡 21.3 天，计特权口径 11.5 天（群 14.3）
    curveScale: 1.2, royalCost: 360000, realm: 'shu', ownPerk: 'bajun',
    color: '#4DBB7D', softColor: 'rgba(77, 187, 125, 0.16)', motto: '兴复汉室，还于旧都',
    unlocked: () => true
  },
  wu: {
    id: 'wu', name: '吴', seat: 'runan', capital: '建业',
    ladder: ['nanyang', JINGZHOU, 'yingchuan', 'changsha', 'liaodong', 'bajun'],
    curveScale: 1.15, royalCost: 400000, realm: 'wu', ownPerk: 'runan',
    color: '#CC5549', softColor: 'rgba(204, 85, 73, 0.18)', motto: '据长江之险，保江东之地',
    unlocked: () => true
  }
};

export const FACTION_IDS = Object.keys(FACTIONS) as FactionId[];
/** 开新朝可选的国号（= 下一朝的开局势力）；汉 v3.3 再加 */
export const FOUNDABLE_FACTIONS: FactionId[] = ['wei', 'shu', 'wu'];

export function isFactionId(value: unknown): value is FactionId {
  return typeof value === 'string' && value in FACTIONS;
}

export function factionOf(state: { faction?: FactionId | null }): Faction {
  return FACTIONS[state.faction && isFactionId(state.faction) ? state.faction : 'qun'];
}

/** 本府节点（老档、缺字段按荆州） */
export function seatOf(state: { faction?: FactionId | null }) {
  return factionOf(state).seat;
}

// ===== 遗泽（v3.2）：统一时选，只在下一朝生效 =====
export interface Bequest {
  id: BequestId;
  name: string;
  effect: string;
}
/** 府库：开国金额外加「本朝家业点 × 1 万」，上限 +20 万 */
export const BEQUEST_TREASURY_PER_POINT = 10000;
export const BEQUEST_TREASURY_CAP = 200000;
/** 旧部：本朝军令上限 +1，开局军令满 */
export const BEQUEST_VETERANS_ORDERS = 1;
/** 故地：本朝第一郡开拓价减半 */
export const BEQUEST_HOMELAND_RATE = 0.5;
export const BEQUEST_MAX = 3;

export const BEQUESTS: Bequest[] = [
  { id: 'treasury', name: '府库', effect: `开国金另加本朝家业点 × ${BEQUEST_TREASURY_PER_POINT.toLocaleString()} 金（最多 ${(BEQUEST_TREASURY_CAP / 10000).toLocaleString()} 万）` },
  { id: 'veterans', name: '旧部', effect: `下一朝军令上限 +${BEQUEST_VETERANS_ORDERS}，开局军令满` },
  { id: 'homeland', name: '故地', effect: '下一朝第一郡开拓价减半' },
  { id: 'keeper', name: '留贤', effect: '留下一位伴侣，好感与了却的心事都在' }
];

export function isBequestId(value: unknown): value is BequestId {
  return value === 'treasury' || value === 'veterans' || value === 'homeland' || value === 'keeper';
}

export function findBequest(id: string) {
  return BEQUESTS.find((item) => item.id === id) ?? null;
}

/** 府库遗泽能加多少开国金 */
export function treasuryBequestGold(legacyPoints: number) {
  return Math.min(BEQUEST_TREASURY_CAP, Math.max(0, legacyPoints) * BEQUEST_TREASURY_PER_POINT);
}

/** 主公旧部：同阵营主公三项属性各 +3（群是群雄，没有成建制的旧部，不加） */
export const LOYAL_LORD_BONUS = 3;
export function loyalBonusFor(lordCamp: string | null | undefined, faction: FactionId | null | undefined) {
  return lordCamp && faction && faction !== 'qun' && lordCamp === faction ? LOYAL_LORD_BONUS : 0;
}
