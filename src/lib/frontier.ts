import type { GameEvent, GameState } from '../types';

export const FRONTIER_UNLOCK_HOME_LEVEL = 4;
export const RAID_INTERVAL_DAYS = 10;
export const RAID_WINDOW_DAYS = 3;
export const RAID_PENALTY_RATE = 0.05;
export const RAID_PENALTY_CAP = 5000;

export interface FrontierRaid {
  startDay: number;
  dueDay: number;
}

type FrontierSlice = Pick<GameState, 'gold' | 'homeLevel' | 'frontierRaid' | 'nextRaidDay'>;

export function raidPenalty(gold: number) {
  return Math.min(RAID_PENALTY_CAP, Math.floor(Math.max(0, gold) * RAID_PENALTY_RATE));
}

/** 推进到第 day 日时北疆的变化：逾期未迎战则失守扣金，到期则起新边患。 */
export function advanceFrontier(state: FrontierSlice, day: number): { frontierRaid: FrontierRaid | null; nextRaidDay: number; goldDelta: number; event: GameEvent | null } {
  if (state.frontierRaid && day > state.frontierRaid.dueDay) {
    const penalty = raidPenalty(state.gold);
    return {
      frontierRaid: null,
      nextRaidDay: day + RAID_INTERVAL_DAYS,
      goldDelta: -penalty,
      event: {
        id: `raid-lost-${day}`,
        day,
        title: '边患失守',
        detail: `北疆胡骑劫掠边郡，无人迎战，损失 ${penalty.toLocaleString()} 金。`,
        goldDelta: -penalty
      }
    };
  }

  if (!state.frontierRaid && state.homeLevel >= FRONTIER_UNLOCK_HOME_LEVEL && day >= state.nextRaidDay) {
    const dueDay = day + RAID_WINDOW_DAYS;
    return {
      frontierRaid: { startDay: day, dueDay },
      nextRaidDay: state.nextRaidDay,
      goldDelta: 0,
      event: {
        id: `raid-start-${day}`,
        day,
        title: '北疆边患',
        detail: `烽燧狼烟骤起，胡骑犯边。第 ${dueDay} 日前须出关迎战，否则边郡失守。`
      }
    };
  }

  return { frontierRaid: state.frontierRaid, nextRaidDay: state.nextRaidDay, goldDelta: 0, event: null };
}
