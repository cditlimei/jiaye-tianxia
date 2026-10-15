import type { FiefPolicyId } from './data/fiefs';
import type { FiefHoldings } from './data/fiefs';
import type { AmbitionId } from './data/ambitions';
import type { RealmCounts, RealmId } from './data/dynasty';
import type { AiSkill } from './lib/doudizhu';

/** 牌局类郡战：攻郡、守城（反攻）、收复（失郡 72 小时内半价） */
export type ConquestKind = 'attack' | 'defend' | 'reclaim';

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
  /** v2.2 起记守城胜场（北疆边患收起，字段名沿用） */
  frontierWins: number;
  /** 北疆边患（v2.2 收起）：读档一律置空，nextRaidDay 不再读 */
  frontierRaid: { startDay: number; startedAt: number; dueAt: number } | null;
  nextRaidDay: number;
  /** 邻郡反攻：进行中的一次（见 lib/siege.ts） */
  siege: { fiefId: string; attacker: string; skill: AiSkill; startedAt: number; dueAt: number } | null;
  /** 下一次反攻不早于此刻（真实毫秒，0 = 未计时） */
  nextSiegeAt: number;
  /** 各郡城防 1..2；不满时该郡牌桌特权暂停 */
  fiefWalls: Record<string, number>;
  /** 各郡得郡时刻（72 小时保护期） */
  fiefTakenAt: Record<string, number>;
  /** 失郡时刻（72 小时内半价收复） */
  lostFiefs: Record<string, number>;
  /** 本代最高郡数（开疆志向按它算，失郡不倒退） */
  peakFiefs: number;
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
  activeBattle: { mode: BattleMode; lossGold: number; rewardGold?: number; odds?: number; doudizhu?: boolean; multiplier?: number; share?: number; conquest?: { fiefId: string; policyId: FiefPolicyId; stake: number; refundRate?: number; kind?: ConquestKind } } | null;
  /** 军令：出征消耗（守城、切磋不耗），v2.3 起按真实时间回（府邸前 20 分、府邸起 120 分一道，见 lib/clock.ts），上限 8 随整军封地增加 */
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
  /** v2.3 真实时间：按日结算的锚点（每满 DAY_MS 推进一日，余数保留；见 lib/clock.ts） */
  clockAt: number;
  /** 军令回复的锚点（府邸前 20 分、府邸起 120 分回 1 道） */
  orderClockAt: number;
  /** 府库：推进的日子把政务收入与府中现钱积在这里，收取才入账（days 封顶 48） */
  treasury: { gold: number; days: number };
  /** 1 = 真实时间口径；老存档没有，第一次读入先按旧规则补足离线再切 */
  clockVersion: number;
  /** 本代开府时刻（显示「开府 M 天」；老存档取读档时刻减 day × 1 小时） */
  foundedAt: number;
}

export interface DynastyEntry {
  dynasty: number;
  /** 该朝的国号（开国第一朝为 null） */
  realm: RealmId | null;
  generations: number;
  days: number;
  wins: number;
  ambitions: number;
  /** v2.3 起记：本朝开府多少天（各代相加，老记录没有） */
  openDays?: number;
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
  /** v2.3 起记：本代开府多少天（真实天数） */
  openDays?: number;
}

export type BattleOutcome = 'win' | 'loss' | 'retreat';
export const LOSS_PENALTY_RATE = 0.2;
export const ORDER_CAP = 8;
export const ORDER_START = 3;
export const ORDER_REGEN_DAYS = 2;
/** 推进到第 day 日是否回一道军令（v2.3 起玩家按真实时间回军令，见 lib/clock.ts；按日回复只剩老存档补算与测试开关 jiaye-clock-manual） */
/** 府邸以前军令每日回 1 道（新手期每天都想出征），之后每 2 日回 1 道 */
export const ORDER_FAST_HOME_LEVEL = 4;
export const isOrderDay = (day: number, homeLevel = ORDER_FAST_HOME_LEVEL) => homeLevel < ORDER_FAST_HOME_LEVEL || day % ORDER_REGEN_DAYS === 0;
// daysUntilNextOrder（「N 日后 +1」）v2.3 起由 lib/clock.ts 的 nextOrderInMs（「下一道约 N 分」）取代
export type BattleMode = 'land' | 'naval' | 'court' | 'frontier';

export interface GameEvent {
  id: string;
  day: number;
  title: string;
  detail: string;
  goldDelta?: number;
}
