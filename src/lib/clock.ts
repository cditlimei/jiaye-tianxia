import type { GameEvent, GameState } from '../types';
import { isOrderDay, ORDER_FAST_HOME_LEVEL } from '../types';
import { findFarmLevel, findHomeLevel, lords, partners } from '../data/gameData';
import { calculateIntelligence, totalDailyIncome } from './battle';
import { fiefStatBonus } from '../data/fiefs';
import { realmStatBonus } from '../data/dynasty';
import { incomePercentOf, orderCapOf } from './prices';
import { choiceGoldValue, getChoiceEvent, getDailyEvent, resolvePendingEvent } from '../data/progression';
import { isPartnerEventDay, mergePartnerBoost, nextPartnerForEvent } from '../data/partnerEvents';
import { minorEventFor, minorGoldValue } from '../data/minorEvents';
import { AFFAIR_TRAINING_CAP, type AffairKind } from '../data/affairs';

/**
 * v2.3 真实时间：每满 DAY_MS 推进一日（1 小时 = 1 日，与旧版离线「每满 1 小时折 1 天」一致），
 * 推进的日子把政务收入与府中现钱积进府库，玩家「收取府库」才入账；军令按真实分钟回复。
 * stepDay 是唯一的按日结算入口：在线 tick、读档补算、测试开关下的「处理政务」都只调它。
 */
export const DAY_MS = 3_600_000;
/** 府库全额积存上限（日），按宅邸档次：茅草屋/木屋/砖瓦宅 12，府邸/侯府 20，王城 24 */
export const TREASURY_CAP_DAYS: Record<number, number> = { 1: 12, 2: 12, 3: 12, 4: 20, 5: 20, 6: 24 };
/** 超过上限后按半数继续积存，总共不超过 48 日 */
export const TREASURY_OVERFLOW_RATE = 0.5;
export const TREASURY_HARD_CAP_DAYS = 48;
/** 单次推进上限（防死循环）；超出的部分直接丢弃，clockAt 置为当下 */
export const MAX_CATCHUP_DAYS = 240;
/** 真实时间口径下政务收入的校准系数（econ rt 模式定；收入下滑只调它，不改 DAY_MS） */
export const REALTIME_INCOME_FACTOR = 1.0;
/** 军令：府邸以前 20 分钟一道，府邸起 120 分钟一道（= 旧版「每 2 日」） */
export const ORDER_MS_EARLY = 20 * 60 * 1000;
export const ORDER_MS_LATE = 120 * 60 * 1000;
/** 一次收取积存满 4 日才能练属性 */
export const TRAIN_MIN_DAYS = 4;
export const CLOCK_VERSION = 1;
/** 一次补算满 6 日（离开 6 小时以上）只写一条汇总纪事 */
export const BIG_GAP_DAYS = 6;
/** 在线 tick 间隔（与邻郡反攻共用） */
export const CLOCK_TICK_MS = 30000;
const MAX_EVENT_LOG = 18;
const REAL_DAY_MS = 24 * 3600 * 1000;

