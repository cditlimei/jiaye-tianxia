import type { GameEvent, GameState } from '../types';
import { ownedFiefCount } from './fiefs';
import { genDefends, genWins } from './dynasty';
import { AMBITION_FULL_GOLD } from '../lib/battle';
import { FACTIONS, JINGZHOU, type FactionId } from './factions';

/**
 * v3.2 势力宏愿：开朝即定（按本朝势力）、不能跳过；达成后下一朝遗泽多选 1 项（家学渊源 2 项），累计 3 次得「家学渊源」。
 * v3.1 的三选一志向（富国 / 强兵 / 开疆）下线：定义只留给老存档迁移（进行中的志向当场结算）与家谱显示用。
 */
export type AmbitionId = 'wealth' | 'might' | 'expansion';

export interface Ambition {
  id: AmbitionId;
  name: string;
  motto: string;
}

/** 旧志向（只用于家谱显示、老档迁移） */
export const ambitions: Ambition[] = [
  { id: 'wealth', name: '富国', motto: '仓廪实而知礼节' },
  { id: 'might', name: '强兵', motto: '兵者，国之大事' },
  { id: 'expansion', name: '开疆', motto: '普天之下，莫非王土' }
];

/** v3.1 前的志向奖励（下一代开局多得的金），只剩老存档「传位后待择主」旧流程用 */
export const AMBITION_REWARD_GOLD = 10000;
export const AMBITION_TITLE_COUNT = 3;
export { AMBITION_FULL_GOLD };
/** 六郡已满时旧开疆改为「本代守住 N 次邻郡反攻」 */
export const EXPANSION_DEFEND_TARGET = 2;

export const CHRONICLE_MAX = 40;

/** 家谱超长时留开国第一代 + 最近的几代 */
export function trimChronicle<T>(entries: T[]) {
  if (entries.length <= CHRONICLE_MAX) return entries;
  return [entries[0], ...entries.slice(-(CHRONICLE_MAX - 1))];
}

export function findAmbition(id: string) {
  return ambitions.find((item) => item.id === id) ?? null;
}

export function isAmbitionId(value: unknown): value is AmbitionId {
  return value === 'wealth' || value === 'might' || value === 'expansion';
}

/** 家谱里达成志向的次数 */
export function ambitionsAchieved(state: Pick<GameState, 'chronicle'>) {
  return state.chronicle.filter((entry) => entry.ambitionDone).length;
}

export const ownedFiefCountOf = ownedFiefCount;

/** 旧志向的目标按世代线性递增（封顶第 20 代），与 v3.1 同一算法 */
const gen = (generation: number) => Math.min(20, Math.max(2, generation));

/**
 * 老存档迁移：进行中的旧志向达成了没有（v3.1 的判定原样搬来）。
 * raw 是存档里的 ambition 字段；不认识或第一代返回 null（没有进行中的志向）。
 */
export function legacyAmbitionResult(state: GameState, raw: unknown): { id: AmbitionId; done: boolean } | null {
  if (!raw || typeof raw !== 'object' || state.generation < 2) return null;
  const a = raw as { id?: unknown; baseFiefs?: unknown };
  if (!isAmbitionId(a.id)) return null;
  const owned = ownedFiefCount(state.fiefs);
  const baseFiefs = typeof a.baseFiefs === 'number' && Number.isFinite(a.baseFiefs) ? Math.max(0, Math.min(6, Math.floor(a.baseFiefs))) : owned;
  if (a.id === 'wealth') return { id: a.id, done: state.gold + (state.treasury?.gold ?? 0) >= 500000 + (gen(state.generation) - 2) * 250000 };
  if (a.id === 'might') return { id: a.id, done: genWins(state) >= 30 + (gen(state.generation) - 2) * 10 };
  if (baseFiefs >= 6) return { id: a.id, done: genDefends(state) >= EXPANSION_DEFEND_TARGET };
  return { id: a.id, done: Math.max(state.peakFiefs ?? 0, owned) - baseFiefs >= 1 };
}

// ===== 势力宏愿 =====
const HOUR = 60 * 60 * 1000;
/** 吴：荆州、颍川两城城防都满要连续守多久 */
export const WU_VOW_HOLD_MS = 48 * HOUR;
/** 蜀：要守住几次反攻 */
export const SHU_VOW_DEFENDS = 2;
/** 魏：辽东要在本朝前几郡里拿下 */
export const WEI_VOW_BY = 3;
/** 城防满格（与 lib/siege FIEF_WALLS 相同；这里不 import siege，免得循环引用） */
const WALLS_FULL = 2;

type VowState = Pick<GameState, 'fiefs' | 'fiefWalls' | 'peakFiefs' | 'frontierWins' | 'vow'> & { siege?: GameState['siege'] };

export interface Vow {
  id: FactionId;
  name: string;
  text: string;
}

export const VOWS: Record<FactionId, Vow> = {
  qun: { id: 'qun', name: '首郡入府', text: '拿下本朝第一郡' },
  wei: { id: 'wei', name: '北收辽东', text: `本朝前 ${WEI_VOW_BY} 郡里拿下辽东` },
  shu: { id: 'shu', name: '北出南阳', text: `拿下南阳，并守住 ${SHU_VOW_DEFENDS} 次邻郡反攻` },
  wu: { id: 'wu', name: '固守荆颍', text: '荆州、颍川都在手，两城城防连续 48 小时不缺' }
};

