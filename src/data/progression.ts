import type { HomeLevel, Partner, Weapon } from './gameData';
import type { GameState } from '../types';
import { findPartnerEvent, partnersWithResolvedEvent } from './partnerEvents';
import { ownedFiefCount } from './fiefs';
import { AMBITION_TITLE_COUNT, ambitionsAchieved } from './ambitions';
import { isEndingReached } from './dynasty';
import { traditionOf } from './traditions';
import { minorGoldValue, parseMinorKey } from './minorEvents';

/** 宅邸升到某级时新开放的内容（升阶画面与纪事用） */
export const HOME_UNLOCKS: Record<number, string> = {
  3: '西蜀屯田',
  4: '北疆边患（三日后起）',
  5: '攻郡开疆'
};

export interface Quest {
  id: string;
  title: string;
  description: string;
  rewardGold: number;
  isComplete: (state: GameState, context: QuestContext) => boolean;
}

export interface QuestContext {
  currentHome: HomeLevel;
  ownedPartners: Partner[];
  equippedWeapon: Weapon;
  totalPower: number;
}

export interface QuestStatus extends Quest {
  complete: boolean;
  claimed: boolean;
}

export const quests: Quest[] = [
  {
    id: 'upgrade-wood',
    title: '家业起步',
    description: '将宅邸提升至木屋。',
    rewardGold: 600,
    isComplete: (state) => state.homeLevel >= 2
  },
  {
    id: 'first-partner',
    title: '良缘入府',
    description: '招募任意一位伴侣。',
    rewardGold: 700,
    isComplete: (state) => state.ownedPartnerIds.length >= 1
  },
  {
    id: 'first-weapon',
    title: '开库选锋',
    description: '装备一把新的兵器。',
    rewardGold: 900,
    isComplete: (state) => state.equippedWeaponId !== 'xuanjian'
  },
  {
    id: 'first-win',
    title: '初战立威',
    description: '取得一场讨伐胜利。',
    rewardGold: 1200,
    isComplete: (state) => state.battleWins >= 1
  },
  {
    id: 'estate-third',
    title: '砖瓦成宅',
    description: '将宅邸提升至砖瓦宅。',
    rewardGold: 1800,
    isComplete: (state) => state.homeLevel >= 3
  },
  {
    id: 'power-200',
    title: '威震一郡',
    description: '武力达到 180。',
    rewardGold: 3000,
    isComplete: (_state, context) => context.totalPower >= 180
  },
  {
    // id 沿用旧「江东扬帆」，已领过的不重复领；江东水战 10-15 收起后改为牌局连捷
    id: 'naval-first-win',
    title: '牌桌连捷',
    description: '累计赢下 5 局。',
    rewardGold: 2000,
    isComplete: (state) => state.battleWins >= 5
  },
  {
    // id 沿用旧「名动许都」；许都朝议收起后改为据有两郡
    id: 'court-first-win',
    title: '连下两城',
    description: '拿下两座郡城。',
    rewardGold: 12000,
    isComplete: (state) => ownedFiefCount(state.fiefs) >= 2
  },
  {
    id: 'farm-first',
    title: '西蜀屯田',
    description: '在西蜀开垦第一块田。',
    rewardGold: 1500,
    isComplete: (state) => state.farmLevel >= 1
  },
  {
    id: 'frontier-first-win',
    title: '北疆靖边',
    description: '击退一次北疆边患。',
    rewardGold: 4000,
    isComplete: (state) => state.frontierWins >= 1
  },
  {
    id: 'succession',
    title: '传承家业',
    description: '完成一次传位，开启新的一代。',
    rewardGold: 5000,
    isComplete: (state) => state.generation >= 2
  },
  {
    id: 'partner-event',
    title: '良缘佳话',
    description: '替一位伴侣了却一桩心事。',
    rewardGold: 1500,
    isComplete: (state) => partnersWithResolvedEvent(state.resolvedPartnerEvents) >= 1
  },
  {
    id: 'fief-first',
    title: '初封一郡',
    description: '开拓第一块封地。',
    rewardGold: 8000,
    isComplete: (state) => ownedFiefCount(state.fiefs) >= 1
  },
  {
    id: 'three-partners',
    title: '内府成势',
    description: '招募三位伴侣。',
    rewardGold: 2500,
    isComplete: (state) => state.ownedPartnerIds.length >= 3
  }
];

export interface Title {
  id: string;
  name: string;
  /** 达成条件的人话，用于「下一称号」提示 */
  requirement: string;
  isEarned: (state: GameState) => boolean;
  /** 跨代的家声称号，不和本代称号抢显示位 */
  lineage?: boolean;
}

