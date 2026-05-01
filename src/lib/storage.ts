import type { GameState, Screen } from '../types';
import { findHomeLevel } from '../data/gameData';

const STORAGE_KEY = 'jiaye-tianxia-save-v1';
const SAFE_SCREENS: Screen[] = ['title', 'lordSelect', 'home'];
const OFFLINE_TICK_MS = 3000;
const OFFLINE_MIN_MS = 30000;
const OFFLINE_MAX_TICKS = 240;

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
    const safeScreen = sanitizeScreen(parsed.lastScreen ?? parsed.screen);
    const restored: GameState = {
      ...defaultGameState,
      ...parsed,
      screen: parsed.selectedLordId ? safeScreen : 'title',
      lastScreen: safeScreen,
      selectedLordId: parsed.selectedLordId ?? null,
      ownedPartnerIds: Array.isArray(parsed.ownedPartnerIds) ? parsed.ownedPartnerIds : [],
      claimedQuestIds: Array.isArray(parsed.claimedQuestIds) ? parsed.claimedQuestIds : [],
      eventLog: Array.isArray(parsed.eventLog) ? parsed.eventLog : [],
      equippedWeaponId: parsed.equippedWeaponId ?? defaultGameState.equippedWeaponId,
      soundEnabled: parsed.soundEnabled ?? true,
      tutorialDone: Boolean(parsed.tutorialDone),
      lastSavedAt: typeof parsed.lastSavedAt === 'number' ? parsed.lastSavedAt : Date.now()
    };
    return applyOfflineIncome(restored);
  } catch {
    return defaultGameState;
  }
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
    ].slice(0, 18),
    lastSavedAt: Date.now()
  };
}
