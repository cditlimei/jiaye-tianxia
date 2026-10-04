import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { farmLevels, findFarmLevel, findHomeLevel, findLord, findWeapon, homeLevels, partners } from '../data/gameData';
import type { Partner, Weapon } from '../data/gameData';
import { BATTLE_BONUS_MULTIPLIER, choiceGoldValue, getChoiceEvent, getDailyEvent, getQuestStatuses, getTitleStatus, INCOME_BUFF_DAYS, INCOME_BUFF_PERCENT, quests } from '../data/progression';
import { calculateCharisma, calculateCourtPower, calculateIntelligence, calculateNavalPower, LEGACY_MAX_POINTS, legacyIncomeMultiplier, legacyPointsFor, SUCCESSION_HOME_LEVEL, calculateTotalPower, effectiveDailyIncome, effectiveRecruitCost, recruitDiscountPercent } from '../lib/battle';
import { clearGameState, defaultGameState, GAME_STORAGE_KEY, loadGameState, parseSyncedGameState, readRawGameState, saveGameState } from '../lib/storage';
import type { BattleMode, GameState, Screen } from '../types';
import { advanceFrontier, RAID_INTERVAL_DAYS, raidPenalty } from '../lib/frontier';

const HEARTBEAT_MS = 15000;

type Action =
  | { type: 'setScreen'; screen: Screen }
  | { type: 'selectLord'; lordId: string }
  | { type: 'selectStarterPartner'; partner: Partner }
  | { type: 'collectIncome'; amount: number }
  | { type: 'upgradeHome'; nextLevel: number; cost: number }
  | { type: 'upgradeFarm'; nextLevel: number; cost: number }
  | { type: 'recruitPartner'; partner: Partner; cost: number }
  | { type: 'equipWeapon'; weaponId: string }
  | { type: 'buyWeapon'; weaponId: string; price: number }
  | { type: 'recordBattle'; win: boolean; rewardGold: number; mode: BattleMode; retreat?: boolean }
  | { type: 'claimQuest'; questId: string }
  | { type: 'toggleSound' }
  | { type: 'completeTutorial' }
  | { type: 'restore'; state: GameState }
  | { type: 'succeed' }
  | { type: 'resolveChoice'; optionId: 'gold' | 'incomeBuff' | 'battleBonus' }
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
        generation: state.generation,
        legacyPoints: state.legacyPoints,
        eventLog: [
          {
            id: `lord-${Date.now()}`,
            day: 1,
            title: state.generation > 1 ? `第 ${state.generation} 代择主` : '择主立业',
            detail: state.generation > 1
              ? `先祖家业点 ${state.legacyPoints}，收入 +${Math.round((legacyIncomeMultiplier(state.legacyPoints) - 1) * 100)}%。`
              : '乱世基业已定，待择良缘共理家业。'
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
      // 减税招商：政务收入加成
      const buffed = state.incomeBuff && nextDay <= state.incomeBuff.untilDay
        ? Math.round(action.amount * (1 + state.incomeBuff.percent / 100))
        : action.amount;
      const incomeBuff = state.incomeBuff && nextDay <= state.incomeBuff.untilDay ? state.incomeBuff : null;
      const choice = getChoiceEvent(nextDay, action.amount);
      // 上一个二选一还没决断又来新的：旧的按「拿现钱」自动结算
      const staleChoice = choice && state.pendingChoice ? getChoiceEvent(state.pendingChoice.day, state.pendingChoice.dailyIncome) : null;
      const staleGold = staleChoice ? choiceGoldValue(staleChoice, state.pendingChoice!.dailyIncome) : 0;
      const pendingChoice = choice ? { eventId: choice.id, day: nextDay, dailyIncome: action.amount } : state.pendingChoice;
      const goldAfterIncome = state.gold + buffed + (dailyEvent?.goldDelta ?? 0) + staleGold;
      const frontier = advanceFrontier({ ...state, gold: goldAfterIncome }, nextDay);
      const eventLog = [
        ...(frontier.event ? [frontier.event] : []),
        ...(choice ? [{ id: `choice-${nextDay}`, day: nextDay, title: choice.title, detail: `${choice.prompt} 请在主城决断。` }] : []),
        ...(staleChoice ? [{ id: `choice-auto-${state.pendingChoice!.day}`, day: nextDay, title: `${staleChoice.title}（自动）`, detail: '未及决断，按现钱入账。', goldDelta: staleGold }] : []),
        ...(dailyEvent
          ? [{ id: `daily-${nextDay}`, day: nextDay, title: dailyEvent.title, detail: dailyEvent.detail, goldDelta: dailyEvent.goldDelta }]
          : []),
        ...state.eventLog
      ].slice(0, 18);
      return {
        ...state,
        gold: goldAfterIncome + frontier.goldDelta,
        day: nextDay,
        frontierRaid: frontier.frontierRaid,
        nextRaidDay: frontier.nextRaidDay,
        incomeBuff,
        pendingChoice,
        eventLog
      };
    }
    case 'resolveChoice': {
      if (!state.pendingChoice) return state;
      const event = getChoiceEvent(state.pendingChoice.day, state.pendingChoice.dailyIncome);
      if (!event) return { ...state, pendingChoice: null };
      const option = event.options.find((item) => item.id === action.optionId) ?? event.options[0];
      const gold = option.id === 'gold' ? choiceGoldValue(event, state.pendingChoice.dailyIncome) : 0;
      return {
        ...state,
        pendingChoice: null,
        gold: state.gold + gold,
        incomeBuff: option.id === 'incomeBuff' ? { percent: INCOME_BUFF_PERCENT, untilDay: state.day + INCOME_BUFF_DAYS } : state.incomeBuff,
        nextBattleBonus: option.id === 'battleBonus' ? BATTLE_BONUS_MULTIPLIER : state.nextBattleBonus,
        eventLog: [
          { id: `choice-${state.pendingChoice.day}-${option.id}`, day: state.day, title: `${event.title} · ${option.label}`, detail: option.detail, goldDelta: gold || undefined },
          ...state.eventLog
        ].slice(0, 18)
      };
    }
    case 'upgradeFarm':
      if (state.gold < action.cost || action.nextLevel !== state.farmLevel + 1) {
        return state;
      }
      return {
        ...state,
        gold: state.gold - action.cost,
        farmLevel: action.nextLevel,
        eventLog: [
          {
            id: `farm-${action.nextLevel}-${Date.now()}`,
            day: state.day,
            title: '西蜀屯田',
            detail: `投入 ${action.cost.toLocaleString()} 金，屯田升至「${findFarmLevel(action.nextLevel).name}」，每日多收 ${findFarmLevel(action.nextLevel).dailyIncome} 金。`,
            goldDelta: -action.cost
          },
          ...state.eventLog
        ].slice(0, 18)
      };
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
    case 'recordBattle': {
      // 北疆：胜则靖边 +1、边患解除并排下一次；败则失守立刻扣金；退守关内不扣金、边患保留，24 小时内可再战
      const bonus = action.win && state.nextBattleBonus ? state.nextBattleBonus : 1;
      const rewardGold = Math.round(action.rewardGold * bonus);
      const frontierSettled = action.mode === 'frontier' && !action.retreat;
      const frontierPenalty = frontierSettled && !action.win && state.frontierRaid ? raidPenalty(state.gold) : 0;
      const frontierPatch = frontierSettled
        ? { frontierRaid: null, nextRaidDay: state.day + RAID_INTERVAL_DAYS, frontierWins: action.win ? state.frontierWins + 1 : state.frontierWins }
        : {};
      return {
        ...state,
        ...frontierPatch,
        gold: (action.win ? state.gold + rewardGold : state.gold) - frontierPenalty,
        nextBattleBonus: action.win && state.nextBattleBonus ? null : state.nextBattleBonus,
        battleWins: action.win ? state.battleWins + 1 : state.battleWins,
        battleLosses: action.win ? state.battleLosses : state.battleLosses + 1,
        navalWins: action.win && action.mode === 'naval' ? state.navalWins + 1 : state.navalWins,
        courtWins: action.win && action.mode === 'court' ? state.courtWins + 1 : state.courtWins,
        eventLog: [
          {
            id: `battle-${Date.now()}`,
            day: state.day,
            title: action.win ? ({ land: '讨伐得胜', naval: '水战告捷', court: '朝议得胜', frontier: '靖边得胜' } as const)[action.mode] : frontierSettled ? '边患失守' : '整军再战',
            detail: action.win
              ? `${({ land: '军中缴获', naval: '江上缴获', court: '朝廷赏赐', frontier: '边军缴获' } as const)[action.mode]} ${rewardGold.toLocaleString()} 金${bonus > 1 ? '（练兵之策翻倍）' : ''}。`
              : frontierSettled ? `迎战失利，边郡遭劫，损失 ${frontierPenalty.toLocaleString()} 金。` : action.mode === 'frontier' ? '退守关内，边患未解，须尽快再战。' : '此战未竟，需回府整顿。',
            goldDelta: action.win ? rewardGold : frontierPenalty > 0 ? -frontierPenalty : undefined,
          },
          ...state.eventLog
        ].slice(0, 18)
      };
    }
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
    case 'succeed': {
      const gained = legacyPointsFor(state.gold);
      if (state.homeLevel < SUCCESSION_HOME_LEVEL || gained < 1) {
        return state;
      }
      const legacyPoints = Math.min(LEGACY_MAX_POINTS, state.legacyPoints + gained);
      return {
        ...defaultGameState,
        screen: 'lordSelect',
        lastScreen: 'lordSelect',
        soundEnabled: state.soundEnabled,
        generation: state.generation + 1,
        legacyPoints,
        eventLog: [
          {
            id: `succeed-${Date.now()}`,
            day: 1,
            title: '传位',
            detail: `第 ${state.generation} 代以 ${state.gold.toLocaleString()} 金传下家业，获家业点 ${gained}，累计 ${legacyPoints}。`
          }
        ]
      };
    }
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
  const titleStatus = useMemo(() => getTitleStatus(state), [state]);

  const currentFarm = useMemo(() => findFarmLevel(state.farmLevel), [state.farmLevel]);
  const nextFarm = useMemo(() => farmLevels.find((farm) => farm.level === state.farmLevel + 1) ?? null, [state.farmLevel]);
  const dailyIncome = effectiveDailyIncome(Math.round((currentHome.dailyIncome + currentFarm.dailyIncome) * legacyIncomeMultiplier(state.legacyPoints)), intelligence);
  const buffActive = Boolean(state.incomeBuff && state.day + 1 <= state.incomeBuff.untilDay);
  const displayedIncome = buffActive && state.incomeBuff ? Math.round(dailyIncome * (1 + state.incomeBuff.percent / 100)) : dailyIncome;
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

  const upgradeFarm = useCallback(() => {
    if (!nextFarm || state.gold < nextFarm.cost) {
      return false;
    }
    dispatch({ type: 'upgradeFarm', nextLevel: nextFarm.level, cost: nextFarm.cost });
    return true;
  }, [nextFarm, state.gold]);

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
    currentFarm,
    nextFarm,
    ownedPartners,
    totalPower,
    navalPower,
    courtPower,
    intelligence,
    charisma,
    dailyIncome: displayedIncome,
    buffActive,
    recruitDiscount,
    recruitCostFor,
    questStatuses,
    titleStatus,
    hasSave: Boolean(state.selectedLordId),
    setScreen: (screen: Screen) => dispatch({ type: 'setScreen', screen }),
    selectLord: (lordId: string) => dispatch({ type: 'selectLord', lordId }),
    selectStarterPartner: (partner: Partner) => dispatch({ type: 'selectStarterPartner', partner }),
    collectIncome,
    upgradeHome,
    recruitPartner,
    buyWeapon,
    upgradeFarm,
    equipWeapon: (weaponId: string) => dispatch({ type: 'equipWeapon', weaponId }),
    recordBattle: (win: boolean, rewardGold: number, mode: BattleMode = 'land', retreat = false) => dispatch({ type: 'recordBattle', win, rewardGold, mode, retreat }),
    claimQuest: (questId: string) => dispatch({ type: 'claimQuest', questId }),
    toggleSound: () => dispatch({ type: 'toggleSound' }),
    completeTutorial: () => dispatch({ type: 'completeTutorial' }),
    restoreGame: (nextState: GameState) => dispatch({ type: 'restore', state: nextState }),
    succeed: () => dispatch({ type: 'succeed' }),
    resolveChoice: (optionId: 'gold' | 'incomeBuff' | 'battleBonus') => dispatch({ type: 'resolveChoice', optionId }),
    resetGame: () => dispatch({ type: 'reset' })
  };
}
