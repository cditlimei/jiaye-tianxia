import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { farmLevels, findFarmLevel, findHomeLevel, findLord, findWeapon, homeLevels, partners } from '../data/gameData';
import type { Partner, Weapon } from '../data/gameData';
import { findPartnerEvent, isPartnerEventDay, mergePartnerBoost, nextPartnerForEvent, partnerIdOfKey } from '../data/partnerEvents';
import { HOME_UNLOCKS, BATTLE_BONUS_MULTIPLIER, choiceGoldValue, collectEarnedTitles, getChoiceEvent, getDailyEvent, getQuestStatuses, getTitleStatus, resolvePendingEvent, INCOME_BUFF_DAYS, INCOME_BUFF_PERCENT, quests } from '../data/progression';
import { weaponBonusForLord, LEGACY_MAX_POINTS, LEGACY_START_GOLD_PER_POINT, SUCCESSION_HOME_LEVEL, calculateCharisma, calculateCourtPower, calculateIntelligence, calculateNavalPower, calculateTotalPower, effectiveDailyIncome, effectiveRecruitCost, legacyIncomeMultiplier, legacyPointsFor, recruitDiscountPercent, totalDailyIncome } from '../lib/battle';
import { clearGameState, defaultGameState, GAME_STORAGE_KEY, loadGameState, parseSyncedGameState, readRawGameState, saveGameState } from '../lib/storage';
import type { BattleMode, GameState, Screen } from '../types';
import { isOrderDay } from '../types';
import { AMBITION_REWARD_GOLD, ambitionStatus, findAmbition, ownedFiefCountOf, trimChronicle, type AmbitionId } from '../data/ambitions';
import { bountyScale, DYNASTY_START_GOLD, dynastyCount, dynastySummary, findRealm, isEndingReached, realmFarmCost, realmIncomePercent, realmRewardScale, realmStatBonus, type RealmId } from '../data/dynasty';
import { minorEventFor, minorGoldValue, MINOR_BOOST_AMOUNT, parseMinorKey } from '../data/minorEvents';
import { fiefCostFor, legacyGoldPerPointFor, policyChangeCostFor, traditionOf } from '../data/traditions';
import { FIEF_INCOME_PERCENT, fiefIncomePercent, fiefStatBonus, findFief, findFiefPolicy, nextFief, orderCapFor, type FiefPolicyId } from '../data/fiefs';
import { advanceFrontier, FRONTIER_UNLOCK_HOME_LEVEL, RAID_INTERVAL_DAYS, raidPenalty } from '../lib/frontier';

const HEARTBEAT_MS = 15000;

type Action =
  | { type: 'setScreen'; screen: Screen }
  | { type: 'selectLord'; lordId: string }
  | { type: 'selectStarterPartner'; partner: Partner }
  | { type: 'collectIncome'; amount: number }
  | { type: 'upgradeHome'; nextLevel: number; cost: number }
  | { type: 'upgradeFarm'; nextLevel: number; cost: number }
  | { type: 'claimFief'; fiefId: string; policyId: FiefPolicyId; cost: number }
  | { type: 'chooseAmbition'; ambitionId: AmbitionId }
  | { type: 'foundDynasty'; realm: RealmId }
  | { type: 'restart' }
  | { type: 'setFiefPolicy'; fiefId: string; policyId: FiefPolicyId; cost: number }
  | { type: 'recruitPartner'; partner: Partner; cost: number }
  | { type: 'equipWeapon'; weaponId: string }
  | { type: 'buyWeapon'; weaponId: string; price: number }
  | { type: 'recordBattle'; win: boolean; rewardGold: number; mode: BattleMode; retreat?: boolean; lossGold?: number; doudizhu?: boolean }
  | { type: 'claimQuest'; questId: string }
  | { type: 'toggleSound' }
  | { type: 'completeTutorial' }
  | { type: 'restore'; state: GameState }
  | { type: 'succeed' }
  | { type: 'startBattle'; mode: BattleMode; lossGold: number; rewardGold?: number; odds?: number; doudizhu?: boolean }
  | { type: 'updateActiveBattle'; multiplier: number; share: number }
  | { type: 'resolveChoice'; optionId: string }
  | { type: 'sync'; state: GameState }
  | { type: 'reset' };

