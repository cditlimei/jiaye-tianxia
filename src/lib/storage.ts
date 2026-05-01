import type { GameState, Screen } from '../types';
import { findHomeLevel, homeLevels, lords, partners, weapons } from '../data/gameData';
import { quests } from '../data/progression';

const STORAGE_KEY = 'jiaye-tianxia-save-v1';
const SAFE_SCREENS: Screen[] = ['title', 'lordSelect', 'home'];
const OFFLINE_TICK_MS = 3000;
const OFFLINE_MIN_MS = 30000;
const OFFLINE_MAX_TICKS = 240;
const MAX_EVENT_LOG = 18;

export const defaultGameState: GameState = {
  screen: 'title',
  selectedLordId: null,
  gold: 1000,
  homeLevel: 1,
  equippedWeaponId: 'xuanjian',
  ownedPartnerIds: [],
  claimedQuestIds: [],
  day: 1,
  battleWins: 0,
  battleLosses: 0,
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

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultGameState;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<GameState>;
    const restored = normalizeGameState(parsed);
    return applyOfflineIncome(restored);
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

  return {
    ...normalized,
    screen: 'home',
    lastScreen: 'home',
    lastSavedAt: Date.now()
  };
}

export function saveGameState(state: GameState) {
  if (typeof window === 'undefined') {
    return;
  }

  const safeScreen = sanitizeScreen(state.screen);
  const payload: GameState = {
    ...state,
    screen: safeScreen,
    lastScreen: safeScreen,
    lastSavedAt: Date.now()
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearGameState() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY);
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
    equippedWeaponId,
    ownedPartnerIds: sanitizeIds(parsed.ownedPartnerIds, partners),
    claimedQuestIds: sanitizeIds(parsed.claimedQuestIds, quests),
    day: sanitizeNumber(parsed.day, defaultGameState.day, 1),
    battleWins: sanitizeNumber(parsed.battleWins, defaultGameState.battleWins, 0),
    battleLosses: sanitizeNumber(parsed.battleLosses, defaultGameState.battleLosses, 0),
    soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : true,
    tutorialDone: Boolean(parsed.tutorialDone),
    lastScreen: safeScreen,
    eventLog: sanitizeEventLog(parsed.eventLog),
    lastSavedAt: typeof parsed.lastSavedAt === 'number' && Number.isFinite(parsed.lastSavedAt) ? parsed.lastSavedAt : now
  };
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

  const dailyIncome = findHomeLevel(state.homeLevel).dailyIncome;
  const offlineGold = ticks * dailyIncome;
  return {
    ...state,
    gold: state.gold + offlineGold,
    day: state.day + ticks,
    eventLog: [
      {
        id: `offline-${Date.now()}`,
        day: state.day + ticks,
        title: '离线经营',
        detail: `离开期间宅邸照常运转，折算 ${ticks} 天收益。`,
        goldDelta: offlineGold
      },
      ...state.eventLog
    ].slice(0, MAX_EVENT_LOG),
    lastSavedAt: Date.now()
  };
}
