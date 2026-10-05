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
  pendingChoice: { eventId: string; day: number; dailyIncome: number } | null;
  partnerBoosts: Record<string, { strength?: number; intelligence?: number; charisma?: number }>;
  resolvedPartnerEvents: Record<string, string>;
  incomeBuff: { percent: number; untilDay: number } | null;
  nextBattleBonus: number | null;
  /** 进入战斗时记下，结算后清空；读档时仍在说明中途离开，按认输处理 */
  activeBattle: { mode: BattleMode; lossGold: number } | null;
  soundEnabled: boolean;
  tutorialDone: boolean;
  lastScreen: Screen;
  eventLog: GameEvent[];
  lastSavedAt: number;
}

export type BattleOutcome = 'win' | 'loss' | 'retreat';
export const LOSS_PENALTY_RATE = 0.2;
export type BattleMode = 'land' | 'naval' | 'court' | 'frontier';

export interface GameEvent {
  id: string;
  day: number;
  title: string;
  detail: string;
  goldDelta?: number;
}
