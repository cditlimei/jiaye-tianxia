import type { GameState, Screen } from '../types';
import { farmLevels, findFarmLevel, findHomeLevel, homeLevels, lords, partners, weapons } from '../data/gameData';
import { choiceGoldValue, getChoiceEvent, getDailyEvent, quests } from '../data/progression';
import { calculateIntelligence, LEGACY_MAX_POINTS, totalDailyIncome } from '../lib/battle';
import { isOrderDay, ORDER_CAP, ORDER_START } from '../types';
import { expireFrontier, RAID_INTERVAL_DAYS, RAID_WINDOW_MS } from '../lib/frontier';
import { isPartnerEventDay, mergePartnerBoost, nextPartnerForEvent } from '../data/partnerEvents';

const STORAGE_KEY = 'jiaye-tianxia-save-v1';
const SAFE_SCREENS: Screen[] = ['title', 'lordSelect', 'partnerSelect', 'home'];
// 离线每满 1 小时折算 1 天（切后台几分钟不算离线），最多补 240 天
const OFFLINE_TICK_MS = 60 * 60 * 1000;
const OFFLINE_MIN_MS = 60 * 60 * 1000;
const OFFLINE_MAX_TICKS = 240;
const MAX_EVENT_LOG = 18;

export const defaultGameState: GameState = {
  screen: 'title',
  selectedLordId: null,
  gold: 1000,
  homeLevel: 1,
  farmLevel: 0,
  equippedWeaponId: 'xuanjian',
  ownedWeaponIds: ['xuanjian'],
  ownedPartnerIds: [],
  claimedQuestIds: [],
  day: 1,
  battleWins: 0,
  battleLosses: 0,
  navalWins: 0,
  courtWins: 0,
  frontierWins: 0,
  frontierRaid: null,
  nextRaidDay: RAID_INTERVAL_DAYS,
  generation: 1,
  legacyPoints: 0,
  pendingChoice: null,
  partnerBoosts: {},
  resolvedPartnerEvents: {},
  incomeBuff: null,
  nextBattleBonus: null,
  activeBattle: null,
  orders: ORDER_START,
  soundEnabled: true,
  tutorialDone: false,
  lastScreen: 'title',
  eventLog: [],
  lastSavedAt: Date.now()
};

export function loadGameState(): GameState {
  if (typeof window === 'undefined') {
    return defaultGameState;
  }

  const raw = safeGetItem();
  if (!raw) {
    return defaultGameState;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<GameState>;
    const restored = normalizeGameState(parsed);
    return settleExpiredRaid(applyOfflineIncome(settleAbandonedBattle(restored)));
  } catch {
    return defaultGameState;
  }
}

export function parseImportedGameState(raw: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('存档不是有效 JSON。');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('存档内容格式不正确。');
  }

  const normalized = normalizeGameState(parsed as Partial<GameState>, Date.now());
  if (!normalized.selectedLordId) {
    throw new Error('存档缺少有效主公。');
  }

  const screen = normalized.ownedPartnerIds.length > 0 ? 'home' : 'partnerSelect';
  return {
    ...normalized,
    screen,
    lastScreen: screen,
    lastSavedAt: Date.now()
  };
}

export function parseSyncedGameState(raw: string | null): GameState | null {
  if (!raw) {
    return null;
  }
  try {
    const normalized = normalizeGameState(JSON.parse(raw) as Partial<GameState>);
    return normalized.selectedLordId ? normalized : null;
  } catch {
    return null;
  }
}

export const GAME_STORAGE_KEY = STORAGE_KEY;

export function readRawGameState() {
  return typeof window === 'undefined' ? null : safeGetItem();
}

export function saveGameState(state: GameState, { force = false } = {}) {
  if (typeof window === 'undefined') {
    return;
  }
  // 内容未变（忽略存档时间和所在页面）时不重复写，避免多标签页同步来回触发
  if (!force && sameProgress(state, safeGetItem())) {
    return;
  }

  const safeScreen = sanitizeScreen(state.screen);
  const payload: GameState = {
    ...state,
    screen: safeScreen,
    lastScreen: safeScreen,
    lastSavedAt: Date.now()
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 存储被禁用或空间已满时继续游戏，只是本次进度不落盘
  }
}

