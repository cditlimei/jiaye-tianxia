import type { GameState, Screen } from '../types';

const STORAGE_KEY = 'jiaye-tianxia-save-v1';
const SAFE_SCREENS: Screen[] = ['title', 'lordSelect', 'home'];

export const defaultGameState: GameState = {
  screen: 'title',
  selectedLordId: null,
  gold: 1000,
  homeLevel: 1,
  equippedWeaponId: 'xuanjian',
  ownedPartnerIds: [],
  day: 1,
  battleWins: 0,
  battleLosses: 0,
  soundEnabled: true,
  lastScreen: 'title'
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
    return {
      ...defaultGameState,
      ...parsed,
      screen: parsed.selectedLordId ? safeScreen : 'title',
      lastScreen: safeScreen,
      selectedLordId: parsed.selectedLordId ?? null,
      ownedPartnerIds: Array.isArray(parsed.ownedPartnerIds) ? parsed.ownedPartnerIds : [],
      equippedWeaponId: parsed.equippedWeaponId ?? defaultGameState.equippedWeaponId,
      soundEnabled: parsed.soundEnabled ?? true
    };
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
    lastScreen: safeScreen
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

