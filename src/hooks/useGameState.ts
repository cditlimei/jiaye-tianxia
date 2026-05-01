import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { findHomeLevel, findLord, findWeapon, homeLevels, partners } from '../data/gameData';
import type { Partner } from '../data/gameData';
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
  | { type: 'toggleSound' }
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
        soundEnabled: state.soundEnabled
      };
    case 'collectIncome':
      return {
        ...state,
        gold: state.gold + action.amount,
        day: state.day + 1
      };
    case 'upgradeHome':
      return {
        ...state,
        gold: state.gold - action.cost,
        homeLevel: action.nextLevel
      };
    case 'recruitPartner':
      if (state.ownedPartnerIds.includes(action.partner.id)) {
        return state;
      }
      return {
        ...state,
        gold: state.gold - action.partner.recruitCost,
        ownedPartnerIds: [...state.ownedPartnerIds, action.partner.id]
      };
    case 'equipWeapon':
      return {
        ...state,
        equippedWeaponId: action.weaponId
      };
    case 'recordBattle':
      return {
        ...state,
        gold: action.win ? state.gold + action.rewardGold : state.gold,
        battleWins: action.win ? state.battleWins + 1 : state.battleWins,
        battleLosses: action.win ? state.battleLosses : state.battleLosses + 1
      };
    case 'toggleSound':
      return {
        ...state,
        soundEnabled: !state.soundEnabled
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
    hasSave: Boolean(state.selectedLordId),
    setScreen: (screen: Screen) => dispatch({ type: 'setScreen', screen }),
    selectLord: (lordId: string) => dispatch({ type: 'selectLord', lordId }),
    collectIncome,
    upgradeHome,
    recruitPartner,
    equipWeapon: (weaponId: string) => dispatch({ type: 'equipWeapon', weaponId }),
    recordBattle: (win: boolean, rewardGold: number) => dispatch({ type: 'recordBattle', win, rewardGold }),
    toggleSound: () => dispatch({ type: 'toggleSound' }),
    resetGame: () => dispatch({ type: 'reset' })
  };
}