export function clearGameState() {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 同上
    }
  }
}

function sameProgress(state: GameState, raw: string | null) {
  if (!raw) return false;
  try {
    const strip = ({ screen: _screen, lastScreen: _lastScreen, lastSavedAt: _lastSavedAt, ...rest }: GameState) => rest;
    return stableStringify(strip(state)) === stableStringify(strip(JSON.parse(raw) as GameState));
  } catch {
    return false;
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
      : item
  );
}

function safeGetItem() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function sanitizeScreen(screen: Screen | undefined): Screen {
  if (screen && SAFE_SCREENS.includes(screen)) {
    return screen;
  }
  return 'home';
}

function normalizeGameState(parsed: Partial<GameState>, now = Date.now()): GameState {
  const selectedLordId = isKnownId(parsed.selectedLordId, lords) ? parsed.selectedLordId : null;
  const safeScreen = selectedLordId ? sanitizeScreen(parsed.lastScreen ?? parsed.screen) : 'title';
  const homeLevel = homeLevels.some((home) => home.level === parsed.homeLevel) ? Number(parsed.homeLevel) : defaultGameState.homeLevel;
  const equippedWeaponId = isKnownId(parsed.equippedWeaponId, weapons) ? parsed.equippedWeaponId : defaultGameState.equippedWeaponId;

  return {
    ...defaultGameState,
    screen: safeScreen,
    selectedLordId,
    gold: sanitizeNumber(parsed.gold, defaultGameState.gold, 0),
    homeLevel,
    farmLevel: farmLevels.some((farm) => farm.level === parsed.farmLevel) ? Number(parsed.farmLevel) : 0,
    equippedWeaponId,
    // 旧存档没有这个字段：玄铁剑 + 当时装备的兵器视为已拥有
    ownedWeaponIds: [...new Set(['xuanjian', equippedWeaponId, ...sanitizeIds(parsed.ownedWeaponIds, weapons)])],
    ownedPartnerIds: sanitizeIds(parsed.ownedPartnerIds, partners),
    claimedQuestIds: sanitizeIds(parsed.claimedQuestIds, quests),
    day: sanitizeNumber(parsed.day, defaultGameState.day, 1),
    battleWins: sanitizeNumber(parsed.battleWins, defaultGameState.battleWins, 0),
    battleLosses: sanitizeNumber(parsed.battleLosses, defaultGameState.battleLosses, 0),
    navalWins: sanitizeNumber(parsed.navalWins, defaultGameState.navalWins, 0),
    courtWins: sanitizeNumber(parsed.courtWins, defaultGameState.courtWins, 0),
    frontierWins: sanitizeNumber(parsed.frontierWins, defaultGameState.frontierWins, 0),
    frontierRaid: sanitizeRaid(parsed.frontierRaid),
    generation: sanitizeNumber(parsed.generation, 1, 1),
    legacyPoints: Math.min(LEGACY_MAX_POINTS, sanitizeNumber(parsed.legacyPoints, 0, 0)),
    pendingChoice: sanitizeChoice(parsed.pendingChoice),
    partnerBoosts: sanitizeBoosts(parsed.partnerBoosts),
    resolvedPartnerEvents: sanitizeResolved(parsed.resolvedPartnerEvents),
    incomeBuff: sanitizeBuff(parsed.incomeBuff),
    nextBattleBonus: typeof parsed.nextBattleBonus === 'number' && parsed.nextBattleBonus > 1 ? parsed.nextBattleBonus : null,
    activeBattle: sanitizeActiveBattle(parsed.activeBattle),
    orders: Math.min(ORDER_CAP, sanitizeNumber(parsed.orders, ORDER_START, 0)),
    // 旧存档没有边患记录：从下一个 10 日起算，不追溯
    nextRaidDay: typeof parsed.nextRaidDay === 'number' && Number.isFinite(parsed.nextRaidDay)
      ? Math.max(1, Math.floor(parsed.nextRaidDay))
      : sanitizeNumber(parsed.day, 1, 1) + RAID_INTERVAL_DAYS,
    soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : true,
    tutorialDone: Boolean(parsed.tutorialDone),
    lastScreen: safeScreen,
    eventLog: sanitizeEventLog(parsed.eventLog),
    lastSavedAt: typeof parsed.lastSavedAt === 'number' && Number.isFinite(parsed.lastSavedAt) ? parsed.lastSavedAt : now
  };
}