// 本代称号按档位从低到高排列，显示已达成里档位最高的；家声称号单列。本代称号由存档实时算出；家声另记入 earnedTitles，开新朝后不收回
export const titles: Title[] = [
  { id: 'commoner', name: '白身', requirement: '', isEarned: () => true },
  { id: 'gentry', name: '乡绅', requirement: '宅邸升至砖瓦宅', isEarned: (s) => s.homeLevel >= 3 },
  { id: 'warlord', name: '一方豪强', requirement: '累计 10 场胜利', isEarned: (s) => s.battleWins >= 10 },
  { id: 'magnate', name: '府邸之主', requirement: '宅邸升至府邸', isEarned: (s) => s.homeLevel >= 4 },
  { id: 'marquis-house', name: '侯门显贵', requirement: '宅邸升至侯府', isEarned: (s) => s.homeLevel >= 5 },
  { id: 'river-tiger', name: '百战之将', requirement: '累计 20 场胜利', isEarned: (s) => s.battleWins >= 20 },
  { id: 'court-star', name: '坐拥两郡', requirement: '封地两郡', isEarned: (s) => ownedFiefCount(s.fiefs) >= 2 },
  { id: 'north-general', name: '镇北将军', requirement: '击退 3 次边患', isEarned: (s) => s.frontierWins >= 3 },
  { id: 'granary', name: '坐拥沃野', requirement: '屯田升至沃野千里', isEarned: (s) => s.farmLevel >= 5 },
  { id: 'harmony', name: '内府和睦', requirement: '了却 5 位伴侣的心事', isEarned: (s) => partnersWithResolvedEvent(s.resolvedPartnerEvents) >= 5 },
  { id: 'confidant', name: '知心人', requirement: '了却 5 位伴侣的第二段心事', isEarned: (s) => Object.keys(s.resolvedPartnerEvents).filter((k) => k.endsWith('#2')).length >= 5 },
  { id: 'hegemon', name: '一代枭雄', requirement: '宅邸王城且累计 30 场胜利', isEarned: (s) => s.homeLevel >= 6 && s.battleWins >= 30 },
  { id: 'founder', name: '开国元勋', requirement: '完成一次传位', isEarned: (s) => s.generation >= 2, lineage: true },
  { id: 'eternal', name: '千秋家业', requirement: '家业点累计 10 点', isEarned: (s) => s.legacyPoints >= 10, lineage: true },
  { id: 'marquis', name: '裂土封侯', requirement: '封地三郡', isEarned: (s) => ownedFiefCount(s.fiefs) >= 3, lineage: true },
  { id: 'six-commanderies', name: '六郡之主', requirement: '六郡尽归府下', isEarned: (s) => ownedFiefCount(s.fiefs) >= 6, lineage: true },
  { id: 'restorer', name: '再造山河', requirement: '开创第二朝', isEarned: (s) => s.pastDynasties.length >= 1, lineage: true },
  { id: 'three-dynasties', name: '三朝元老', requirement: '历经三朝（开创第三朝）', isEarned: (s) => s.pastDynasties.length >= 2, lineage: true },
  { id: 'three-realms', name: '三分归一', requirement: '魏、蜀、吴三个国号都立过', isEarned: (s) => s.realms.wei > 0 && s.realms.shu > 0 && s.realms.wu > 0, lineage: true },
  { id: 'unifier', name: '天下归心', requirement: '六郡尽归、王城、家业点满', isEarned: (s) => isEndingReached(s), lineage: true },
  { id: 'tradition', name: '家风传世', requirement: '连续两代达成同一志向', isEarned: (s) => traditionOf(s.chronicle) !== null, lineage: true },
  { id: 'scholarly', name: '家学渊源', requirement: `三代志向达成`, isEarned: (s) => ambitionsAchieved(s) >= AMBITION_TITLE_COUNT, lineage: true }
];

/**
 * 天下归心时必然满足的家声：六郡（含三郡）、家业点满（≥10）、传过位（家业点只能靠传位得）。
 * 老存档没有 earnedTitles，有前朝即说明到过终局，按此补记。
 */
export const ENDING_LINEAGE_TITLE_IDS = ['founder', 'eternal', 'marquis', 'six-commanderies', 'unifier'];

/** 称号是否已得：家声看记录或当前满足，本代称号只看当前 */
export function hasTitle(state: GameState, title: Title) {
  return (title.lineage && state.earnedTitles.includes(title.id)) || title.isEarned(state);
}

/** 把当前满足的家声并入记录（只增不减）；没有新增时返回原 state，免得多余重渲染 */
export function collectEarnedTitles(state: GameState): GameState {
  const fresh = titles.filter((title) => title.lineage && !state.earnedTitles.includes(title.id) && title.isEarned(state)).map((title) => title.id);
  return fresh.length > 0 ? { ...state, earnedTitles: [...state.earnedTitles, ...fresh] } : state;
}

