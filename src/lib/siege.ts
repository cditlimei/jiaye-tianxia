import type { GameEvent, GameState } from '../types';
import type { AiSkill } from './doudizhu';
import { connectedHoldings, FIEF_UNLOCK_HOME_LEVEL, fiefs as fiefCatalog, findFief, type Fief, type FiefHoldings, type FiefPolicyId } from '../data/fiefs';
import { isEndingReached } from '../data/dynasty';
import { formatRemaining, RAID_WINDOW_MS } from './frontier';
import { titleBonuses } from '../data/titleEffects';

/**
 * 邻郡反攻守城（v2.2，替代北疆边患）：
 * 已占的末端郡隔一段真实时间会被原守将反攻，24 小时内上牌桌守城。
 * 守住：城防回满、发犒赏；失手：城防 −1，降到 1 告急（该郡牌桌特权暂停），降到 0 失郡；逾期最低扣到 1，离线永远不丢郡。
 * 失郡 72 小时内可押四分之一军资收复。只打末端郡，所以丢一郡不会连带丢别的郡。
 */

const HOUR = 60 * 60 * 1000;

/** 总开关：极端情况关掉，告警条和地图标记一并隐藏，存档字段保留 */
export const SIEGE_ENABLED = true;
/** 首次得郡（或老存档迁移）到第一次反攻 */
export const SIEGE_FIRST_DELAY_MS = 48 * HOUR;
/** 上一次反攻结束（守住、失手或逾期）到下一次 */
export const SIEGE_INTERVAL_MS = 48 * HOUR;
/** 应战窗口，沿用北疆的 24 小时 */
export const SIEGE_WINDOW_MS = RAID_WINDOW_MS;
/** 没有可反攻的郡（都在保护期）时隔多久再看 */
export const SIEGE_RETRY_MS = 6 * HOUR;
/** 新得、收复的郡的保护期 */
export const FIEF_PROTECT_MS = 72 * HOUR;
/** 每郡城防点数 */
export const FIEF_WALLS = 2;
/** 守城犒赏：开拓价的 1%（econ：48h 一次时占总收入约 3%，设计稿目标；3% 时达 8.5%） */
export const SIEGE_BOUNTY_RATE = 0.01;
/** 修满城防：开拓价的 5% */
export const WALL_REPAIR_RATE = 0.05;
/** 失郡 72 小时内收复押开拓价的 25%（过期按原来的 50%） */
export const RECLAIM_STAKE_RATE = 0.25;
export const RECLAIM_WINDOW_MS = 72 * HOUR;
/**
 * 守城「城主坐庄」：跳过叫地主，玩家直接当地主。
 * 上线门槛：role-sim 地主视角对两个生手 2 万局胜率 67.2%（≥55%），所以开着（对两个老手为 42.0%）。
 */
export const DEFENSE_FORCE_LANDLORD = true;

/** 测试开关：jiaye-siege-now=1 下一次检查立即起反攻（跳过间隔和保护期）；jiaye-siege-target=<郡 id> 指定反攻哪郡 */
export const SIEGE_NOW_KEY = 'jiaye-siege-now';
export const SIEGE_TARGET_KEY = 'jiaye-siege-target';

export interface Siege {
  fiefId: string;
  /** 来犯将（该郡原守将） */
  attacker: string;
  /** 来犯将牌艺（已降档） */
  skill: AiSkill;
  startedAt: number;
  dueAt: number;
}

type SiegeFields = Pick<GameState, 'siege' | 'nextSiegeAt' | 'fiefWalls' | 'fiefTakenAt' | 'lostFiefs' | 'peakFiefs'>;
type SiegeState = SiegeFields & Pick<GameState, 'fiefs' | 'homeLevel' | 'legacyPoints' | 'activeBattle' | 'day' | 'firstSiegeDone' | 'battleWins' | 'frontierWins' | 'pastDynasties' | 'realms' | 'chronicle' | 'earnedTitles'>;

export interface SiegeStep {
  siege: Siege | null;
  nextSiegeAt: number;
  fiefWalls: Record<string, number>;
  event: GameEvent | null;
  /** 本朝第一次反攻是否已结（三朝元老「首次反攻城池必保」） */
  firstSiegeDone: boolean;
}

/** 三朝元老：本朝第一次反攻城防不扣（守住、失手、逾期都算这一次） */
export function firstSiegeGuarded(state: Pick<SiegeState, 'firstSiegeDone'> & Parameters<typeof titleBonuses>[0]) {
  return !state.firstSiegeDone && titleBonuses(state).firstSiegeGuard;
}