function sanitizeActiveBattle(value: unknown): GameState['activeBattle'] {
  if (!value || typeof value !== 'object') return null;
  const b = value as { mode?: unknown; lossGold?: unknown; rewardGold?: unknown; odds?: unknown; doudizhu?: unknown };
  if (b.mode !== 'land' && b.mode !== 'naval' && b.mode !== 'court' && b.mode !== 'frontier') return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const odds = num(b.odds);
  const rewardGold = num(b.rewardGold);
  return {
    mode: b.mode,
    lossGold: Math.max(0, Math.floor(num(b.lossGold) ?? 0)),
    ...(rewardGold !== undefined ? { rewardGold: Math.max(0, Math.floor(rewardGold)) } : {}),
    ...(odds !== undefined ? { odds: Math.min(1, Math.max(0, odds)) } : {}),
    ...(b.doudizhu === true ? { doudizhu: true } : {})
  };
}

/** 战斗中途刷新/关页：按认输结算（北疆只是退守，不扣金） */
function settleAbandonedBattle(state: GameState): GameState {
  if (!state.activeBattle) return state;
  const { mode, lossGold, rewardGold, odds, doudizhu } = state.activeBattle;
  // 自动战：离开不算认输，按出征时显示的胜率替玩家打完（手机来电、切后台不吃亏，也没法靠刷新躲输局）
  if (!doudizhu && mode !== 'frontier' && typeof odds === 'number' && typeof rewardGold === 'number') {
    const win = Math.random() < odds;
    const bonus = win && state.nextBattleBonus ? state.nextBattleBonus : 1;
    const gained = Math.round(rewardGold * bonus);
    const lost = win ? 0 : Math.min(state.gold, lossGold);
    return {
      ...state,
      activeBattle: null,
      gold: state.gold + (win ? gained : 0) - lost,
      nextBattleBonus: win ? null : state.nextBattleBonus,
      battleWins: win ? state.battleWins + 1 : state.battleWins,
      battleLosses: win ? state.battleLosses : state.battleLosses + 1,
      navalWins: win && mode === 'naval' ? state.navalWins + 1 : state.navalWins,
      courtWins: win && mode === 'court' ? state.courtWins + 1 : state.courtWins,
      eventLog: [
        win
          ? { id: `abandon-${Date.now()}`, day: state.day, title: '战事已毕', detail: `主公离开时将士照常作战，得胜归来，缴获 ${gained.toLocaleString()} 金${bonus > 1 ? '（练兵之策翻倍）' : ''}。`, goldDelta: gained }
          : { id: `abandon-${Date.now()}`, day: state.day, title: '战事已毕', detail: `主公离开时将士照常作战，未能取胜，折损军资 ${lost.toLocaleString()} 金。`, goldDelta: lost > 0 ? -lost : undefined },
        ...state.eventLog
      ].slice(0, MAX_EVENT_LOG)
    };
  }
  const loss = mode === 'frontier' ? 0 : Math.min(state.gold, lossGold);
  return {
    ...state,
    activeBattle: null,
    gold: state.gold - loss,
    battleLosses: state.battleLosses + 1,
    eventLog: [
      { id: `abandon-${Date.now()}`, day: state.day, title: '中途离阵', detail: mode === 'frontier' ? '战事未了即离开，边患仍在。' : `战事未了即离开，按认输处理，折损军资 ${loss.toLocaleString()} 金。`, goldDelta: loss > 0 ? -loss : undefined },
      ...state.eventLog
    ].slice(0, MAX_EVENT_LOG)
  };
}

function sanitizeChoice(value: unknown): GameState['pendingChoice'] {
  if (!value || typeof value !== 'object') return null;
  const c = value as { eventId?: unknown; day?: unknown; dailyIncome?: unknown };
  if (typeof c.eventId !== 'string' || typeof c.day !== 'number' || typeof c.dailyIncome !== 'number') return null;
  if (c.eventId !== 'merchants' && c.eventId !== 'advisor' && c.eventId !== 'refugees' && !c.eventId.startsWith('partner:')) return null;
  return { eventId: c.eventId, day: Math.floor(c.day), dailyIncome: Math.max(0, Math.floor(c.dailyIncome)) };
}