// ===== 测试开关（localStorage）：jiaye-day-ms 覆盖日长、jiaye-order-ms 覆盖军令间隔、jiaye-clock-manual=1 退回「点政务推进一日」 =====
function readFlag(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 一日多少毫秒（测试可用 jiaye-day-ms 覆盖，最少 100 毫秒） */
export function dayMs(): number {
  const value = Number(readFlag('jiaye-day-ms'));
  return Number.isFinite(value) && value >= 100 ? Math.floor(value) : DAY_MS;
}

/** 军令多久回一道：jiaye-order-ms 写「早,晚」两个数，或只写一个数（府邸起的间隔，府邸前按 1/6） */
export function orderMsFor(homeLevel: number): number {
  const raw = readFlag('jiaye-order-ms');
  if (raw) {
    const [a, b] = raw.split(',').map((item) => Number(item));
    const late = b !== undefined && Number.isFinite(b) && b >= 100 ? b : Number.isFinite(a) && a >= 100 ? a : 0;
    const early = b !== undefined && Number.isFinite(a) && a >= 100 ? a : Math.max(100, Math.round(late / 6));
    if (late >= 100) return homeLevel < ORDER_FAST_HOME_LEVEL ? early : late;
  }
  return homeLevel < ORDER_FAST_HOME_LEVEL ? ORDER_MS_EARLY : ORDER_MS_LATE;
}

/** 测试开关：主按钮恢复「处理政务」（推进 1 日并当场收取），读档补算后自动入账，不起在线 tick，军令按日回复 */
export function clockManual(): boolean {
  return readFlag('jiaye-clock-manual') === '1';
}

export function treasuryCapDays(homeLevel: number) {
  return TREASURY_CAP_DAYS[homeLevel] ?? 12;
}

/** 府库已积 storedDays 日时，再进一日的入库比例：上限内 1，超上限 0.5，满 48 日 0 */
export function treasuryStoreRate(storedDays: number, cap: number) {
  return storedDays < cap ? 1 : storedDays < TREASURY_HARD_CAP_DAYS ? TREASURY_OVERFLOW_RATE : 0;
}

/** 府库状态：未满 / 已满（再放半数）/ 已积满 48 日（不再积存） */
export function treasuryStage(days: number, homeLevel: number): 'open' | 'half' | 'hard' {
  return days >= TREASURY_HARD_CAP_DAYS ? 'hard' : days >= treasuryCapDays(homeLevel) ? 'half' : 'open';
}

/** 每日政务收入（不含减税招商与校准系数），与首页显示同一算法 */
export function dailyIncomeOf(state: GameState): number {
  const lord = lords.find((item) => item.id === state.selectedLordId);
  const owned = partners.filter((item) => state.ownedPartnerIds.includes(item.id)).map((item) => mergePartnerBoost(item, state.partnerBoosts[item.id]));
  const civilExtra = fiefStatBonus(state.fiefs) + realmStatBonus(state.realms) + state.affairTraining.civil;
  return totalDailyIncome(
    findHomeLevel(state.homeLevel).dailyIncome,
    findFarmLevel(state.farmLevel).incomePercent,
    state.legacyPoints,
    lord ? calculateIntelligence(lord, owned, civilExtra) : 0,
    findFarmLevel(state.farmLevel).flatIncome,
    incomePercentOf(state)
  );
}

/** 第 day 日的政务收入（含减税招商与校准系数） */
export function dayIncomeOf(state: GameState, day: number, base = dailyIncomeOf(state)) {
  const buff = state.incomeBuff && day <= state.incomeBuff.untilDay ? state.incomeBuff.percent : 0;
  return Math.round(base * (1 + buff / 100) * REALTIME_INCOME_FACTOR);
}

/** 二选一 / 小事按「拿现钱」折算的金额；心事没有现钱 */
function cashValue(choice: NonNullable<GameState['pendingChoice']>) {
  if (choice.eventId.startsWith('partner:')) return 0;
  if (choice.eventId.startsWith('minor:')) return minorGoldValue(choice.dailyIncome);
  const event = getChoiceEvent(choice.day, choice.dailyIncome);
  return event ? choiceGoldValue(event, choice.dailyIncome) : 0;
}

const isHeart = (choice: GameState['pendingChoice']) => Boolean(choice?.eventId.startsWith('partner:'));

export interface StepTally {
  days: number;
  income: number;
  /** 乡望与折现的府中事件 */
  eventGold: number;
  eventCount: number;
}

export const emptyTally = (): StepTally => ({ days: 0, income: 0, eventGold: 0, eventCount: 0 });

export interface StepOptions {
  /** 逐日写纪事（一次补算满 6 日时关掉，改写一条汇总） */
  log?: boolean;
  /** 测试开关下军令按日回复（府邸前每日、之后逢双日） */
  dayOrders?: boolean;
}

/**
 * 推进一日：减税招商到期 → 乡望 → 日历二选一 / 心事 / 小事 → 政务收入进府库。
 * 待决事件只有一个位置，规则在线离线一致：
 * - 心事优先、永不自动结算：已有待决心事时，新的心事日跳过（resolvedPartnerEvents 没变，下一轮还会来），新的二选一/小事按现钱进府库；
 * - 其次保留最近一桩二选一或小事，被顶掉的旧事按现钱进府库。
 */
export function stepDay(state: GameState, options: StepOptions = {}, tally?: StepTally): GameState {
  const day = state.day + 1;
  const base = dailyIncomeOf(state);
  const buffOn = Boolean(state.incomeBuff && day <= state.incomeBuff.untilDay);
  const buffExpired = Boolean(state.incomeBuff) && !buffOn;
  const income = dayIncomeOf(state, day, base);
  const { gold: storedGold, days: storedDays } = state.treasury;
  const cap = treasuryCapDays(state.homeLevel);
  // 府库整体封顶：政务收入与府中现钱同一口径——上限内全额、超上限半数、满 48 日一文不进
  const storeRate = treasuryStoreRate(storedDays, cap);
  const incomeGain = Math.round(income * storeRate);
  const dailyEvent = getDailyEvent(day, base);

  const pending = state.pendingChoice;
  const calendar = getChoiceEvent(day, base);
  const partnerKey = !calendar && isPartnerEventDay(day) && !isHeart(pending) ? nextPartnerForEvent(state.ownedPartnerIds, state.resolvedPartnerEvents) : null;
  const minor = !calendar && !partnerKey ? minorEventFor(day, state.ownedPartnerIds) : null;
  const arrived = calendar ? calendar.id : partnerKey ? `partner:${partnerKey}` : minor ? minor.key : null;
  const fresh = arrived ? { eventId: arrived, day, dailyIncome: base } : null;
  let pendingChoice = pending;
  let settledFresh: typeof fresh = null;
  let stale: typeof pending = null;
  if (fresh) {
    if (isHeart(pending) && !isHeart(fresh)) {
      settledFresh = fresh;
    } else {
      stale = pending;
      pendingChoice = fresh;
    }
  }
  const autoGold = (settledFresh ? cashValue(settledFresh) : 0) + (stale ? cashValue(stale) : 0);
  const stored = (gold: number) => Math.round(gold * storeRate);
  const eventGold = stored(dailyEvent?.goldDelta ?? 0) + stored(autoGold);
  const capNote = storeRate >= 1 ? '' : storeRate > 0 ? '（府库已满，只入半数）' : '（府库已积满 48 日，未能入库）';

  if (tally) {
    tally.days += 1;
    tally.income += incomeGain;
    tally.eventGold += eventGold;
    // 只数真进了府库的（满 48 日后事件现钱一文不进，不再算「折现入库」）
    tally.eventCount += storeRate > 0 ? (dailyEvent ? 1 : 0) + (settledFresh ? 1 : 0) + (stale ? 1 : 0) : 0;
  }

  const log: GameEvent[] = [];
  if (options.log) {
    const titleOf = (choice: NonNullable<GameState['pendingChoice']>) => resolvePendingEvent(choice)?.title ?? '府中来报';
    if (pendingChoice && pendingChoice === fresh) {
      const event = resolvePendingEvent(fresh);
      if (event) log.push({ id: `choice-${day}`, day, title: event.title, detail: `${event.prompt} 请在主城决断。` });
    }
    if (buffExpired) log.push({ id: `buff-end-${day}`, day, title: '减税招商到期', detail: '十日之期已满，政务收入恢复常例。' });
    if (stale) log.push({ id: `choice-auto-${stale.day}`, day, title: `${titleOf(stale)}（自动）`, detail: `未及决断，按现钱入府库${capNote}。`, goldDelta: stored(cashValue(stale)) || undefined });
    if (settledFresh) log.push({ id: `choice-auto-${day}`, day, title: `${titleOf(settledFresh)}（自动）`, detail: `伴侣心事尚待回应，此事按现钱入府库${capNote}。`, goldDelta: stored(cashValue(settledFresh)) || undefined });
    if (dailyEvent) log.push({ id: `daily-${day}`, day, title: dailyEvent.title, detail: capNote ? `${dailyEvent.detail.replace(/。$/, '')}${capNote}。` : dailyEvent.detail, goldDelta: stored(dailyEvent.goldDelta) || undefined });
  }

  return {
    ...state,
    day,
    incomeBuff: buffOn ? state.incomeBuff : null,
    pendingChoice,
    treasury: { gold: storedGold + incomeGain + eventGold, days: Math.min(TREASURY_HARD_CAP_DAYS, storedDays + 1) },
    orders: options.dayOrders && isOrderDay(day, state.homeLevel) ? Math.min(orderCapOf(state), state.orders + 1) : state.orders,
    eventLog: log.length > 0 ? [...log, ...state.eventLog].slice(0, MAX_EVENT_LOG) : state.eventLog
  };
}

/** 把 ms 写成「约 N 分 / 约 N 小时」 */
export function formatWait(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return `约 ${minutes} 分`;
  const hours = minutes / 60;
  return `约 ${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)} 小时`;
}

function formatAway(ms: number) {
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `${hours} 小时`;
  return `${Math.max(1, Math.round(ms / 60000))} 分钟`;
}

/**
 * 按锚点推进：n = ⌊(now − clockAt) / DAY_MS⌋，逐日调 stepDay，clockAt += n × DAY_MS（余数保留）。
 * now 早于 clockAt（时间回拨）一律不推进；一次最多 240 日，超出的直接丢弃。
 * 只按锚点算、不按 tick 次数算，所以后台节流不会少算。
 */
export function advanceClock(state: GameState, now: number, options: { dayOrders?: boolean } = {}): { state: GameState; tally: StepTally; away: number } {
  const tally = emptyTally();
  if (!state.selectedLordId || !Number.isFinite(now) || now < state.clockAt) return { state, tally, away: 0 };
  const ms = dayMs();
  const due = Math.floor((now - state.clockAt) / ms);
  if (due <= 0) return { state, tally, away: 0 };
  const n = Math.min(MAX_CATCHUP_DAYS, due);
  const big = n >= BIG_GAP_DAYS;
  let next = state;
  for (let i = 0; i < n; i += 1) next = stepDay(next, { log: !big, dayOrders: options.dayOrders }, tally);
  const away = now - state.clockAt;
  next = { ...next, clockAt: n < due ? now : state.clockAt + n * ms };
  if (big) {
    const stage = treasuryStage(next.treasury.days, next.homeLevel);
    const waiting = next.pendingChoice && next.pendingChoice !== state.pendingChoice;
    next = {
      ...next,
      eventLog: [
        {
          id: `away-${now}`,
          day: next.day,
          title: '离府归来',
          detail: `离开 ${formatAway(away)}，府库积 ${next.treasury.gold.toLocaleString()} 金（${stage === 'hard' ? '已积满 48 日' : stage === 'half' ? '已满' : '未满'}）${tally.eventCount > 0 ? `，${tally.eventCount} 桩府中喜事折现入库` : ''}${waiting ? '，另有 1 桩待定夺' : ''}。`
        },
        ...next.eventLog
      ].slice(0, MAX_EVENT_LOG)
    };
  }
  return { state: next, tally, away };
}

/** 军令按 orderClockAt 回复：k = ⌊(now − orderClockAt) / 间隔⌋；已满时不动锚点（由 reducer 在跌出满额时重置为当下） */
export function advanceOrders(state: GameState, now: number): GameState {
  if (!state.selectedLordId || !Number.isFinite(now) || now < state.orderClockAt) return state;
  const cap = orderCapOf(state);
  if (state.orders >= cap) return state;
  const ms = orderMsFor(state.homeLevel);
  const k = Math.floor((now - state.orderClockAt) / ms);
  if (k <= 0) return state;
  const orders = Math.min(cap, state.orders + k);
  return { ...state, orders, orderClockAt: orders >= cap ? now : state.orderClockAt + k * ms };
}

/** 下一道军令还要多久；已满返回 null */
export function nextOrderInMs(state: GameState, now: number): number | null {
  if (state.orders >= orderCapOf(state)) return null;
  return Math.max(0, state.orderClockAt + orderMsFor(state.homeLevel) - now);
}

/** 府库下一日还要多久 */
export function nextDayInMs(state: Pick<GameState, 'clockAt'>, now: number) {
  return Math.max(0, state.clockAt + dayMs() - now);
}

/** 一整笔府库按所办之事处置：钱粮全额；军务/治理积满 4 日才练（少拿 1 日收入），不满 4 日或练满按全额 */
export function treasuryOutcome(state: GameState, kind: AffairKind) {
  const { gold, days } = state.treasury;
  const trained = kind === 'military' ? state.affairTraining.strength : state.affairTraining.civil;
  const trainable = kind !== 'treasury' && trained < AFFAIR_TRAINING_CAP;
  const trains = trainable && days >= TRAIN_MIN_DAYS;
  const cut = trains ? Math.min(gold, dayIncomeOf(state, state.day)) : 0;
  return { gold: gold - cut, cut, trains, trainable, days };
}

/** 收取府库：入账、清空府库、按所办之事练属性 */
export function collectTreasury(state: GameState, kind: AffairKind, options: { log?: boolean } = {}): GameState {
  const { gold: stored, days } = state.treasury;
  if (stored <= 0 && days <= 0) return state;
  const outcome = treasuryOutcome(state, kind);
  const affairTraining = outcome.trains
    ? { ...state.affairTraining, ...(kind === 'military' ? { strength: state.affairTraining.strength + 1 } : { civil: state.affairTraining.civil + 1 }) }
    : state.affairTraining;
  return {
    ...state,
    gold: state.gold + outcome.gold,
    treasury: { gold: 0, days: 0 },
    affairTraining,
    eventLog: options.log
      ? [{ id: `treasury-${state.day}-${state.eventLog.length}`, day: state.day, title: '收取府库', detail: `积 ${days} 日，入账 ${outcome.gold.toLocaleString()} 金${outcome.trains ? `，${kind === 'military' ? '武力' : '智谋、声望'} +1` : ''}。`, goldDelta: outcome.gold || undefined }, ...state.eventLog].slice(0, MAX_EVENT_LOG)
      : state.eventLog
  };
}

/** 开府第几天（真实天数，第一天算 1） */
export function foundedDays(foundedAt: number, now: number) {
  if (!Number.isFinite(foundedAt) || foundedAt > now) return 1;
  return Math.floor((now - foundedAt) / REAL_DAY_MS) + 1;
}

/** 「开府 M 天（第 N 日）」 */
export function openDaysLabel(foundedAt: number, day: number, now: number) {
  return `开府 ${foundedDays(foundedAt, now)} 天（第 ${day} 日）`;
}
