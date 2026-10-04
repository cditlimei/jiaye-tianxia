import type { GameEvent, GameState } from '../types';

export const FRONTIER_UNLOCK_HOME_LEVEL = 4;
export const RAID_INTERVAL_DAYS = 10;
/** 迎战窗口按真实时间算：处理政务再快也烧不掉窗口 */
export const RAID_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RAID_PENALTY_RATE = 0.05;
export const RAID_PENALTY_CAP = 5000;

export interface FrontierRaid {
  startDay: number;
  startedAt: number;
  dueAt: number;
}

type FrontierSlice = Pick<GameState, 'gold' | 'homeLevel' | 'frontierRaid' | 'nextRaidDay'>;

interface FrontierStep {
  frontierRaid: FrontierRaid | null;
  nextRaidDay: number;
  goldDelta: number;
  event: GameEvent | null;
}

export function raidPenalty(gold: number) {
  return Math.min(RAID_PENALTY_CAP, Math.floor(Math.max(0, gold) * RAID_PENALTY_RATE));
}

export function raidRemainingMs(raid: FrontierRaid, now = Date.now()) {
  return Math.max(0, raid.dueAt - now);
}

export function formatRemaining(ms: number) {
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} 小时${minutes > 0 ? ` ${minutes} 分` : ''}` : `${Math.max(1, minutes)} 分钟`;
}

/** 已起的边患逾期未迎战：失守扣金，下一次从当前日起算。 */
export function expireFrontier(state: FrontierSlice, day: number, now = Date.now()): FrontierStep {
  if (state.frontierRaid && now > state.frontierRaid.dueAt) {
    const penalty = raidPenalty(state.gold);
    return {
      frontierRaid: null,
      nextRaidDay: day + RAID_INTERVAL_DAYS,
      goldDelta: -penalty,
      event: {
        id: `raid-lost-${day}-${now}`,
        day,
        title: '边患失守',
        detail: `北疆胡骑劫掠边郡，无人迎战，损失 ${penalty.toLocaleString()} 金。`,
        goldDelta: -penalty
      }
    };
  }
  return { frontierRaid: state.frontierRaid, nextRaidDay: state.nextRaidDay, goldDelta: 0, event: null };
}

/** 在线推进到第 day 日：先结算逾期，再看是否起新边患（离线不起新边患）。 */
export function advanceFrontier(state: FrontierSlice, day: number, now = Date.now()): FrontierStep {
  const expired = expireFrontier(state, day, now);
  if (expired.event) {
    return expired;
  }

  if (!state.frontierRaid && state.homeLevel >= FRONTIER_UNLOCK_HOME_LEVEL && day >= state.nextRaidDay) {
    return {
      frontierRaid: { startDay: day, startedAt: now, dueAt: now + RAID_WINDOW_MS },
      nextRaidDay: state.nextRaidDay,
      goldDelta: 0,
      event: {
        id: `raid-start-${day}`,
        day,
        title: '北疆边患',
        detail: `烽燧狼烟骤起，胡骑犯边。${formatRemaining(RAID_WINDOW_MS)}内须出关迎战，否则边郡失守。`
      }
    };
  }

  return { frontierRaid: state.frontierRaid, nextRaidDay: state.nextRaidDay, goldDelta: 0, event: null };
}
