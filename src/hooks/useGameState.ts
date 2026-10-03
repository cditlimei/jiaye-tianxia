import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { findHomeLevel, findLord, findWeapon, homeLevels, partners } from '../data/gameData';
import type { Partner, Weapon } from '../data/gameData';
import { getDailyEvent, getQuestStatuses, quests } from '../data/progression';
import { calculateCharisma, calculateCourtPower, calculateIntelligence, calculateNavalPower, calculateTotalPower, effectiveDailyIncome, effectiveRecruitCost, recruitDiscountPercent } from '../lib/battle';
import { clearGameState, defaultGameState, GAME_STORAGE_KEY, loadGameState, parseSyncedGameState, readRawGameState, saveGameState } from '../lib/storage';
import type { BattleMode, GameState, Screen } from '../types';

const HEARTBEAT_MS = 15000;

type Action =
  | { type: 'setScreen'; screen: Screen }
  | { type: 'selectLord'; lordId: string }
  | { type: 'selectStarterPartner'; partner: Partner }
  | { type: 'collectIncome'; amount: number }
  | { type: 'upgradeHome'; nextLevel: number; cost: number }
  | { type: 'recruitPartner'; partner: Partner; cost: number }
  | { type: 'equipWeapon'; weaponId: string }
  | { type: 'buyWeapon'; weaponId: string; price: number }
  | { type: 'recordBattle'; win: boolean; rewardGold: number; mode: BattleMode }
  | { type: 'claimQuest'; questId: string }
  | { type: 'toggleSound' }
  | { type: 'completeTutorial' }
  | { type: 'restore'; state: GameState }
  | { type: 'sync'; state: GameState }
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
        screen: 'partnerSelect',
        lastScreen: 'partnerSelect',
        soundEnabled: state.soundEnabled,
        eventLog: [
          {
            id: `lord-${Date.now()}`,
            day: 1,
            title: '择主立业',
            detail: '乱世基业已定，待择良缘共理家业。'
          }
        ]
      };
    case 'selectStarterPartner':
      // 已有伴侣（如另一标签页已选过）时不再免费追加
      if (state.ownedPartnerIds.length > 0) {
        return { ...state, screen: 'home', lastScreen: 'home' };
      }
      return {
        ...state,
        screen: 'home',
        lastScreen: 'home',
        ownedPartnerIds: state.ownedPartnerIds.includes(action.partner.id)
          ? state.ownedPartnerIds
          : [...state.ownedPartnerIds, action.partner.id],
        eventLog: [
          {
            id: `starter-partner-${action.partner.id}-${Date.now()}`,
            day: state.day,
            title: '良缘入府',
            detail: `${action.partner.name}已入府，与主公共创家业。`
          },
          ...state.eventLog
        ].slice(0, 18)
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
        gold: state.gold - action.cost,
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
    case 'buyWeapon':
      if (state.ownedWeaponIds.includes(action.weaponId) || state.gold < action.price) {
        return state;
      }
      return {
        ...state,
        gold: state.gold - action.price,
        ownedWeaponIds: [...state.ownedWeaponIds, action.weaponId],
        equippedWeaponId: action.weaponId,
        eventLog: [
          {
            id: `weapon-buy-${action.weaponId}-${Date.now()}`,
            day: state.day,
            title: '购入兵器',
            detail: `以 ${action.price.toLocaleString()} 金购入 ${findWeapon(action.weaponId).name} 并装备。`,
            goldDelta: -action.price
          },
          ...state.eventLog
        ].slice(0, 18)
      };
    case 'equipWeapon':
      if (!state.ownedWeaponIds.includes(action.weaponId)) {
        return state;
      }
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
        navalWins: action.win && action.mode === 'naval' ? state.navalWins + 1 : state.navalWins,
        courtWins: action.win && action.mode === 'court' ? state.courtWins + 1 : state.courtWins,
        eventLog: [
          {
            id: `battle-${Date.now()}`,
            day: state.day,
            title: action.win ? ({ land: '讨伐得胜', naval: '水战告捷', court: '朝议得胜' } as const)[action.mode] : '整军再战',
            detail: action.win
              ? `${({ land: '军中缴获', naval: '江上缴获', court: '朝廷赏赐' } as const)[action.mode]} ${action.rewardGold.toLocaleString()} 金。`
              : '此战未竟，需回府整顿。',
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
    case 'sync':
      return {
        ...action.state,
        screen: state.screen,
        lastScreen: state.lastScreen
      };
    case 'restore':
      return {
        ...action.state,
        eventLog: [
          {
            id: `restore-${Date.now()}`,
            day: action.state.day,
            title: '存档恢复',
            detail: '已从备份导入本地存档。'
          },
          ...action.state.eventLog
        ].slice(0, 18)
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
  const rawAtLoadRef = useRef<string | null | undefined>(undefined);
  if (rawAtLoadRef.current === undefined) {
    rawAtLoadRef.current = readRawGameState();
  }

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    // 首次落盘前若其他标签页已写入更新的存档，先同步过来，避免用加载时的旧值覆盖
    if (rawAtLoadRef.current !== null) {
      const currentRaw = readRawGameState();
      const changedElsewhere = currentRaw !== rawAtLoadRef.current;
      rawAtLoadRef.current = null;
      const synced = changedElsewhere ? parseSyncedGameState(currentRaw) : null;
      if (synced) {
        dispatch({ type: 'sync', state: synced });
        return;
      }
    }
    saveGameState(state);
  }, [state]);

  // 页面开着时持续刷新存档时间，避免挂机时长在下次打开时被当成离线收益
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        saveGameState(stateRef.current, { force: true });
      }
    }, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, []);

  // 其他标签页写入存档后同步过来，防止互相覆盖进度
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== GAME_STORAGE_KEY) return;
      const synced = parseSyncedGameState(event.newValue);
      if (!synced) return;
      dispatch({ type: 'sync', state: synced });
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const selectedLord = useMemo(() => findLord(state.selectedLordId), [state.selectedLordId]);
  const equippedWeapon = useMemo(() => findWeapon(state.equippedWeaponId), [state.equippedWeaponId]);
  const currentHome = useMemo(() => findHomeLevel(state.homeLevel), [state.homeLevel]);
  const nextHome = useMemo(() => homeLevels.find((home) => home.level === state.homeLevel + 1) ?? null, [state.homeLevel]);
  const ownedPartners = useMemo(
    () => partners.filter((partner) => state.ownedPartnerIds.includes(partner.id)),
    [state.ownedPartnerIds]
  );

  const totalPower = selectedLord ? calculateTotalPower(selectedLord, ownedPartners, equippedWeapon, currentHome) : 0;
  const navalPower = selectedLord ? calculateNavalPower(selectedLord, ownedPartners, currentHome) : 0;
  const courtPower = selectedLord ? calculateCourtPower(selectedLord, ownedPartners, currentHome) : 0;
  const intelligence = selectedLord ? calculateIntelligence(selectedLord, ownedPartners) : 0;
  const charisma = selectedLord ? calculateCharisma(selectedLord, ownedPartners) : 0;
  const questStatuses = getQuestStatuses(state, { currentHome, equippedWeapon, ownedPartners, totalPower });

  const dailyIncome = effectiveDailyIncome(currentHome.dailyIncome, intelligence);
  const recruitDiscount = recruitDiscountPercent(charisma);
  const recruitCostFor = useCallback((partner: Partner) => effectiveRecruitCost(partner.recruitCost, charisma), [charisma]);

  const collectIncome = useCallback(() => {
    dispatch({ type: 'collectIncome', amount: dailyIncome });
    return dailyIncome;
  }, [dailyIncome]);

  const upgradeHome = useCallback(() => {
    if (!nextHome || state.gold < nextHome.upgradeCost) {
      return false;
    }
    dispatch({ type: 'upgradeHome', nextLevel: nextHome.level, cost: nextHome.upgradeCost });
    return true;
  }, [nextHome, state.gold]);

  const recruitPartner = useCallback(
    (partner: Partner) => {
      const cost = recruitCostFor(partner);
      if (state.gold < cost || state.ownedPartnerIds.includes(partner.id)) {
        return false;
      }
      dispatch({ type: 'recruitPartner', partner, cost });
      return true;
    },
    [recruitCostFor, state.gold, state.ownedPartnerIds]
  );

  const buyWeapon = useCallback(
    (weapon: Weapon) => {
      if (state.ownedWeaponIds.includes(weapon.id) || state.gold < weapon.price) {
        return false;
      }
      dispatch({ type: 'buyWeapon', weaponId: weapon.id, price: weapon.price });
      return true;
    },
    [state.gold, state.ownedWeaponIds]
  );

  return {
    state,
    selectedLord,
    equippedWeapon,
    currentHome,
    nextHome,
    ownedPartners,
    totalPower,
    navalPower,
    courtPower,
    intelligence,
    charisma,
    dailyIncome,
    recruitDiscount,
    recruitCostFor,
    questStatuses,
    hasSave: Boolean(state.selectedLordId),
    setScreen: (screen: Screen) => dispatch({ type: 'setScreen', screen }),
    selectLord: (lordId: string) => dispatch({ type: 'selectLord', lordId }),
    selectStarterPartner: (partner: Partner) => dispatch({ type: 'selectStarterPartner', partner }),
    collectIncome,
    upgradeHome,
    recruitPartner,
    buyWeapon,
    equipWeapon: (weaponId: string) => dispatch({ type: 'equipWeapon', weaponId }),
    recordBattle: (win: boolean, rewardGold: number, mode: BattleMode = 'land') => dispatch({ type: 'recordBattle', win, rewardGold, mode }),
    claimQuest: (questId: string) => dispatch({ type: 'claimQuest', questId }),
    toggleSound: () => dispatch({ type: 'toggleSound' }),
    completeTutorial: () => dispatch({ type: 'completeTutorial' }),
    restoreGame: (nextState: GameState) => dispatch({ type: 'restore', state: nextState }),
    resetGame: () => dispatch({ type: 'reset' })
  };
}
