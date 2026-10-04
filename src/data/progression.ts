import type { HomeLevel, Partner, Weapon } from './gameData';
import type { GameState } from '../types';
import { findPartnerEvent } from './partnerEvents';

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
    description: '总战力达到 180。',
    rewardGold: 3000,
    isComplete: (_state, context) => context.totalPower >= 180
  },
  {
    id: 'naval-first-win',
    title: '江东扬帆',
    description: '在江东赢得一场水战。',
    rewardGold: 2000,
    isComplete: (state) => state.navalWins >= 1
  },
  {
    id: 'court-first-win',
    title: '名动许都',
    description: '在许都赢得一场朝议。',
    rewardGold: 3000,
    isComplete: (state) => state.courtWins >= 1
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
    isComplete: (state) => Object.keys(state.resolvedPartnerEvents).length >= 1
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
}

// 称号按先后排列，取已达成的最后一个；全部由存档算出，不单独存
export const titles: Title[] = [
  { id: 'commoner', name: '白身', requirement: '', isEarned: () => true },
  { id: 'gentry', name: '乡绅', requirement: '宅邸升至砖瓦宅', isEarned: (s) => s.homeLevel >= 3 },
  { id: 'warlord', name: '一方豪强', requirement: '累计 10 场胜利', isEarned: (s) => s.battleWins >= 10 },
  { id: 'magnate', name: '府邸之主', requirement: '宅邸升至府邸', isEarned: (s) => s.homeLevel >= 4 },
  { id: 'river-tiger', name: '江表虎臣', requirement: '赢得 5 场水战', isEarned: (s) => s.navalWins >= 5 },
  { id: 'court-star', name: '朝堂新贵', requirement: '赢得 5 场朝议', isEarned: (s) => s.courtWins >= 5 },
  { id: 'north-general', name: '镇北将军', requirement: '击退 3 次边患', isEarned: (s) => s.frontierWins >= 3 },
  { id: 'granary', name: '坐拥沃野', requirement: '屯田升至沃野千里', isEarned: (s) => s.farmLevel >= 5 },
  { id: 'harmony', name: '内府和睦', requirement: '了却 5 位伴侣的心事', isEarned: (s) => Object.keys(s.resolvedPartnerEvents).length >= 5 },
  { id: 'hegemon', name: '一代枭雄', requirement: '宅邸王城且累计 30 场胜利', isEarned: (s) => s.homeLevel >= 6 && s.battleWins >= 30 },
  { id: 'founder', name: '开国元勋', requirement: '完成一次传位', isEarned: (s) => s.generation >= 2 },
  { id: 'eternal', name: '千秋家业', requirement: '家业点累计 10 点', isEarned: (s) => s.legacyPoints >= 10 }
];

export function getTitleStatus(state: GameState) {
  let current = titles[0];
  let next: Title | null = null;
  for (const title of titles) {
    if (title.isEarned(state)) {
      current = title;
    } else if (!next) {
      next = title;
    }
  }
  return { current, next };
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

export const INCOME_BUFF_PERCENT = 20;
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
  return getChoiceEvent(pending.day, pending.dailyIncome);
}

/** 二选一里「拿现钱」那一项的金额，离线无人决断时按此自动结算 */
export function choiceGoldValue(event: ChoiceEvent, dailyIncome: number) {
  return event.id === 'advisor' ? dailyIncome * 5 : event.id === 'merchants' ? dailyIncome * 3 : 0;
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
