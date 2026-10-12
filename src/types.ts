import type { FiefHoldings } from './data/fiefs';
import type { AmbitionId } from './data/ambitions';
import type { RealmCounts, RealmId } from './data/dynasty';

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
  /** 进行中的战斗；rewardGold/odds 用于中途离开时按胜率替玩家打完，斗地主中途离开按认输 */
  activeBattle: { mode: BattleMode; lossGold: number; rewardGold?: number; odds?: number; doudizhu?: boolean } | null;
  /** 军令：出征消耗，每 2 个游戏日回 1 道，上限随整军封地增加 */
  orders: number;
  /** 封地：郡 id → 方略，传位随家业传下 */
  fiefs: FiefHoldings;
  /** 本代志向（第二代起开局三选一）；baseFiefs 记开局时已有几郡，开疆按新增算 */
  ambition: { id: AmbitionId; target: number; baseFiefs: number } | null;
  /** 家谱：每代传位时记一笔 */
  chronicle: ChronicleEntry[];
  /** 本朝国号（第一朝无） */
  realm: RealmId | null;
  /** 历朝国号计数（含本朝）：加成按计数叠加，跨朝永久保留 */
  realms: RealmCounts;
  /** 前朝记录 */
  pastDynasties: DynastyEntry[];
  soundEnabled: boolean;
  tutorialDone: boolean;
  lastScreen: Screen;
  eventLog: GameEvent[];
  lastSavedAt: number;
}

export interface DynastyEntry {
  dynasty: number;
  /** 该朝的国号（开国第一朝为 null） */
  realm: RealmId | null;
  generations: number;
  days: number;
  wins: number;
  ambitions: number;
}

export interface ChronicleEntry {
  generation: number;
  lordId: string;
  days: number;
  gold: number;
  wins: number;
  fiefs: number;
  ambition: AmbitionId | null;
  ambitionDone: boolean;
}

export type BattleOutcome = 'win' | 'loss' | 'retreat';
export const LOSS_PENALTY_RATE = 0.2;
export const ORDER_CAP = 6;
export const ORDER_START = 3;
export const ORDER_REGEN_DAYS = 2;
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