export function findVow(id: string | null | undefined) {
  return id && id in VOWS ? VOWS[id as FactionId] : null;
}

const wallsFull = (state: VowState, id: string) => Boolean(state.fiefs[id]) && (state.fiefWalls?.[id] ?? WALLS_FULL) >= WALLS_FULL;
const wuHolding = (state: VowState) => wallsFull(state, JINGZHOU) && wallsFull(state, 'yingchuan');

/** 宏愿进度（未达成时写到哪一步了；missed = 这一朝已经错过，不可能再达成） */
export function vowStatus(state: VowState, now = Date.now()) {
  if (!state.vow) return null;
  const vow = findVow(state.vow.id);
  if (!vow) return null;
  if (state.vow.done) return { vow, done: true, missed: false, progress: '已达成' };
  const owned = ownedFiefCount(state.fiefs);
  switch (vow.id) {
    case 'qun':
      return { vow, done: false, missed: false, progress: `已有 ${owned} 郡` };
    case 'wei': {
      const missed = Math.max(state.peakFiefs ?? 0, owned) >= WEI_VOW_BY && !state.fiefs.liaodong;
      return { vow, done: false, missed, progress: missed ? `前 ${WEI_VOW_BY} 郡已定，辽东不在其中，此愿已错过` : `已有 ${Math.max(state.peakFiefs ?? 0, owned)} 郡，辽东未得` };
    }
    case 'shu':
      return { vow, done: false, missed: false, progress: `南阳${state.fiefs.nanyang ? '已得' : '未得'} · 守住反攻 ${Math.min(SHU_VOW_DEFENDS, state.frontierWins)}/${SHU_VOW_DEFENDS} 次` };
    case 'wu': {
      const since = state.vow.since;
      const held = wuHolding(state) && typeof since === 'number' ? Math.max(0, Math.floor((now - since) / HOUR)) : 0;
      return { vow, done: false, missed: false, progress: wuHolding(state) ? `两城城防都满，已守 ${Math.min(48, held)}/48 小时` : `荆州${state.fiefs[JINGZHOU] ? '在手' : '未得'}、颍川${state.fiefs.yingchuan ? '在手' : '未得'}${(state.fiefs[JINGZHOU] && state.fiefs.yingchuan) ? '，城防告急时重新起算' : ''}` };
    }
    default:
      return null;
  }
}

/** 宏愿此刻是否达成（不含已记下的 done） */
function vowMet(state: VowState, now: number) {
  switch (state.vow?.id) {
    case 'qun':
      return ownedFiefCount(state.fiefs) >= 1;
    case 'wei':
      return Boolean(state.fiefs.liaodong) && (state.peakFiefs ?? 0) <= WEI_VOW_BY && ownedFiefCount(state.fiefs) <= WEI_VOW_BY;
    case 'shu':
      return Boolean(state.fiefs.nanyang) && state.frontierWins >= SHU_VOW_DEFENDS;
    case 'wu': {
      if (!(wuHolding(state) && typeof state.vow.since === 'number' && now - state.vow.since >= WU_VOW_HOLD_MS)) return false;
      // 荆州或颍川有一场已逾期、还没结算的反攻，且逾期落在 48 小时之内：城防该在那一刻受损，先等反攻结算（离线读档、页面在后台时都会这样）
      const siege = state.siege;
      const overdue = siege && (siege.fiefId === JINGZHOU || siege.fiefId === 'yingchuan') && now > siege.dueAt && siege.dueAt < state.vow.since + WU_VOW_HOLD_MS;
      return !overdue;
    }
    default:
      return false;
  }
}

/**
 * 宏愿推进：每次状态更新与读档后跑一遍（与 reconcileSiege 同处），达成即记下（只增不减）、累计次数 +1、写一条纪事。
 * 吴的 48 小时从「两城都在手且城防满」那一刻起算，任一城不满就清掉重算。没有变化时原样返回。
 */
export function reconcileVow<T extends VowState & Pick<GameState, 'vowsDone' | 'eventLog' | 'day'>>(state: T, now = Date.now()): T {
  const vow = state.vow;
  if (!vow || vow.done || !findVow(vow.id)) return state;
  let next: T = state;
  if (vow.id === 'wu') {
    const since = wuHolding(state) ? (typeof vow.since === 'number' && vow.since <= now ? vow.since : now) : undefined;
    if (since !== vow.since) next = { ...state, vow: since === undefined ? { id: vow.id, done: false } : { id: vow.id, done: false, since } };
  }
  if (!vowMet(next, now)) return next;
  const def = VOWS[vow.id];
  const event: GameEvent = { id: `vow-${vow.id}-${now}`, day: state.day, title: `宏愿达成 · ${def.name}`, detail: `${def.text}，宏愿已成。下一朝开国时遗泽多选一项（家学渊源两项）。` };
  return { ...next, vow: { id: vow.id, done: true }, vowsDone: (state.vowsDone ?? 0) + 1, eventLog: [event, ...state.eventLog].slice(0, 18) };
}

/** 开朝即定：按势力取宏愿 */
export function vowFor(faction: FactionId): NonNullable<GameState['vow']> {
  return { id: FACTIONS[faction].id, done: false };
}
