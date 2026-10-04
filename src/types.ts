export type Screen = 'title' | 'lordSelect' | 'partnerSelect' | 'home' | 'battle';

export interface GameState {
  screen: Screen;
  selectedLordId: string | null;
  gold: number;
  homeLevel: number;
  farmLevel: number;
  equippedWeaponId: string;
  ownedWeaponIds: string[];
  ownedPartnerIds: string[];
  claimedQuestIds: string[];
  day: number;
  battleWins: number;
  battleLosses: number;
  navalWins: number;
  courtWins: number;
  frontierWins: number;
  frontierRaid: { startDay: number; startedAt: number; dueAt: number } | null;
  nextRaidDay: number;
  generation: number;
  legacyPoints: number;
  pendingChoice: { eventId: 'merchants' | 'advisor'; day: number; dailyIncome: number } | null;
  incomeBuff: { percent: number; untilDay: number } | null;
  nextBattleBonus: number | null;
  soundEnabled: boolean;
  tutorialDone: boolean;
  lastScreen: Screen;
  eventLog: GameEvent[];
  lastSavedAt: number;
}

export type BattleOutcome = 'win' | 'loss' | 'retreat';
export type BattleMode = 'land' | 'naval' | 'court' | 'frontier';

export interface GameEvent {
  id: string;
  day: number;
  title: string;
  detail: string;
  goldDelta?: number;
}