const SKILL_DOWN: Record<AiSkill, AiSkill> = { master: 'veteran', veteran: 'novice', novice: 'novice' };

/** 来犯将牌艺：原守将降一档，整军方略的郡再降一档 */
export function siegeSkill(fief: Fief, policy: FiefPolicyId | undefined): AiSkill {
  const once = SKILL_DOWN[fief.skill];
  return policy === 'military' ? SKILL_DOWN[once] : once;
}

const ownedCount = (holdings: FiefHoldings) => fiefCatalog.filter((fief) => holdings[fief.id]).length;

/** 末端郡：拿掉它，其余的郡仍与本府连成一片（丢它不会连带丢别的郡） */
export function exposedFiefs(holdings: FiefHoldings): Fief[] {
  const total = ownedCount(holdings);
  return fiefCatalog.filter((fief) => {
    if (!holdings[fief.id]) return false;
    const rest = { ...holdings };
    delete rest[fief.id];
    return ownedCount(connectedHoldings(rest)) === total - 1;
  });
}

export const wallsOf = (state: Pick<GameState, 'fiefWalls'>, fiefId: string) => state.fiefWalls[fiefId] ?? FIEF_WALLS;

/** 城防不满：该郡牌桌特权暂停（劝农、整军、教化照常） */
export const isWallAlert = (state: Pick<GameState, 'fiefWalls' | 'fiefs'>, fiefId: string) => Boolean(state.fiefs[fiefId]) && wallsOf(state, fiefId) < FIEF_WALLS;

/** 牌桌特权生效的郡：已占且城防满 */
export function activePerkIds(state: Pick<GameState, 'fiefWalls' | 'fiefs'>) {
  return fiefCatalog.filter((fief) => state.fiefs[fief.id] && wallsOf(state, fief.id) >= FIEF_WALLS).map((fief) => fief.id);
}

/** 传入开拓价（按造价曲线，由 lib/prices.ts 的 siegeBountyOf / wallRepairCostOf 取，不直接读 fief.cost） */
export const siegeBounty = (cost: number) => Math.round(cost * SIEGE_BOUNTY_RATE);
export const wallRepairCost = (cost: number) => Math.round(cost * WALL_REPAIR_RATE);

/** 失郡后还在半价收复期内（返回剩余毫秒，过期或没丢过为 0） */
export function reclaimRemainingMs(state: Pick<GameState, 'lostFiefs' | 'fiefs'>, fiefId: string, now = Date.now()) {
  const lostAt = state.lostFiefs[fiefId];
  if (state.fiefs[fiefId] || typeof lostAt !== 'number') return 0;
  return Math.max(0, lostAt + RECLAIM_WINDOW_MS - now);
}

export const shortName = (fief: Fief) => fief.name.replace(/郡$/, '');

/** 挑反攻目标：末端郡里去掉保护期内的，按城防低、得郡晚排前 */
export function pickSiegeTarget(state: Pick<GameState, 'fiefs' | 'fiefWalls' | 'fiefTakenAt'>, now: number, opts: { ignoreProtect?: boolean; target?: string | null } = {}): Fief | null {
  const exposed = exposedFiefs(state.fiefs);
  if (opts.target) {
    const forced = exposed.find((fief) => fief.id === opts.target);
    if (forced) return forced;
  }
  const takenAt = (id: string) => state.fiefTakenAt[id] ?? 0;
  const candidates = exposed.filter((fief) => opts.ignoreProtect || now - takenAt(fief.id) >= FIEF_PROTECT_MS);
  return [...candidates].sort((a, b) => wallsOf(state, a.id) - wallsOf(state, b.id) || takenAt(b.id) - takenAt(a.id))[0] ?? null;
}