/** 屯田与封地随家业传下，对应的「第一次」任务下一代不再重领 */
function inheritedQuestIds(farmLevel: number, fiefs: GameState['fiefs']) {
  return [...(farmLevel > 0 ? ['farm-first'] : []), ...(Object.keys(fiefs).length > 0 ? ['fief-first'] : [])];
}

function addBoost(current: GameState['partnerBoosts'][string] | undefined, extra: GameState['partnerBoosts'][string]) {
  const sum = (k: 'strength' | 'intelligence' | 'charisma') => (current?.[k] ?? 0) + (extra[k] ?? 0) || undefined;
  return { strength: sum('strength'), intelligence: sum('intelligence'), charisma: sum('charisma') };
}

function findPartnerName(partnerId: string) {
  return partners.find((item) => item.id === partnerId)?.name ?? '';
}

/** 每次状态更新后把当前满足的家声并入 earnedTitles（只增不减），开新朝重置世代/封地也不收回 */
function reducer(state: GameState, action: Action): GameState {
  return collectEarnedTitles(baseReducer(state, action));
}

/** 军令 +1 类选项：已满时不增加，纪事改写，免得写着 +1 实际没加 */
function orderGainDetail(state: GameState, detail: string) {
  return state.orders >= orderCapFor(state.fiefs, state.realms) ? detail.replace('军令 +1', '军令已满，未增加') : detail;
}

