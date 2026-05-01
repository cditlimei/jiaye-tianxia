import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { findHomeLevel, findLord, findWeapon, homeLevels, partners } from '../data/gameData';
import type { Partner } from '../data/gameData';
import { getDailyEvent, getQuestStatuses, quests } from '../data/progression';
import { calculateCharisma, calculateIntelligence, calculateTotalPower } from '../lib/battle';
import { clearGameState, defaultGameState, loadGameState, saveGameState } from '../lib/storage';
import type { GameState, Screen } from '../types';

type Action =
  | { type: 'setScreen'; screen: Screen }
  | { type: 'selectLord'; lordId: string }
  | { type: 'collectIncome'; amount: number }
  | { type: 'upgradeHome'; nextLevel: number; cost: number }
  | { type: 'recruitPartner'; partner: Partner }
  | { type: 'equipWeapon'; weaponId: string }
  | { type: 'recordBattle'; win: boolean; rewardGold: number }
  | { type: 'claimQuest'; questId: string }
  | { type: 'toggleSound' }
  | { type: 'completeTutorial' }
  | { type: 'reset' };

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'setScreen':
      return {
        ...state,
        screen: action.screen,
        lastScreen: action.screen === 'battle' ? state.lastScreen : action.screen
      };
    case 'selectLord':
      return {
        ...defaultGameState,
        selectedLordId: action.lordId,
        screen: 'home',
        lastScreen: 'home',
        soundEnabled: state.soundEnabled,
        eventLog: [
          {
            id: `lord-${Date.now()}`,
            day: 1,
            title: '择主立业',
            detail: '乱世基业已定，宅邸经营正式开始。'
          }
        ]
      };
    case 'collectIncome': {
      const nextDay = state.day + 1;
      const dailyEvent = getDailyEvent(nextDay, action.amount);
      const eventLog = dailyEvent
        ? [
            {
              id: `daily-${nextDay}`,
              day: nextDay,
              title: dailyEvent.title,
              detail: dailyEvent.detail,
              goldDelta: dailyEvent.goldDelta
            },
            ...state.eventLog
          ].slice(0, 18)
        : state.eventLog;
      return {
        ...state,
        gold: state.gold + action.amount + (dailyEvent?.goldDelta ?? 0),
        day: nextDay,
        eventLog
      };
    }
    case 'upgradeHome':
      return {
        ...state,
        gold: state.gold - action.cost,
        homeLevel: action.nextLevel,
        eventLog: [
          {
            id: `home-${action.nextLevel}-${Date.now()}`,
            day: state.day,
            title: '宅邸升阶',
            detail: `宅邸已提升至 ${findHomeLevel(action.nextLevel).name}。`
          },
          ...state.eventLog
        ].slice(0, 18)
      };
    case 'recruitPartner':
      if (state.ownedPartnerIds.includes(action.partner.id)) {
        return state;
      }
      return {
        ...state,
        gold: state.gold - action.partner.recruitCost,
        ownedPartnerIds: [...state.ownedPartnerIds, action.partner.id],
        eventLog: [
          {
            id: `partner-${action.partner.id}-${Date.now()}`,
            day: state.day,
            title: '良缘入府',
            detail: `${action.partner.name}已入府辅佐家业。`
          },
          ...state.eventLog
        ].slice(0, 18)
      };
    case 'equipWeapon':
      return {
        ...state,
        equippedWeaponId: action.weaponId,
        eventLog: [
          {
            id: `weapon-${action.weaponId}-${Date.now()}`,
            day: state.day,
            title: '兵器更替',
            detail: `已装备 ${findWeapon(action.weaponId).name}。`
          },
          ...state.eventLog
        ].slice(0, 18)
      };
    case 'recordBattle':
      return {
        ...state,
        gold: action.win ? state.gold + action.rewardGold : state.gold,
        battleWins: action.win ? state.battleWins + 1 : state.battleWins,
        battleLosses: action.win ? state.battleLosses : state.battleLosses + 1,
        eventLog: [
          {
            id: `battle-${Date.now()}`,
            day: state.day,
            title: action.win ? '讨伐得胜' : '整军再战',
            detail: action.win ? `军中缴获 ${action.rewardGold.toLocaleString()} 金。` : '此战未竟，需回府整顿。',
            goldDelta: action.win ? action.rewardGold : undefined
          },
          ...state.eventLog
        ].slice(0, 18)
      };
    case 'claimQuest': {
      if (state.claimedQuestIds.includes(action.questId)) {
        return state;
      }
      const quest = quests.find((item) => item.id === action.questId);
      if (!quest) {
        return state;
      }
      return {
        ...state,
        gold: state.gold + quest.rewardGold,
        claimedQuestIds: [...state.claimedQuestIds, action.questId],
        eventLog: [
          {
            id: `quest-${quest.id}-${Date.now()}`,
            day: state.day,
            title: '目标达成',
            detail: `${quest.title}已领赏。`,
            goldDelta: quest.rewardGold
          },
          ...state.eventLog
        ].slice(0, 18)
      };
    }
    case 'toggleSound':
      return {
        ...state,
        soundEnabled: !state.soundEnabled
      };
    case 'completeTutorial':
      return {
        ...state,
        tutorialDone: true
      };
    case 'reset':
      clearGameState();
      return {
        ...defaultGameState,
        soundEnabled: state.soundEnabled
      };
    default:
      return state;
  }
}

