import type { FiefPolicyId } from './data/fiefs';
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
  /** 本代处理政务练出来的属性：军务练武力，治理练智谋与声望（各封顶 AFFAIR_TRAINING_CAP，传位清零） */
  affairTraining: { strength: number; civil: number };
  resolvedPartnerEvents: Record<string, string>;
  /** 随行伴侣：带上牌桌、技能生效（须已入府；空或失效时按良缘 > 第一位入府的默认） */
  escortPartnerId: string | null;
  /** 伴侣随行统计：随行局数、技能发动次数 */
  skillStats: Record<string, { games: number; uses: number }>;
  incomeBuff: { percent: number; untilDay: number } | null;
  nextBattleBonus: number | null;
  /** 进入战斗时记下，结算后清空；读档时仍在说明中途离开，按认输处理 */
  /** 进行中的战斗；rewardGold/odds 用于中途离开时按胜率替玩家打完，斗地主中途离开按认输 */
  /** 斗地主另记当前倍数与份额（农民 0.5），刷新逃局按 lossGold×multiplier×share 扣，与认输一致 */
  /** conquest：攻郡牌局（军资出兵时已扣，胜则得郡；中途离开按败；refundRate 是糜夫人「舍身」未克退还比例，出兵时记下，撤兵与刷新离开同样退） */
  activeBattle: { mode: BattleMode; lossGold: number; rewardGold?: number; odds?: number; doudizhu?: boolean; multiplier?: number; share?: number; conquest?: { fiefId: string; policyId: FiefPolicyId; stake: number; refundRate?: number } } | null;
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
  /** 已得家声称号 id：只增不减，开新朝重置世代/封地后仍保留（家声的「已获得」= 记过 或 当前满足） */
  earnedTitles: string[];
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
/** 府邸以前军令每日回 1 道（新手期每天都想出征），之后每 2 日回 1 道 */
export const ORDER_FAST_HOME_LEVEL = 4;
export const isOrderDay = (day: number, homeLevel = ORDER_FAST_HOME_LEVEL) => homeLevel < ORDER_FAST_HOME_LEVEL || day % ORDER_REGEN_DAYS === 0;
export const daysUntilNextOrder = (day: number, homeLevel = ORDER_FAST_HOME_LEVEL) => (homeLevel < ORDER_FAST_HOME_LEVEL ? 1 : ORDER_REGEN_DAYS - (day % ORDER_REGEN_DAYS));
export type BattleMode = 'land' | 'naval' | 'court' | 'frontier';

export interface GameEvent {
  id: string;
  day: number;
  title: string;
  detail: string;
  goldDelta?: number;
}