/** 反攻逾期（没应战）：城防 −1，最低扣到 1，然后排下一次。守城局正在打时不判逾期，等它打完。 */
export function expireSiege(state: SiegeState, now = Date.now()): SiegeStep {
  const { siege } = state;
  const keep: SiegeStep = { siege: state.siege, nextSiegeAt: state.nextSiegeAt, fiefWalls: state.fiefWalls, event: null, firstSiegeDone: state.firstSiegeDone };
  if (!siege || now <= siege.dueAt || state.activeBattle?.conquest?.kind === 'defend') return keep;
  const fief = findFief(siege.fiefId);
  const guarded = firstSiegeGuarded(state);
  const walls = guarded ? wallsOf(state, siege.fiefId) : Math.max(1, wallsOf(state, siege.fiefId) - 1);
  return {
    siege: null,
    nextSiegeAt: now + SIEGE_INTERVAL_MS,
    fiefWalls: state.fiefs[siege.fiefId] ? { ...state.fiefWalls, [siege.fiefId]: walls } : state.fiefWalls,
    firstSiegeDone: true,
    event: fief
      ? guarded
        ? { id: `siege-expire-${fief.id}-${now}`, day: state.day, title: `${fief.name}城池必保`, detail: `${siege.attacker}围城一日无人应战。三朝元老坐镇，本朝首次反攻城防不扣，仍为 ${walls}。` }
        : { id: `siege-expire-${fief.id}-${now}`, day: state.day, title: `${fief.name}城防受损`, detail: `${siege.attacker}围城一日无人应战，城防降为 ${walls}（逾期最低留 1，不会因此失郡）。${walls < FIEF_WALLS ? '郡中牌桌特权暂停。' : ''}` }
      : null
  };
}

/** 能不能起新反攻（不看时间） */
export function siegeAllowed(state: SiegeState) {
  return SIEGE_ENABLED && state.homeLevel >= FIEF_UNLOCK_HOME_LEVEL && ownedCount(state.fiefs) > 0 && !isEndingReached(state as GameState) && !state.siege && !state.activeBattle;
}

/** 在线检查一次（页面可见时才调）：先判逾期，再看是否起新反攻 */
export function advanceSiege(state: SiegeState, now = Date.now(), opts: { force?: boolean; target?: string | null } = {}): SiegeStep {
  const expired = expireSiege(state, now);
  if (expired.event || expired.siege !== state.siege) return expired;
  const keep: SiegeStep = { siege: state.siege, nextSiegeAt: state.nextSiegeAt, fiefWalls: state.fiefWalls, event: null, firstSiegeDone: state.firstSiegeDone };
  if (!siegeAllowed(state)) return keep;
  // 有郡却没计时（不该出现，normalize 会补）：从现在起算首次
  if (!state.nextSiegeAt && !opts.force) return { ...keep, nextSiegeAt: now + SIEGE_FIRST_DELAY_MS };
  if (!opts.force && now < state.nextSiegeAt) return keep;
  const fief = pickSiegeTarget(state, now, { ignoreProtect: opts.force, target: opts.target });
  if (!fief) return { ...keep, nextSiegeAt: now + SIEGE_RETRY_MS };
  const siege: Siege = { fiefId: fief.id, attacker: fief.garrison, skill: siegeSkill(fief, state.fiefs[fief.id]), startedAt: now, dueAt: now + SIEGE_WINDOW_MS };
  return {
    siege,
    nextSiegeAt: state.nextSiegeAt,
    fiefWalls: state.fiefWalls,
    firstSiegeDone: state.firstSiegeDone,
    event: { id: `siege-start-${fief.id}-${now}`, day: state.day, title: `${shortName(fief)}告急`, detail: `${fief.garrison}卷土重来，兵临${fief.name}城下。${formatRemaining(SIEGE_WINDOW_MS)}内应战守城：城主坐庄、不耗军令、失手不扣金。` }
  };
}

/**
 * 反攻相关字段的一致性：城防只记在手的郡（1..2），得郡时刻缺了补现在（老存档先有 72 小时保护），
 * 失郡记录只留不在手的，反攻目标不在手就作废，有郡没计时补 48 小时，最高郡数只增不减。
 * 读档和每次状态更新后都跑一遍；没有变化时原样返回。
 */