export function useGameState() {
  const [state, dispatch] = useReducer(reducer, undefined, loadGameState);

  useEffect(() => {
    saveGameState(state);
  }, [state]);

  const selectedLord = useMemo(() => findLord(state.selectedLordId), [state.selectedLordId]);
  const equippedWeapon = useMemo(() => findWeapon(state.equippedWeaponId), [state.equippedWeaponId]);
  const currentHome = useMemo(() => findHomeLevel(state.homeLevel), [state.homeLevel]);
  const nextHome = useMemo(() => homeLevels.find((home) => home.level === state.homeLevel + 1) ?? null, [state.homeLevel]);
  const ownedPartners = useMemo(
    () => partners.filter((partner) => state.ownedPartnerIds.includes(partner.id)),
    [state.ownedPartnerIds]
  );

  const totalPower = selectedLord ? calculateTotalPower(selectedLord, ownedPartners, equippedWeapon, currentHome) : 0;
  const intelligence = selectedLord ? calculateIntelligence(selectedLord, ownedPartners) : 0;
  const charisma = selectedLord ? calculateCharisma(selectedLord, ownedPartners) : 0;
  const questStatuses = getQuestStatuses(state, { currentHome, equippedWeapon, ownedPartners, totalPower });

  const collectIncome = useCallback(() => {
    const amount = currentHome.dailyIncome;
    dispatch({ type: 'collectIncome', amount });
    return amount;
  }, [currentHome.dailyIncome]);

  const upgradeHome = useCallback(() => {
    if (!nextHome || state.gold < nextHome.upgradeCost) {
      return false;
    }
    dispatch({ type: 'upgradeHome', nextLevel: nextHome.level, cost: nextHome.upgradeCost });
    return true;
  }, [nextHome, state.gold]);

  const recruitPartner = useCallback(
    (partner: Partner) => {
      if (state.gold < partner.recruitCost || state.ownedPartnerIds.includes(partner.id)) {
        return false;
      }
      dispatch({ type: 'recruitPartner', partner });
      return true;
    },
    [state.gold, state.ownedPartnerIds]
  );

  return {
    state,
    selectedLord,
    equippedWeapon,
    currentHome,
    nextHome,
    ownedPartners,
    totalPower,
    intelligence,
    charisma,
    questStatuses,
    hasSave: Boolean(state.selectedLordId),
    setScreen: (screen: Screen) => dispatch({ type: 'setScreen', screen }),
    selectLord: (lordId: string) => dispatch({ type: 'selectLord', lordId }),
    collectIncome,
    upgradeHome,
    recruitPartner,
    equipWeapon: (weaponId: string) => dispatch({ type: 'equipWeapon', weaponId }),
    recordBattle: (win: boolean, rewardGold: number) => dispatch({ type: 'recordBattle', win, rewardGold }),
    claimQuest: (questId: string) => dispatch({ type: 'claimQuest', questId }),
    toggleSound: () => dispatch({ type: 'toggleSound' }),
    completeTutorial: () => dispatch({ type: 'completeTutorial' }),
    resetGame: () => dispatch({ type: 'reset' })
  };
}
