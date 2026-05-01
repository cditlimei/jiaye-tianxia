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
    description: '总战力达到 200。',
    rewardGold: 3000,
    isComplete: (_state, context) => context.totalPower >= 200
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

export function getDailyEvent(day: number, dailyIncome: number) {
  if (day % 15 === 0) {
    return {
      title: '门客献策',
      detail: '府中门客进献经营之策，钱粮周转更顺。',
      goldDelta: dailyIncome * 5
    };
  }

  if (day % 10 === 0) {
    return {
      title: '商旅归附',
      detail: '往来商旅愿在府前开市，额外纳入税金。',
      goldDelta: dailyIncome * 3
    };
  }

  if (day % 5 === 0) {
    return {
      title: '乡望渐隆',
      detail: '乡里送来贺礼，家业声势小有增长。',
      goldDelta: dailyIncome * 2
    };
  }

  return null;
}