export function reconcileSiege<T extends SiegeFields & Pick<GameState, 'fiefs'>>(state: T, now = Date.now()): T {
  const owned = fiefCatalog.filter((fief) => state.fiefs[fief.id]).map((fief) => fief.id);
  const fiefWalls: Record<string, number> = {};
  const fiefTakenAt: Record<string, number> = {};
  for (const id of owned) {
    const walls = state.fiefWalls?.[id];
    fiefWalls[id] = typeof walls === 'number' && Number.isFinite(walls) ? Math.max(1, Math.min(FIEF_WALLS, Math.floor(walls))) : FIEF_WALLS;
    const taken = state.fiefTakenAt?.[id];
    fiefTakenAt[id] = typeof taken === 'number' && Number.isFinite(taken) && taken <= now ? taken : now;
  }
  const lostFiefs: Record<string, number> = {};
  for (const [id, at] of Object.entries(state.lostFiefs ?? {})) {
    if (!state.fiefs[id] && fiefCatalog.some((fief) => fief.id === id) && typeof at === 'number' && Number.isFinite(at)) lostFiefs[id] = at;
  }
  const siege = state.siege && state.fiefs[state.siege.fiefId] ? state.siege : null;
  const nextSiegeAt = owned.length === 0 ? 0 : state.nextSiegeAt > 0 ? state.nextSiegeAt : now + SIEGE_FIRST_DELAY_MS;
  const peakFiefs = Math.max(state.peakFiefs || 0, owned.length);
  const same = (a: Record<string, number> | undefined, b: Record<string, number>) => JSON.stringify(a ?? {}) === JSON.stringify(b);
  if (same(state.fiefWalls, fiefWalls) && same(state.fiefTakenAt, fiefTakenAt) && same(state.lostFiefs, lostFiefs) && siege === state.siege && nextSiegeAt === state.nextSiegeAt && peakFiefs === state.peakFiefs) {
    return state;
  }
  return { ...state, fiefWalls, fiefTakenAt, lostFiefs, siege, nextSiegeAt, peakFiefs };
}

/** 读存档里的反攻字段：结构不对就作废 */
export function sanitizeSiege(value: unknown): Siege | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Record<string, unknown>;
  const fief = typeof s.fiefId === 'string' ? findFief(s.fiefId) : null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const startedAt = num(s.startedAt);
  const dueAt = num(s.dueAt);
  if (!fief || startedAt === null || dueAt === null || dueAt < startedAt) return null;
  const skill: AiSkill = s.skill === 'novice' || s.skill === 'veteran' || s.skill === 'master' ? s.skill : siegeSkill(fief, undefined);
  return { fiefId: fief.id, attacker: typeof s.attacker === 'string' && s.attacker ? s.attacker.slice(0, 12) : fief.garrison, skill, startedAt, dueAt };
}

export function sanitizeTimeMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(value as Record<string, unknown>)) {
    if (fiefCatalog.some((fief) => fief.id === id) && typeof v === 'number' && Number.isFinite(v)) out[id] = v;
  }
  return out;
}

/** 测试开关读取（存储被禁用时视为没开） */
export function siegeTestFlags(): { force: boolean; target: string | null } {
  try {
    if (typeof window === 'undefined') return { force: false, target: null };
    return { force: window.localStorage.getItem(SIEGE_NOW_KEY) === '1', target: window.localStorage.getItem(SIEGE_TARGET_KEY) };
  } catch {
    return { force: false, target: null };
  }
}

/**
 * 进行中的反攻作罢：天下归心（保护结局判定），或被围郡已不是末端郡（反攻期间又攻下它背后的郡，丢它会连带丢后方）。
 * 守城局正在打时不动，由 resolveDefense 兜底（只扣到 1）。每次状态更新与读档后都跑一遍；没有变化时原样返回。
 */
export function releaseStaleSiege(state: GameState, now = Date.now()): GameState {
  const { siege } = state;
  if (!siege || !state.fiefs[siege.fiefId] || state.activeBattle?.conquest?.kind === 'defend') return state;
  const ending = isEndingReached(state);
  if (!ending && exposedFiefs(state.fiefs).some((fief) => fief.id === siege.fiefId)) return state;
  const fief = findFief(siege.fiefId);
  const event: GameEvent | null = fief
    ? {
        id: `siege-relieved-${fief.id}-${now}`,
        day: state.day,
        title: `${shortName(fief)}围解`,
        detail: ending
          ? `天下归心，${siege.attacker}解围而去，诸郡从此不再遭反攻。`
          : `${fief.name}已成腹地，${siege.attacker}孤军难支，解围退去。城防不变，${formatRemaining(SIEGE_INTERVAL_MS)}后再留意反攻。`
      }
    : null;
  return {
    ...state,
    siege: null,
    nextSiegeAt: now + SIEGE_INTERVAL_MS,
    eventLog: event ? [event, ...state.eventLog].slice(0, 18) : state.eventLog
  };
}

/** 被围郡这一局失手能不能真的失郡：仍是末端郡、未天下归心；否则城防最低留 1 */
export function canLoseFief(state: GameState, fiefId: string) {
  return !isEndingReached(state) && exposedFiefs(state.fiefs).some((fief) => fief.id === fiefId);
}
