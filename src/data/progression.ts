import type { HomeLevel, Partner, Weapon } from './gameData';
import type { GameState } from '../types';

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
    id: 'three-partners',
    title: '内府成势',
    description: '招募三位伴侣。',
    rewardGold: 2500,
    isComplete: (state) => state.ownedPartnerIds.length >= 3
  }
];

export function getQuestStatuses(state: GameState, context: QuestContext): QuestStatus[] {
  return quests.map((quest) => ({
    ...quest,
    complete: quest.isComplete(state, context),
    claimed: state.claimedQuestIds.includes(quest.id)
  }));
}

export interface ChoiceOption {
  id: 'gold' | 'incomeBuff' | 'battleBonus';
  label: string;
  detail: string;
}

export interface ChoiceEvent {
  id: 'merchants' | 'advisor';
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

/** 二选一里「拿现钱」那一项的金额，离线无人决断时按此自动结算 */
export function choiceGoldValue(event: ChoiceEvent, dailyIncome: number) {
  return event.id === 'advisor' ? dailyIncome * 5 : dailyIncome * 3;
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