function sanitizeBoosts(value: unknown): GameState['partnerBoosts'] {
  if (!value || typeof value !== 'object') return {};
  const out: GameState['partnerBoosts'] = {};
  for (const [id, boost] of Object.entries(value as Record<string, unknown>)) {
    if (!partners.some((p) => p.id === id) || !boost || typeof boost !== 'object') continue;
    const b = boost as Record<string, unknown>;
    const pick = (k: string) => (typeof b[k] === 'number' && Number.isFinite(b[k]) ? Math.max(0, Math.min(30, Math.floor(b[k] as number))) : undefined);
    out[id] = { strength: pick('strength'), intelligence: pick('intelligence'), charisma: pick('charisma') };
  }
  return out;
}

function sanitizeResolved(value: unknown): GameState['resolvedPartnerEvents'] {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([id, v]) => partners.some((p) => p.id === id) && typeof v === 'string') as [string, string][]);
}

function sanitizeBuff(value: unknown): GameState['incomeBuff'] {
  if (!value || typeof value !== 'object') return null;
  const b = value as { percent?: unknown; untilDay?: unknown };
  if (typeof b.percent !== 'number' || typeof b.untilDay !== 'number' || b.percent <= 0) return null;
  return { percent: Math.floor(b.percent), untilDay: Math.floor(b.untilDay) };
}

function sanitizeRaid(value: unknown): GameState['frontierRaid'] {
  if (!value || typeof value !== 'object') return null;
  const raid = value as { startDay?: unknown; startedAt?: unknown; dueAt?: unknown };
  if (typeof raid.startDay !== 'number' || !Number.isFinite(raid.startDay)) return null;
  const now = Date.now();
  // 早期版本只记游戏日，没有真实时间：从现在起重新给 24 小时
  const startedAt = typeof raid.startedAt === 'number' && Number.isFinite(raid.startedAt) ? raid.startedAt : now;
  const dueAt = typeof raid.dueAt === 'number' && Number.isFinite(raid.dueAt) ? raid.dueAt : now + RAID_WINDOW_MS;
  if (dueAt < startedAt) return null;
  return { startDay: Math.max(1, Math.floor(raid.startDay)), startedAt, dueAt };
}

function sanitizeNumber(value: unknown, fallback: number, min: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.floor(value));
}

function sanitizeIds<T extends { id: string }>(value: unknown, catalog: T[]) {
  if (!Array.isArray(value)) {
    return [];
  }

  const validIds = new Set(catalog.map((item) => item.id));
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && validIds.has(item)))];
}

function isKnownId<T extends { id: string }>(value: unknown, catalog: T[]): value is string {
  return typeof value === 'string' && catalog.some((item) => item.id === value);
}