function baseReducer(state: GameState, action: Action): GameState {
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
        tutorialDone: state.generation > 1 || state.tutorialDone,
        gold: defaultGameState.gold + state.legacyPoints * LEGACY_START_GOLD_PER_POINT + (state.generation > 1 && state.chronicle[state.chronicle.length - 1]?.ambitionDone ? AMBITION_REWARD_GOLD : 0) + (state.generation === 1 ? dynastyCount(state.realms) * DYNASTY_START_GOLD : 0),
        chronicle: state.chronicle,
        realm: state.realm,
        realms: state.realms,
        pastDynasties: state.pastDynasties,
        earnedTitles: collectEarnedTitles(state).earnedTitles,
        ambition: null,
        // 强兵家风：每代开局军令满额（上限按传下来的封地算，含整军加成）
        orders: traditionOf(state.chronicle)?.id === 'might' ? orderCapFor(state.generation > 1 ? state.fiefs : {}, state.realms) : defaultGameState.orders,
        generation: state.generation,
        legacyPoints: state.legacyPoints,
        farmLevel: state.generation > 1 ? state.farmLevel : defaultGameState.farmLevel,
        fiefs: state.generation > 1 ? state.fiefs : defaultGameState.fiefs,
        claimedQuestIds: state.generation > 1 ? inheritedQuestIds(state.farmLevel, state.fiefs) : [],
        eventLog: [
          {
            id: `lord-${Date.now()}`,
            day: 1,
            title: state.generation > 1 ? `第 ${state.generation} 代择主` : dynastyCount(state.realms) > 0 ? `第 ${dynastyCount(state.realms) + 1} 朝开国` : '择主立业',
            detail: state.generation > 1
              ? `先祖家业点 ${state.legacyPoints}，收入 +${Math.round((legacyIncomeMultiplier(state.legacyPoints) - 1) * 100)}%${state.chronicle[state.chronicle.length - 1]?.ambitionDone ? `；上一代志向达成，开局多得 ${AMBITION_REWARD_GOLD.toLocaleString()} 金` : ''}。${state.legacyPoints >= LEGACY_MAX_POINTS ? '家业点已满，本代专心封郡、升王城，即可天下归心。' : '请在主城定下本代志向。'}`
              : dynastyCount(state.realms) > 0
                ? `新朝开国。历朝国号加成：${(['wei', 'shu', 'wu'] as const).filter((id) => state.realms[id] > 0).map((id) => `${findRealm(id)!.name}×${state.realms[id]}`).join('、')}；开局多得 ${(dynastyCount(state.realms) * DYNASTY_START_GOLD).toLocaleString()} 金。`
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
      const buffExpired = Boolean(state.incomeBuff) && !incomeBuff;
      const calendarChoice = getChoiceEvent(nextDay, action.amount);
      // 伴侣心事日：轮到一位还没了却心事的伴侣（没有待决事件时才起）
      const partnerDue = !calendarChoice && !state.pendingChoice && isPartnerEventDay(nextDay) ? nextPartnerForEvent(state.ownedPartnerIds, state.resolvedPartnerEvents) : null;
      const partnerChoice = partnerDue ? findPartnerEvent(partnerDue) : null;
      // 府中小事：每 30 日轮一位伴侣，日历事件与心事都不在时才起
      const minor = !calendarChoice && !partnerChoice && !state.pendingChoice ? minorEventFor(nextDay, state.ownedPartnerIds) : null;
      const minorPartner = minor ? findPartnerName(minor.partnerId) : '';
      const choice = calendarChoice ?? (partnerChoice ? { id: `partner:${partnerDue}`, title: partnerChoice.title, prompt: partnerChoice.prompt } : minor ? { id: minor.key, title: minor.template.title, prompt: minor.template.prompt(minorPartner) } : null);
      // 上一个二选一还没决断又来新的：旧的按「拿现钱」自动结算（伴侣心事无现钱，按第一项处理在 resolve 里不做，此处直接作废）
      const staleChoice = choice && state.pendingChoice ? resolvePendingEvent(state.pendingChoice) : null;
      const staleGold = staleChoice ? choiceGoldValue(staleChoice, state.pendingChoice!.dailyIncome) : 0;
      const pendingChoice = choice ? { eventId: choice.id, day: nextDay, dailyIncome: action.amount } : state.pendingChoice;
      const goldAfterIncome = state.gold + buffed + (dailyEvent?.goldDelta ?? 0) + staleGold;
      const frontier = advanceFrontier({ ...state, gold: goldAfterIncome }, nextDay);
      const eventLog = [
        ...(frontier.event ? [frontier.event] : []),
        ...(choice ? [{ id: `choice-${nextDay}`, day: nextDay, title: choice.title, detail: `${choice.prompt} 请在主城决断。` }] : []),
        ...(buffExpired ? [{ id: `buff-end-${nextDay}`, day: nextDay, title: '减税招商到期', detail: '十日之期已满，政务收入恢复常例。' }] : []),
        ...(staleChoice && staleChoice.id.startsWith('partner:') ? [{ id: `choice-skip-${state.pendingChoice!.day}`, day: nextDay, title: `${staleChoice.title}（搁置）`, detail: '心事未及回应，她不再提起。' }] : []),
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
        orders: isOrderDay(nextDay, state.homeLevel) ? Math.min(orderCapFor(state.fiefs, state.realms), state.orders + 1) : state.orders,
        incomeBuff,
        pendingChoice,
        eventLog
      };
    }
    case 'resolveChoice': {
      if (!state.pendingChoice) return state;
      const event = resolvePendingEvent(state.pendingChoice);
      if (!event) return { ...state, pendingChoice: null };
      if (event.id.startsWith('partner:')) {
        const eventKey = event.id.slice('partner:'.length);
        const partnerId = partnerIdOfKey(eventKey);
        const partnerEvent = findPartnerEvent(eventKey);
        const chosen = partnerEvent?.options.find((item) => item.id === action.optionId) ?? partnerEvent?.options[0];
        if (!partnerEvent || !chosen) return { ...state, pendingChoice: null };
        return {
          ...state,
          pendingChoice: null,
          // 两段心事的加成累加
          partnerBoosts: { ...state.partnerBoosts, [partnerId]: addBoost(state.partnerBoosts[partnerId], chosen.boost) },
          resolvedPartnerEvents: { ...state.resolvedPartnerEvents, [eventKey]: chosen.id },
          eventLog: [
            { id: `partner-event-${eventKey}`, day: state.day, title: `${partnerEvent.title} · ${chosen.label}`, detail: chosen.detail },
            ...state.eventLog
          ].slice(0, 18)
        };
      }
      if (event.id.startsWith('minor:')) {
        const minor = parseMinorKey(event.id.slice('minor:'.length));
        if (!minor) return { ...state, pendingChoice: null };
        const picked = action.optionId === 'b' ? minor.template.options[1] : minor.template.options[0];
        const gold = picked.kind === 'gold' ? minorGoldValue(state.pendingChoice.dailyIncome) : 0;
        const boost = picked.kind === 'boost' && picked.stat ? { [picked.stat]: MINOR_BOOST_AMOUNT } : {};
        return {
          ...state,
          pendingChoice: null,
          gold: state.gold + gold,
          orders: picked.kind === 'order' ? Math.min(orderCapFor(state.fiefs, state.realms), state.orders + 1) : state.orders,
          partnerBoosts: picked.kind === 'boost' ? { ...state.partnerBoosts, [minor.partner.id]: addBoost(state.partnerBoosts[minor.partner.id], boost) } : state.partnerBoosts,
          eventLog: [
            { id: `minor-${state.pendingChoice.day}`, day: state.day, title: `${minor.partner.name} · ${minor.template.title} · ${picked.label}`, detail: picked.kind === 'order' ? orderGainDetail(state, picked.detail(minor.partner.name, gold)) : picked.detail(minor.partner.name, gold), goldDelta: gold || undefined },
            ...state.eventLog
          ].slice(0, 18)
        };
      }
      const option = event.options.find((item) => item.id === action.optionId) ?? event.options[0];
      const gold = option.id === 'gold' ? choiceGoldValue(event, state.pendingChoice.dailyIncome) : 0;
      return {
        ...state,
        pendingChoice: null,
        gold: state.gold + gold,
        incomeBuff: option.id === 'incomeBuff' ? { percent: INCOME_BUFF_PERCENT, untilDay: state.day + INCOME_BUFF_DAYS } : state.incomeBuff,
        nextBattleBonus: option.id === 'battleBonus' ? BATTLE_BONUS_MULTIPLIER : state.nextBattleBonus,
        orders: option.id === 'order' ? Math.min(orderCapFor(state.fiefs, state.realms), state.orders + 1) : state.orders,
        eventLog: [
          { id: `choice-${state.pendingChoice.day}-${option.id}`, day: state.day, title: `${event.title} · ${option.label}`, detail: option.id === 'order' ? orderGainDetail(state, option.detail) : option.detail, goldDelta: gold || undefined },
          ...state.eventLog
        ].slice(0, 18)
      };
    }
    case 'upgradeFarm':
      if (state.gold < action.cost || action.nextLevel !== state.farmLevel + 1 || action.cost !== realmFarmCost(state.realms, findFarmLevel(action.nextLevel).cost)) {
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
            detail: `投入 ${action.cost.toLocaleString()} 金，屯田升至「${findFarmLevel(action.nextLevel).name}」，政务收入 +${findFarmLevel(action.nextLevel).flatIncome} 金且 +${findFarmLevel(action.nextLevel).incomePercent}%。`,
            goldDelta: -action.cost
          },
          ...state.eventLog
        ].slice(0, 18)
      };
    case 'claimFief': {
      const fief = findFief(action.fiefId);
      const policy = findFiefPolicy(action.policyId);
      // 只能按顺序开拓下一郡，钱要够
      if (!fief || !policy || nextFief(state.fiefs)?.id !== fief.id || state.gold < action.cost || action.cost !== fiefCostFor(state, fief)) {
        return state;
      }
      return {
        ...state,
        gold: state.gold - action.cost,
        fiefs: { ...state.fiefs, [fief.id]: policy.id },
        eventLog: [
          {
            id: `fief-${fief.id}-${Date.now()}`,
            day: state.day,
            title: '开拓封地',
            detail: `以 ${action.cost.toLocaleString()} 金开拓${fief.name}，行「${policy.name}」之策：${policy.effect}。`,
            goldDelta: -action.cost
          },
          ...state.eventLog
        ].slice(0, 18)
      };
    }
    case 'chooseAmbition': {
      const ambition = findAmbition(action.ambitionId);
      if (!ambition || state.ambition || state.generation < 2) return state;
      const target = ambition.target(state.generation);
      return {
        ...state,
        ambition: { id: ambition.id, target, baseFiefs: ownedFiefCountOf(state.fiefs) },
        eventLog: [
          { id: `ambition-${Date.now()}`, day: state.day, title: `本代志向 · ${ambition.name}`, detail: `${ambition.motto}。${ambition.describe(target)}，传位时结算。` },
          ...state.eventLog
        ].slice(0, 18)
      };
    }
    case 'setFiefPolicy': {
      const fief = findFief(action.fiefId);
      const policy = findFiefPolicy(action.policyId);
      const current = fief ? state.fiefs[fief.id] : undefined;
      if (!fief || !policy || !current || current === policy.id || state.gold < action.cost || action.cost !== policyChangeCostFor(state, fief)) {
        return state;
      }
      const fiefs = { ...state.fiefs, [fief.id]: policy.id };
      const reclaimed = Math.max(0, state.orders - orderCapFor(fiefs, state.realms));
      return {
        ...state,
        gold: state.gold - action.cost,
        fiefs,
        // 撤掉整军方略后军令上限下降，存量超出的部分收回
        orders: Math.min(orderCapFor(fiefs, state.realms), state.orders),
        eventLog: [
          {
            id: `fief-policy-${fief.id}-${Date.now()}`,
            day: state.day,
            title: '改弦更张',
            detail: `${fief.name}改行「${policy.name}」之策，耗 ${action.cost.toLocaleString()} 金：${policy.effect}${reclaimed > 0 ? `，军令上限降为 ${orderCapFor(fiefs, state.realms)}，收回 ${reclaimed} 道` : ''}。`,
            goldDelta: -action.cost
          },
          ...state.eventLog
        ].slice(0, 18)
      };
    }
    case 'upgradeHome':
      return {
        ...state,
        gold: state.gold - action.cost,
        homeLevel: action.nextLevel,
        // 北疆刚开放时不立刻来边患，给三日缓冲
        nextRaidDay: action.nextLevel === FRONTIER_UNLOCK_HOME_LEVEL ? Math.max(state.nextRaidDay, state.day + 3) : state.nextRaidDay,
        eventLog: [
          {
            id: `home-${action.nextLevel}-${Date.now()}`,
            day: state.day,
            title: '宅邸升阶',
            detail: `宅邸已提升至 ${findHomeLevel(action.nextLevel).name}。${HOME_UNLOCKS[action.nextLevel] ? `新开放：${HOME_UNLOCKS[action.nextLevel]}。` : ''}`
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
      {
      // 只有比手上这把强才自动换上，否则收进兵器库
      const lordId = state.selectedLordId ?? '';
      const stronger = weaponBonusForLord(findWeapon(action.weaponId), lordId) > weaponBonusForLord(findWeapon(state.equippedWeaponId), lordId);
      return {
        ...state,
        gold: state.gold - action.price,
        ownedWeaponIds: [...state.ownedWeaponIds, action.weaponId],
        equippedWeaponId: stronger ? action.weaponId : state.equippedWeaponId,
        eventLog: [
          {
            id: `weapon-buy-${action.weaponId}-${Date.now()}`,
            day: state.day,
            title: '购入兵器',
            detail: `以 ${action.price.toLocaleString()} 金购入 ${findWeapon(action.weaponId).name}${stronger ? '并装备' : '，比手上的弱，收入兵器库'}。`,
            goldDelta: -action.price
          },
          ...state.eventLog
        ].slice(0, 18)
      };
      }
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
    case 'startBattle':
      // 北疆边患是被迫应战，不耗军令
      if (action.mode !== 'frontier' && state.orders < 1) return state;
      return { ...state, orders: action.mode === 'frontier' ? state.orders : state.orders - 1, activeBattle: { mode: action.mode, lossGold: action.lossGold, rewardGold: action.rewardGold, odds: action.odds, doudizhu: action.doudizhu } };
    case 'updateActiveBattle':
      // 斗地主叫抢/炸弹改了倍数、定了身份：回写进行中的牌局，刷新逃局按当前认输金额扣
      if (!state.activeBattle?.doudizhu) return state;
      if (state.activeBattle.multiplier === action.multiplier && state.activeBattle.share === action.share) return state;
      return { ...state, activeBattle: { ...state.activeBattle, multiplier: action.multiplier, share: action.share } };
    case 'recordBattle': {
      // 北疆：胜则靖边 +1、边患解除并排下一次；败则失守立刻扣金；退守关内不扣金、边患保留，24 小时内可再战
      const bonus = action.win && state.nextBattleBonus ? state.nextBattleBonus : 1;
      // 国号专属：魏加朝议、吴加水战
      const rewardGold = Math.round(action.rewardGold * bonus * (action.doudizhu ? 1 : realmRewardScale(state.realms, action.mode) * bountyScale(state.day, action.mode)));
      const frontierSettled = action.mode === 'frontier' && !action.retreat;
      // 非北疆战场：战败/认输损失约定的军资（北疆走失守扣金）
      const lossGold = !action.win && action.mode !== 'frontier' ? Math.min(state.gold, Math.max(0, Math.round(action.lossGold ?? 0))) : 0;
      const frontierPenalty = frontierSettled && !action.win && state.frontierRaid ? raidPenalty(state.gold) : 0;
      const frontierPatch = frontierSettled
        ? { frontierRaid: null, nextRaidDay: state.day + RAID_INTERVAL_DAYS, frontierWins: action.win ? state.frontierWins + 1 : state.frontierWins }
        : {};
      return {
        ...state,
        ...frontierPatch,
        activeBattle: null,
        gold: (action.win ? state.gold + rewardGold : state.gold) - frontierPenalty - lossGold,
        nextBattleBonus: action.win && state.nextBattleBonus ? null : state.nextBattleBonus,
        battleWins: action.win ? state.battleWins + 1 : state.battleWins,
        battleLosses: action.win ? state.battleLosses : state.battleLosses + 1,
        navalWins: action.win && action.mode === 'naval' ? state.navalWins + 1 : state.navalWins,
        courtWins: action.win && action.mode === 'court' ? state.courtWins + 1 : state.courtWins,
        eventLog: [
          {
            id: `battle-${Date.now()}`,
            day: state.day,
            title: action.doudizhu ? (action.win ? '牌局得胜' : action.retreat ? '离席认输' : '牌局失手') : action.win ? ({ land: '讨伐得胜', naval: '水战告捷', court: '朝议得胜', frontier: '靖边得胜' } as const)[action.mode] : frontierSettled ? '边患失守' : '整军再战',
            detail: action.win
              ? `${action.doudizhu ? '牌桌赢得' : ({ land: '军中缴获', naval: '江上缴获', court: '朝廷赏赐', frontier: '边军缴获' } as const)[action.mode]} ${rewardGold.toLocaleString()} 金${bonus > 1 ? '（练兵之策翻倍）' : ''}。`
              : frontierSettled ? `迎战失利，边郡遭劫，损失 ${frontierPenalty.toLocaleString()} 金。` : action.mode === 'frontier' ? '退守关内，边患未解，须尽快再战。' : action.doudizhu ? `${action.retreat ? '中途认输' : '对手先走完'}，付出 ${lossGold.toLocaleString()} 金。` : action.retreat ? `认输回府，折损军资 ${lossGold.toLocaleString()} 金。` : `此战未竟，折损军资 ${lossGold.toLocaleString()} 金。`,
            goldDelta: action.win ? rewardGold : frontierPenalty > 0 ? -frontierPenalty : lossGold > 0 ? -lossGold : undefined,
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
        tutorialDone: true,
        eventLog: state.tutorialDone
          ? state.eventLog
          : [{ id: `tutorial-${Date.now()}`, day: state.day, title: '引导完成', detail: '家业已上正轨。往后看任务面板与称号提示决定下一步。' }, ...state.eventLog].slice(0, 18)
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
      const gained = legacyPointsFor(state.gold, legacyGoldPerPointFor(state));
      if (state.homeLevel < SUCCESSION_HOME_LEVEL || gained < 1) {
        return state;
      }
      const legacyPoints = Math.min(LEGACY_MAX_POINTS, state.legacyPoints + gained);
      const status = ambitionStatus(state);
      const entry = {
        generation: state.generation,
        lordId: state.selectedLordId ?? '',
        days: state.day,
        gold: state.gold,
        wins: state.battleWins,
        fiefs: ownedFiefCountOf(state.fiefs),
        ambition: state.ambition?.id ?? null,
        ambitionDone: Boolean(status?.done)
      };
      return {
        ...defaultGameState,
        chronicle: trimChronicle([...state.chronicle, entry]),
        realm: state.realm,
        realms: state.realms,
        pastDynasties: state.pastDynasties,
        earnedTitles: collectEarnedTitles(state).earnedTitles,
        screen: 'lordSelect',
        lastScreen: 'lordSelect',
        soundEnabled: state.soundEnabled,
        tutorialDone: true,
        generation: state.generation + 1,
        legacyPoints,
        // 屯田与封地是田产，随家业传给下一代
        farmLevel: state.farmLevel,
        fiefs: state.fiefs,
        claimedQuestIds: inheritedQuestIds(state.farmLevel, state.fiefs),
        eventLog: [
          {
            id: `succeed-${Date.now()}`,
            day: 1,
            title: '传位',
            detail: `第 ${state.generation} 代以 ${state.gold.toLocaleString()} 金传下家业，获家业点 ${legacyPoints - state.legacyPoints}，累计 ${legacyPoints}${state.farmLevel > 0 ? '，屯田随之传下' : ''}${Object.keys(state.fiefs).length > 0 ? '，封地随之传下' : ''}${status ? `；志向「${status.ambition.name}」${status.done ? '达成，载入家谱' : '未竟'}` : ''}。`
          }
        ]
      };
    }
    case 'foundDynasty': {
      const realm = findRealm(action.realm);
      if (!realm || !isEndingReached(state)) return state;
      const summary = dynastySummary(state);
      // 国号记在新朝：前朝条目带的是它自己的国号（开国第一朝为空）
      const realms = { ...state.realms, [realm.id]: state.realms[realm.id] + 1 };
      const dynasty = state.pastDynasties.length + 1;
      return {
        ...defaultGameState,
        screen: 'lordSelect',
        lastScreen: 'lordSelect',
        soundEnabled: state.soundEnabled,
        tutorialDone: true,
        realm: realm.id,
        realms,
        pastDynasties: [...state.pastDynasties, { dynasty, realm: state.realm, generations: summary.generations, days: summary.days, wins: summary.wins, ambitions: summary.ambitions }].slice(-20),
        // 家声跨朝保留：天下归心等称号不随世代/封地重置被收回（先按重置前的存档补记一次，读档后未经任何操作就开新朝也不漏）
        earnedTitles: collectEarnedTitles(state).earnedTitles,
        eventLog: [
          { id: `dynasty-${Date.now()}`, day: 1, title: `开创新朝 · ${realm.name}`, detail: `前朝历 ${summary.generations} 代 ${summary.days} 日，${summary.wins} 胜，六郡归心。新朝国号「${realm.name}」：${realm.effect}，永久保留。` }
        ]
      };
    }
    // 重开基业：放弃本朝重来，国号加成、前朝记录与家声是跨朝资产，保留（只有「重置存档」才全清）
    case 'restart':
      return { ...defaultGameState, soundEnabled: state.soundEnabled, realm: state.realm, realms: state.realms, pastDynasties: state.pastDynasties, earnedTitles: collectEarnedTitles(state).earnedTitles, tutorialDone: dynastyCount(state.realms) > 0 };
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
    () => partners.filter((partner) => state.ownedPartnerIds.includes(partner.id)).map((partner) => mergePartnerBoost(partner, state.partnerBoosts[partner.id])),
    [state.ownedPartnerIds, state.partnerBoosts]
  );

  const fiefStat = fiefStatBonus(state.fiefs) + realmStatBonus(state.realms);
  const orderCap = orderCapFor(state.fiefs, state.realms);
  const totalPower = selectedLord ? calculateTotalPower(selectedLord, ownedPartners, equippedWeapon, currentHome, fiefStat) : 0;
  const navalPower = selectedLord ? calculateNavalPower(selectedLord, ownedPartners, currentHome, fiefStat) : 0;
  const courtPower = selectedLord ? calculateCourtPower(selectedLord, ownedPartners, currentHome, fiefStat) : 0;
  const intelligence = selectedLord ? calculateIntelligence(selectedLord, ownedPartners, fiefStat) : 0;
  const charisma = selectedLord ? calculateCharisma(selectedLord, ownedPartners, fiefStat) : 0;
  const questStatuses = getQuestStatuses(state, { currentHome, equippedWeapon, ownedPartners, totalPower });
  const titleStatus = useMemo(() => getTitleStatus(state), [state]);

  const currentFarm = useMemo(() => findFarmLevel(state.farmLevel), [state.farmLevel]);
  const nextFarm = useMemo(() => farmLevels.find((farm) => farm.level === state.farmLevel + 1) ?? null, [state.farmLevel]);
  const fiefPercent = fiefIncomePercent(state.fiefs) + realmIncomePercent(state.realms);
  const dailyIncome = totalDailyIncome(currentHome.dailyIncome, currentFarm.incomePercent, state.legacyPoints, intelligence, currentFarm.flatIncome, fiefPercent);
  // 再开一郡行劝农，每次政务多多少金（给封地弹窗算账用）
  const farmingGain = totalDailyIncome(currentHome.dailyIncome, currentFarm.incomePercent, state.legacyPoints, intelligence, currentFarm.flatIncome, fiefPercent + FIEF_INCOME_PERCENT) - dailyIncome;
  const buffActive = Boolean(state.incomeBuff && state.day + 1 <= state.incomeBuff.untilDay);
  const displayedIncome = buffActive && state.incomeBuff ? Math.round(dailyIncome * (1 + state.incomeBuff.percent / 100)) : dailyIncome;
  const recruitDiscount = recruitDiscountPercent(charisma);
  const recruitCostFor = useCallback((partner: Partner) => effectiveRecruitCost(partner.recruitCost, charisma), [charisma]);

  const collectIncome = useCallback(() => {
    dispatch({ type: 'collectIncome', amount: dailyIncome });
    return displayedIncome;
  }, [dailyIncome, displayedIncome]);

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
    const cost = nextFarm ? realmFarmCost(state.realms, nextFarm.cost) : 0;
    if (!nextFarm || state.gold < cost) {
      return false;
    }
    dispatch({ type: 'upgradeFarm', nextLevel: nextFarm.level, cost });
    return true;
  }, [nextFarm, state.gold, state.realms]);

  const claimFief = useCallback(
    (policyId: FiefPolicyId) => {
      const fief = nextFief(state.fiefs);
      const cost = fief ? fiefCostFor(state, fief) : 0;
      if (!fief || state.gold < cost) {
        return false;
      }
      dispatch({ type: 'claimFief', fiefId: fief.id, policyId, cost });
      return true;
    },
    [state]
  );

  const setFiefPolicy = useCallback(
    (fiefId: string, policyId: FiefPolicyId) => {
      const fief = findFief(fiefId);
      const cost = fief ? policyChangeCostFor(state, fief) : 0;
      if (!fief || !state.fiefs[fiefId] || state.fiefs[fiefId] === policyId || state.gold < cost) {
        return false;
      }
      dispatch({ type: 'setFiefPolicy', fiefId, policyId, cost });
      return true;
    },
    [state]
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
    currentFarm,
    nextFarm,
    ownedPartners,
    totalPower,
    navalPower,
    courtPower,
    intelligence,
    charisma,
    dailyIncome: displayedIncome,
    fiefPercent,
    fiefStat,
    farmingGain,
    orderCap,
    buffActive,
    recruitDiscount,
    recruitCostFor,
    questStatuses,
    titleStatus,
    // 传位后还没选新主公时也算有存档，避免标题页「开始游戏」把世代清零
    hasSave: Boolean(state.selectedLordId) || state.generation > 1 || dynastyCount(state.realms) > 0 || state.pastDynasties.length > 0,
    setScreen: (screen: Screen) => dispatch({ type: 'setScreen', screen }),
    selectLord: (lordId: string) => dispatch({ type: 'selectLord', lordId }),
    selectStarterPartner: (partner: Partner) => dispatch({ type: 'selectStarterPartner', partner }),
    collectIncome,
    upgradeHome,
    recruitPartner,
    buyWeapon,
    upgradeFarm,
    claimFief,
    setFiefPolicy,
    chooseAmbition: (ambitionId: AmbitionId) => dispatch({ type: 'chooseAmbition', ambitionId }),
    foundDynasty: (realm: RealmId) => dispatch({ type: 'foundDynasty', realm }),
    endingReached: isEndingReached(state),
    equipWeapon: (weaponId: string) => dispatch({ type: 'equipWeapon', weaponId }),
    recordBattle: (win: boolean, rewardGold: number, mode: BattleMode = 'land', retreat = false, lossGold = 0, doudizhu = false) => dispatch({ type: 'recordBattle', win, rewardGold, mode, retreat, lossGold, doudizhu }),
    claimQuest: (questId: string) => dispatch({ type: 'claimQuest', questId }),
    toggleSound: () => dispatch({ type: 'toggleSound' }),
    completeTutorial: () => dispatch({ type: 'completeTutorial' }),
    restoreGame: (nextState: GameState) => dispatch({ type: 'restore', state: nextState }),
    succeed: () => dispatch({ type: 'succeed' }),
    startBattle: (mode: BattleMode, lossGold: number, extra: { rewardGold?: number; odds?: number; doudizhu?: boolean } = {}) => dispatch({ type: 'startBattle', mode, lossGold, ...extra }),
    updateActiveBattle: (multiplier: number, share: number) => dispatch({ type: 'updateActiveBattle', multiplier, share }),
    resolveChoice: (optionId: string) => dispatch({ type: 'resolveChoice', optionId }),
    resetGame: () => dispatch({ type: 'reset' }),
    restartGame: () => dispatch({ type: 'restart' })
  };
}
