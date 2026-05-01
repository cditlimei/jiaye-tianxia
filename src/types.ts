export type Screen = 'title' | 'lordSelect' | 'home' | 'battle';

export interface GameState {
  screen: Screen;
  selectedLordId: string | null;
  gold: number;
  homeLevel: number;
  equippedWeaponId: string;
  ownedPartnerIds: string[];
  claimedQuestIds: string[];
  day: number;
  battleWins: number;
  battleLosses: number;
  soundEnabled: boolean;
  tutorialDone: boolean;
  lastScreen: Screen;
  eventLog: GameEvent[];
  lastSavedAt: number;
}

export type BattleOutcome = 'win' | 'loss' | 'retreat';

export interface GameEvent {
  id: string;
  day: number;
  title: string;
  detail: string;
  goldDelta?: number;
}