function sanitizeEventLog(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((event) => event && typeof event === 'object')
    .map((event) => {
      const item = event as Partial<GameState['eventLog'][number]>;
      return {
        id: typeof item.id === 'string' ? item.id : `event-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        day: sanitizeNumber(item.day, 1, 1),
        title: typeof item.title === 'string' ? item.title.slice(0, 24) : '府中纪事',
        detail: typeof item.detail === 'string' ? item.detail.slice(0, 80) : '',
        goldDelta: typeof item.goldDelta === 'number' && Number.isFinite(item.goldDelta) ? Math.floor(item.goldDelta) : undefined
      };
    })
    .slice(0, MAX_EVENT_LOG);
}

/** 关着页面时边患到期：读档即失守扣金一次（离线不会起新边患） */
function settleExpiredRaid(state: GameState): GameState {
  const step = expireFrontier(state, state.day);
  if (!step.event) {
    return state;
  }
  return {
    ...state,
    gold: state.gold + step.goldDelta,
    frontierRaid: step.frontierRaid,
    nextRaidDay: step.nextRaidDay,
    eventLog: [step.event, ...state.eventLog].slice(0, MAX_EVENT_LOG)
  };
}

function applyOfflineIncome(state: GameState): GameState {
  if (!state.selectedLordId) {
    return state;
  }

  const elapsed = Date.now() - state.lastSavedAt;
  if (elapsed < OFFLINE_MIN_MS) {
    return state;
  }

  const ticks = Math.min(OFFLINE_MAX_TICKS, Math.floor(elapsed / OFFLINE_TICK_MS));
  if (ticks <= 0) {
    return state;
  }

  const lord = lords.find((item) => item.id === state.selectedLordId);
  const ownedPartners = partners.filter((item) => state.ownedPartnerIds.includes(item.id)).map((item) => mergePartnerBoost(item, state.partnerBoosts[item.id]));
  const dailyIncome = totalDailyIncome(
    findHomeLevel(state.homeLevel).dailyIncome,
    findFarmLevel(state.farmLevel).incomePercent,
    state.legacyPoints,
    lord ? calculateIntelligence(lord, ownedPartners) : 0,
    findFarmLevel(state.farmLevel).flatIncome
  );
  let regainedOrders = 0;
  // 与手动处理政务一致：离线期间经过的每一天也触发府中事件
  let eventGold = 0;
  let eventCount = 0;
  let lastChoiceDay: number | null = null;
  let partnerDay: number | null = null;
  const duePartner = nextPartnerForEvent(state.ownedPartnerIds, state.resolvedPartnerEvents);
  // 减税招商按天生效，与在线处理政务同口径
  let incomeGold = 0;
  for (let day = state.day + 1; day <= state.day + ticks; day += 1) {
    incomeGold += state.incomeBuff && day <= state.incomeBuff.untilDay ? Math.round(dailyIncome * (1 + state.incomeBuff.percent / 100)) : dailyIncome;
    if (duePartner && partnerDay === null && isPartnerEventDay(day)) partnerDay = day;
    const dailyEvent = getDailyEvent(day, dailyIncome);
    if (dailyEvent) {
      eventGold += dailyEvent.goldDelta;
      eventCount += 1;
    }
    if (isOrderDay(day)) regainedOrders += 1;
    const choice = getChoiceEvent(day, dailyIncome);
    if (choice) {
      lastChoiceDay = day;
      eventGold += choiceGoldValue(choice, dailyIncome);
      eventCount += 1;
    }
  }
  // 离线期间最近的一桩二选一留给玩家回来决断（已有待决事件时不覆盖），其余按现钱入账
  let pendingChoice = state.pendingChoice;
  if (partnerDay !== null && duePartner && !state.pendingChoice) {
    // 伴侣心事只此一回，优先留给玩家；同期的二选一按现钱入账
    pendingChoice = { eventId: `partner:${duePartner}`, day: partnerDay, dailyIncome };
  } else if (lastChoiceDay !== null && !state.pendingChoice) {
    const kept = getChoiceEvent(lastChoiceDay, dailyIncome)!;
    eventGold -= choiceGoldValue(kept, dailyIncome);
    eventCount -= 1;
    pendingChoice = { eventId: kept.id, day: lastChoiceDay, dailyIncome };
  }
  const offlineGold = incomeGold + eventGold;
  const incomeBuff = state.incomeBuff && state.day + ticks < state.incomeBuff.untilDay ? state.incomeBuff : null;
  return {
    ...state,
    gold: state.gold + offlineGold,
    day: state.day + ticks,
    pendingChoice,
    incomeBuff,
    orders: Math.min(ORDER_CAP, state.orders + regainedOrders),
    eventLog: [
      {
        id: `offline-${Date.now()}`,
        day: state.day + ticks,
        title: '离线经营',
        detail: `离开期间宅邸照常运转，折算 ${ticks} 天收益${eventCount > 0 ? `，另有 ${eventCount} 桩府中喜事` : ''}${pendingChoice && pendingChoice !== state.pendingChoice ? `；${pendingChoice.eventId.startsWith('partner:') ? '有位伴侣的心事' : '最近一桩'}尚待主公决断` : ''}。`,
        goldDelta: offlineGold
      },
      ...state.eventLog
    ].slice(0, MAX_EVENT_LOG),
    lastSavedAt: Date.now()
  };
}
