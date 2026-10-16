import type { HomeLevel, Partner, Weapon } from './gameData';
import type { GameState } from '../types';
import { findPartnerEvent, partnersWithResolvedEvent } from './partnerEvents';
import { ownedFiefCount } from './fiefs';
import { CURRENT_TITLE_IDS, CURRENT_TITLE_RULES, LINEAGE_TITLE_IDS, LINEAGE_TITLE_RULES, RETIRED_LINEAGE_IDS, TITLE_INFO } from './titleEffects';
import { minorGoldValue, parseMinorKey } from './minorEvents';

/** 宅邸升到某级时新开放的内容（升阶画面与纪事用） */
export const HOME_UNLOCKS: Record<number, string> = {
  3: '西蜀屯田',
  5: '攻郡开疆（诸郡会遭反攻）'
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
    title: '首守城池',
    description: '守住一次邻郡反攻。',
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
  /** 跨代的家声称号，不和本朝称号抢显示位 */
  lineage?: boolean;
  /** 效果（v3.1 起每个称号都有效果，见 titleEffects.ts） */
  effect: string;
}

// v3.1：本朝称号 6 个（按档位从低到高，显示已达成里档位最高的；现算、不落存档）+ 家声 5 个（记入 earnedTitles，开新朝不收回）
// 条件与效果的唯一来源是 titleEffects.ts；退役的 11 个见 RETIRED_LINEAGE_IDS（家声，白名单保留为旧誉）与下方注释（本朝称号，直接删）
// 已删的本朝称号：warlord 一方豪强、magnate 府邸之主、court-star 坐拥两郡、granary 坐拥沃野、harmony 内府和睦、confidant 知心人
export const titles: Title[] = [
  ...CURRENT_TITLE_IDS.map((id) => ({ id, name: TITLE_INFO[id].name, requirement: TITLE_INFO[id].requirement, effect: TITLE_INFO[id].effect, isEarned: (s: GameState) => CURRENT_TITLE_RULES[id](s) })),
  ...LINEAGE_TITLE_IDS.map((id) => ({ id, name: TITLE_INFO[id].name, requirement: TITLE_INFO[id].requirement, effect: TITLE_INFO[id].effect, isEarned: (s: GameState) => LINEAGE_TITLE_RULES[id](s), lineage: true }))
];

/**
 * 有前朝的老存档（没有 earnedTitles）按此补记：旧版天下归心时必然满足的家声（开国元勋、千秋家业、裂土封侯、六郡之主、天下归心）。
 * 前四个已退役，补记后靠 RETIRED_LINEAGE_IDS 白名单保住，显示为旧誉。
 */
export const ENDING_LINEAGE_TITLE_IDS = ['founder', 'eternal', 'marquis', 'six-commanderies', 'unifier'];

/** 称号是否已得：家声看记录或当前满足，本朝称号只看当前 */
export function hasTitle(state: GameState, title: Title) {
  return (title.lineage && state.earnedTitles.includes(title.id)) || title.isEarned(state);
}

/** 把当前满足的家声并入记录（只增不减，只授现役家声）；没有新增时返回原 state，免得多余重渲染 */
export function collectEarnedTitles(state: GameState): GameState {
  const fresh = titles.filter((title) => title.lineage && !state.earnedTitles.includes(title.id) && title.isEarned(state)).map((title) => title.id);
  return fresh.length > 0 ? { ...state, earnedTitles: [...state.earnedTitles, ...fresh] } : state;
}

/** 读档白名单：现役家声 ∪ 退役家声（旧誉） */
export function isKeptLineageId(id: string) {
  return titles.some((title) => title.lineage && title.id === id) || (RETIRED_LINEAGE_IDS as string[]).includes(id);
}

export function getTitleStatus(state: GameState) {
  // 只在 6 个本朝称号里找下一块匾
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
        { id: 'incomeBuff', label: '减税招商', detail: `此后 ${INCOME_BUFF_DAYS} 日（约 ${INCOME_BUFF_DAYS} 小时）政务收入 +${INCOME_BUFF_PERCENT}%。` }
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