export function getTitleStatus(state: GameState) {
  const ranked = titles.filter((title) => !title.lineage);
  let currentIndex = 0;
  ranked.forEach((title, index) => {
    if (title.isEarned(state)) currentIndex = index;
  });
  // 只提示比当前更高的称号，达成后显示位一定会变
  const next = ranked.slice(currentIndex + 1).find((title) => !title.isEarned(state)) ?? null;
  const missing = ranked.filter((title) => !title.isEarned(state)).length;
  const lineage = [...titles].reverse().find((title) => title.lineage && hasTitle(state, title)) ?? null;
  return { current: ranked[currentIndex], next, missing, lineage };
}

export function getQuestStatuses(state: GameState, context: QuestContext): QuestStatus[] {
  return quests.map((quest) => ({
    ...quest,
    complete: quest.isComplete(state, context),
    claimed: state.claimedQuestIds.includes(quest.id)
  }));
}

export interface ChoiceOption {
  id: string;
  label: string;
  detail: string;
}

export interface ChoiceEvent {
  id: string;
  title: string;
  prompt: string;
  options: [ChoiceOption, ChoiceOption];
}

export const INCOME_BUFF_PERCENT = 40;
export const INCOME_BUFF_DAYS = 10;
export const BATTLE_BONUS_MULTIPLIER = 2;

/** 第 10/15 日的府中事件改为二选一：拿现钱，还是押一个之后的加成 */
export function getChoiceEvent(day: number, dailyIncome: number): ChoiceEvent | null {
  if (day % 15 === 0) {
    return {
      id: 'advisor',
      title: '门客献策',
      prompt: '府中门客进献两策，主公取其一。',
      options: [
        { id: 'gold', label: '经营之策', detail: `整顿钱粮，立得 ${(dailyIncome * 5).toLocaleString()} 金。` },
        { id: 'battleBonus', label: '练兵之策', detail: `厉兵秣马，下一场胜利缴获翻 ${BATTLE_BONUS_MULTIPLIER} 倍。` }
      ]
    };
  }
  // 第 10/50/70… 日商旅（30/90… 让位给门客献策）、第 20/40… 日流民（60/120… 让位给献策）
  if (day % 20 === 0) {
    return {
      id: 'refugees',
      title: '流民归附',
      prompt: '一队流民投奔府上，如何安置？',
      options: [
        { id: 'gold', label: '编户纳粮', detail: `编入户籍，立得 ${(dailyIncome * 3).toLocaleString()} 金。` },
        { id: 'order', label: '募为乡勇', detail: '挑出青壮编入军中，军令 +1。' }
      ]
    };
  }
  if (day % 10 === 0) {
    return {
      id: 'merchants',
      title: '商旅归附',
      prompt: '往来商旅愿在府前开市，如何安置？',
      options: [
        { id: 'gold', label: '收取市税', detail: `当下入账 ${(dailyIncome * 3).toLocaleString()} 金。` },
        { id: 'incomeBuff', label: '减税招商', detail: `此后 ${INCOME_BUFF_DAYS} 日处理政务收入 +${INCOME_BUFF_PERCENT}%。` }
      ]
    };
  }
  return null;
}

/** 统一解析待决事件：日历事件或伴侣心事（partner:<id>） */
export function resolvePendingEvent(pending: { eventId: string; day: number; dailyIncome: number }): ChoiceEvent | null {
  if (pending.eventId.startsWith('partner:')) {
    const partnerEvent = findPartnerEvent(pending.eventId.slice('partner:'.length));
    if (!partnerEvent) return null;
    return { id: pending.eventId, title: partnerEvent.title, prompt: partnerEvent.prompt, options: [
      { id: partnerEvent.options[0].id, label: partnerEvent.options[0].label, detail: partnerEvent.options[0].detail },
      { id: partnerEvent.options[1].id, label: partnerEvent.options[1].label, detail: partnerEvent.options[1].detail }
    ] };
  }
  if (pending.eventId.startsWith('minor:')) {
    const minor = parseMinorKey(pending.eventId.slice('minor:'.length));
    if (!minor) return null;
    const gold = minorGoldValue(pending.dailyIncome);
    const [a, b] = minor.template.options;
    return { id: pending.eventId, title: minor.template.title, prompt: minor.template.prompt(minor.partner.name), options: [
      { id: 'a', label: a.label, detail: a.detail(minor.partner.name, gold) },
      { id: 'b', label: b.label, detail: b.detail(minor.partner.name, gold) }
    ] };
  }
  return getChoiceEvent(pending.day, pending.dailyIncome);
}

/** 二选一里「拿现钱」那一项的金额，离线无人决断时按此自动结算 */
export function choiceGoldValue(event: ChoiceEvent, dailyIncome: number) {
  return event.id === 'advisor' ? dailyIncome * 5 : event.id === 'merchants' || event.id === 'refugees' ? dailyIncome * 3 : 0;
}

export function getDailyEvent(day: number, dailyIncome: number) {
  if (day % 5 === 0 && day % 10 !== 0) {
    return {
      title: '乡望渐隆',
      detail: '乡里送来贺礼，家业声势小有增长。',
      goldDelta: dailyIncome * 2
    };
  }

  return null;
}
