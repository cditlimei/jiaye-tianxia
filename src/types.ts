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
  /** 军令：出征消耗，每 3 个游戏日回 1 道 */
  orders: number;
  soundEnabled: boolean;
  tutorialDone: boolean;
  lastScreen: Screen;
  eventLog: GameEvent[];
  lastSavedAt: number;
}

export type BattleOutcome = 'win' | 'loss' | 'retreat';
export const LOSS_PENALTY_RATE = 0.2;
export const ORDER_CAP = 6;
export const ORDER_START = 3;
export const ORDER_REGEN_DAYS = 3;
/** 推进到第 day 日是否回一道军令 */
export const isOrderDay = (day: number) => day % ORDER_REGEN_DAYS === 0;
export const daysUntilNextOrder = (day: number) => ORDER_REGEN_DAYS - (day % ORDER_REGEN_DAYS);
export type BattleMode = 'land' | 'naval' | 'court' | 'frontier';

export interface GameEvent {
  id: string;
  day: number;
  title: string;
  detail: string;
  goldDelta?: number;
}
