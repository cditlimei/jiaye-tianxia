import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { AffairKind } from '../data/affairs';
import { farmLevels, findFarmLevel, findHomeLevel, findLord, findWeapon, homeLevels, lords, partners } from '../data/gameData';
import type { Partner, Weapon } from '../data/gameData';
import { findPartnerEvent, mergePartnerBoost, partnerIdOfKey } from '../data/partnerEvents';
import { HOME_UNLOCKS, BATTLE_BONUS_MULTIPLIER, choiceGoldValue, collectEarnedTitles, getQuestStatuses, getTitleStatus, resolvePendingEvent, INCOME_BUFF_DAYS, INCOME_BUFF_PERCENT, quests } from '../data/progression';
import { weaponBonusForLord, LEGACY_MAX_POINTS, LEGACY_START_GOLD_PER_POINT, SUCCESSION_HOME_LEVEL, calculateCharisma, calculateCourtPower, calculateIntelligence, calculateNavalPower, calculateTotalPower, effectiveRecruitCost, legacyIncomeMultiplier, recruitDiscountPercent, successionPlan, totalDailyIncome } from '../lib/battle';
import { clearGameState, defaultGameState, GAME_STORAGE_KEY, isOldTabRaw, loadGameState, parseSyncedGameState, readRawGameState, saveGameState } from '../lib/storage';
import type { BattleMode, GameState, Screen } from '../types';
import { advanceClock, advanceOrders, CLOCK_TICK_MS, clockManual, CLOCK_VERSION, collectTreasury, dayIncomeOf, foundedDays, stepDay } from '../lib/clock';
import { AMBITION_REWARD_GOLD, ownedFiefCountOf, reconcileVow, trimChronicle, VOWS, vowFor } from '../data/ambitions';
import { bequestSlots, bountyScale, dynastyCount, dynastySummary, effectiveRealms, foundingGoldFor, genDays, genWins, isEndingReached, isHeirPending, realmFarmCost, realmRewardScale } from '../data/dynasty';
import { minorGoldValue, MINOR_BOOST_AMOUNT, parseMinorKey } from '../data/minorEvents';
import { activeTradition, legacyPriceRateFor } from '../data/traditions';
import { attackableFiefs, FIEF_INCOME_PERCENT, FIEF_UNLOCK_HOME_LEVEL, findFief, findFiefPolicy, nextFief, ownedFiefCount, type FiefPolicyId } from '../data/fiefs';
import { FACTIONS, findBequest, FOUNDABLE_FACTIONS, isBequestId, type BequestId, type FactionId } from '../data/factions';
import { RAID_INTERVAL_DAYS, raidPenalty } from '../lib/frontier';
import { advanceSiege, canLoseFief, FIEF_WALLS, firstSiegeGuarded, reclaimRemainingMs, reconcileSiege, releaseStaleSiege, SIEGE_FIRST_DELAY_MS, SIEGE_INTERVAL_MS, siegeTestFlags, wallsOf } from '../lib/siege';
import { conquestStakeOf, fiefCostOf, homeUpgradeCostOf, incomePercentOf, orderCapOf, policyChangeCostOf, siegeBountyOf, statBonusOf, wallRepairCostOf } from '../lib/prices';
import { availablePlaques, titleBonuses } from '../data/titleEffects';

const HEARTBEAT_MS = 15000;

type Action =
  | { type: 'setScreen'; screen: Screen }
  | { type: 'selectLord'; lordId: string }
  | { type: 'selectStarterPartner'; partner: Partner }
  | { type: 'collectTreasury'; kind: AffairKind; advance?: boolean }
  | { type: 'clockTick'; now: number }
  | { type: 'upgradeHome'; nextLevel: number; cost: number }
  | { type: 'upgradeFarm'; nextLevel: number; cost: number }
  | { type: 'claimFief'; fiefId: string; policyId: FiefPolicyId; cost: number }
  | { type: 'startConquest'; fiefId: string; policyId: FiefPolicyId; stake: number; refundRate?: number }
  | { type: 'resolveConquest'; win: boolean; refundRate?: number }
  | { type: 'siegeTick'; now: number; force?: boolean; target?: string | null }
  | { type: 'startDefense' }
  | { type: 'resolveDefense'; win: boolean; abandon?: boolean }
  | { type: 'repairWall'; fiefId: string }
  | { type: 'setEscort'; partnerId: string }
  | { type: 'recordSkillUse'; partnerId: string; uses: number }
  | { type: 'refundOrder'; partnerId?: string }
  | { type: 'foundDynasty'; faction: FactionId; bequests: BequestId[]; keepPartnerId?: string | null }
  | { type: 'restart' }
  | { type: 'setPlaque'; plaque: string | null }
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

/** 跨朝（与重开、重选主公）带着走的字段：国号、前朝、家声、匾，v3.2 的势力、冻结遗泽、本朝遗泽与宏愿、开国金、迁移补偿 */
function dynastyCarry(state: GameState) {
  return {
    realm: state.realm,
    realms: state.realms,
    pastDynasties: state.pastDynasties,
    earnedTitles: state.earnedTitles,
    plaque: state.plaque,
    faction: state.faction,
    seat: state.seat,
    ancestralRealms: state.ancestralRealms,
    bequests: state.bequests,
    vow: state.vow ?? vowFor(state.faction),
    vowsDone: state.vowsDone,
    foundingGold: state.foundingGold,
    legacyTradition: state.legacyTradition,
    migrationComp: state.migrationComp
  };
}

/** 留贤留下、还在等开局伴侣的那位（开新朝后只有她一位，选完开局伴侣就清掉） */
function pendingKept(state: GameState) {
  if (state.generation !== 1 || !state.keptPartnerId) return null;
  if (!state.ownedPartnerIds.includes(state.keptPartnerId)) return null;
  // 第一次择主前：开新朝时从上一朝的伴侣里挑出来（伴侣表里还有前朝的人）；择主后：只剩她一位
  return !state.selectedLordId || (state.ownedPartnerIds.length === 1) ? state.keptPartnerId : null;
}

/** 留贤伴侣跟着走的字段（择主、回头重选主公、重开基业都用） */
function keptFieldsOf(state: GameState) {
  const kept = pendingKept(state);
  return kept
    ? {
        ownedPartnerIds: [kept],
        escortPartnerId: kept,
        partnerBoosts: state.partnerBoosts[kept] ? { [kept]: state.partnerBoosts[kept] } : {},
        resolvedPartnerEvents: Object.fromEntries(Object.entries(state.resolvedPartnerEvents).filter(([key]) => partnerIdOfKey(key) === kept)),
        skillStats: state.skillStats[kept] ? { [kept]: state.skillStats[kept] } : {},
        keptPartnerId: kept
      }
    : {};
}

/** 屯田与封地随家业传下，对应的「第一次」任务下一代不再重领 */
function inheritedQuestIds(farmLevel: number, fiefs: GameState['fiefs']) {
  return [...(farmLevel > 0 ? ['farm-first'] : []), ...(Object.keys(fiefs).length > 0 ? ['fief-first'] : [])];
}

function addBoost(current: GameState['partnerBoosts'][string] | undefined, extra: GameState['partnerBoosts'][string]) {
  const sum = (k: 'strength' | 'intelligence' | 'charisma') => (current?.[k] ?? 0) + (extra[k] ?? 0) || undefined;
  return { strength: sum('strength'), intelligence: sum('intelligence'), charisma: sum('charisma') };
}

/** 糜夫人「舍身」退还军资比例：0~1 */
function clampRefundRate(rate: number) {
  return Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0;
}

function findPartnerName(partnerId: string) {
  return partners.find((item) => item.id === partnerId)?.name ?? '';
}

/** 每次状态更新后把当前满足的家声并入 earnedTitles（只增不减），开新朝重置世代/封地也不收回 */
function reducer(state: GameState, action: Action): GameState {
  // 反攻字段跟着封地走：得郡补城防与得郡时刻、失郡清掉，有郡没计时补 48 小时（见 reconcileSiege）
  // 天下归心或被围郡成了腹地：进行中的反攻作罢（见 releaseStaleSiege）
  // 宏愿跟着封地、城防、守城胜场推进（见 reconcileVow），排在 reconcileSiege 之后（最高郡数先更新）
  return collectEarnedTitles(reconcileVow(releaseStaleSiege(reconcileSiege(resetOrderClock(state, baseReducer(state, action))))));
}

/** 军令从满额跌下来（出征耗用、上限变化）的那一刻起计时；满额期间锚点不动，免得每个 tick 都改存档 */
function resetOrderClock(prev: GameState, next: GameState): GameState {
  if (next === prev || !next.selectedLordId) return next;
  const wasFull = prev.orders >= orderCapOf(prev);
  const isFull = next.orders >= orderCapOf(next);
  return wasFull && !isFull ? { ...next, orderClockAt: Math.max(next.orderClockAt, Date.now()) } : next;
}

/** 失郡：删掉该郡与城防、得郡时刻，记下失郡时刻；军令按新上限截断 */
function loseFief(state: GameState, fiefId: string, now: number): GameState {
  const fiefs = { ...state.fiefs };
  delete fiefs[fiefId];
  const fiefWalls = { ...state.fiefWalls };
  delete fiefWalls[fiefId];
  const fiefTakenAt = { ...state.fiefTakenAt };
  delete fiefTakenAt[fiefId];
  return {
    ...state,
    fiefs,
    fiefWalls,
    fiefTakenAt,
    lostFiefs: { ...state.lostFiefs, [fiefId]: now },
    // 撤掉整军郡后军令上限下降，存量超出的部分收回（同改方略）
    orders: Math.min(orderCapOf({ ...state, fiefs }), state.orders)
  };
}

/** 军令 +1 类选项：已满时不增加，纪事改写，免得写着 +1 实际没加 */
function orderGainDetail(state: GameState, detail: string) {
  return state.orders >= orderCapOf(state) ? detail.replace('军令 +1', '军令已满，未增加') : detail;
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
      // v3.1 传位：只换主公，宅邸、屯田、封地、伴侣、兵器、任务、战绩都留着，直接回主城
      if (isHeirPending(state)) {
        if (!lords.some((lord) => lord.id === action.lordId)) return state;
        return {
          ...state,
          selectedLordId: action.lordId,
          screen: 'home',
          lastScreen: 'home',
          eventLog: [
            {
              id: `lord-${Date.now()}`,
              day: state.day,
              title: `第 ${state.generation} 代择主`,
              detail: `${findLord(action.lordId)?.name ?? '新主'}承袭家业：${findHomeLevel(state.homeLevel).name}、${ownedFiefCount(state.fiefs)} 郡、${state.ownedPartnerIds.length} 位伴侣尽在。家业点 ${state.legacyPoints}，收入 +${Math.round((legacyIncomeMultiplier(state.legacyPoints) - 1) * 100)}%。`
            },
            ...state.eventLog
          ].slice(0, 18)
        };
      }
      {
      // 跨朝带过来的（势力、冻结国号遗泽、本朝遗泽与宏愿、开国金）；重选主公、重开也带着，进度照清
      const carry = dynastyCarry(state);
      // 留贤：新朝择主时把留下的伴侣（好感、了却的心事、随行统计）带进来；还没选开局伴侣时回头重选主公也照带
      const kept = pendingKept(state);
      const keptFields = keptFieldsOf(state);
      const fullOrders = state.generation === 1 && (titleBonuses(collectEarnedTitles(state)).dynastyFullOrders || carry.bequests.includes('veterans'));
      return {
        ...defaultGameState,
        ...carry,
        ...keptFields,
        keptPartnerId: kept,
        selectedLordId: action.lordId,
        // 开府：计时锚点、府库、开府时刻都从这一刻起
        clockAt: Date.now(),
        orderClockAt: Date.now(),
        foundedAt: Date.now(),
        treasury: { gold: 0, days: 0 },
        clockVersion: CLOCK_VERSION,
        screen: 'partnerSelect',
        lastScreen: 'partnerSelect',
        soundEnabled: state.soundEnabled,
        tutorialDone: state.generation > 1 || state.tutorialDone,
        // 第一代按本朝开国金（新档 1,000；开新朝定好的数）；v3.1 前「传位后待择主」的老存档走旧公式
        gold: state.generation > 1
          ? defaultGameState.gold + state.legacyPoints * LEGACY_START_GOLD_PER_POINT + (state.chronicle[state.chronicle.length - 1]?.ambitionDone ? AMBITION_REWARD_GOLD : 0)
          : state.foundingGold,
        chronicle: state.chronicle,
        earnedTitles: collectEarnedTitles(state).earnedTitles,
        // v3.1 前「传位后待择主」的老存档走旧流程，本朝沿用原来的造价曲线；新朝/重开/新档按默认 v3
        paceCurve: state.generation > 1 ? state.paceCurve : defaultGameState.paceCurve,
        firstSiegeDone: state.generation > 1 ? state.firstSiegeDone : false,
        // 强兵家风（老档冻结）：每代开局军令满额；天下归心、遗泽旧部：每朝开局军令满（上限按带过来的封地与遗泽算）
        orders: activeTradition(state)?.id === 'might' || fullOrders
          ? orderCapOf({ ...defaultGameState, ...carry, fiefs: state.generation > 1 ? state.fiefs : {}, earnedTitles: collectEarnedTitles(state).earnedTitles })
          : defaultGameState.orders,
        generation: state.generation,
        legacyPoints: state.legacyPoints,
        farmLevel: state.generation > 1 ? state.farmLevel : defaultGameState.farmLevel,
        fiefs: state.generation > 1 ? state.fiefs : defaultGameState.fiefs,
        // 封地的城防、得郡时刻与反攻计时随封地带过来（反攻要侯府才起）
        ...(state.generation > 1 ? { fiefWalls: state.fiefWalls, fiefTakenAt: state.fiefTakenAt, lostFiefs: state.lostFiefs, nextSiegeAt: state.nextSiegeAt, peakFiefs: Math.max(state.peakFiefs ?? 0, ownedFiefCount(state.fiefs)) } : {}),
        claimedQuestIds: state.generation > 1 ? inheritedQuestIds(state.farmLevel, state.fiefs) : [],
        eventLog: [
          {
            id: `lord-${Date.now()}`,
            day: 1,
            title: state.generation > 1 ? `第 ${state.generation} 代择主` : dynastyCount(state.realms) > 0 ? `第 ${dynastyCount(state.realms) + 1} 朝开国` : '择主立业',
            detail: state.generation > 1
              ? `先祖家业点 ${state.legacyPoints}，收入 +${Math.round((legacyIncomeMultiplier(state.legacyPoints) - 1) * 100)}%${state.chronicle[state.chronicle.length - 1]?.ambitionDone ? `；上一代志向达成，开局多得 ${AMBITION_REWARD_GOLD.toLocaleString()} 金` : ''}。`
              : dynastyCount(state.realms) > 0
                ? `${FACTIONS[carry.faction].name}起于${FACTIONS[carry.faction].capital}，开国金 ${state.foundingGold.toLocaleString()}；宏愿「${carry.vow ? VOWS[carry.vow.id].name : ''}」${carry.bequests.length > 0 ? `；遗泽 ${carry.bequests.map((id) => findBequest(id)?.name).join('、')}` : ''}${kept ? `；${findPartnerName(kept)}随行入府` : ''}。`.slice(0, 80)
                : '乱世基业已定，待择良缘共理家业。'
          }
        ]
      };
      }
    case 'selectStarterPartner':
      // 已有伴侣（如另一标签页已选过）时不再免费追加；留贤留下的那位不占开局伴侣的名额
      if (state.ownedPartnerIds.length > 0 && !(state.keptPartnerId && state.ownedPartnerIds.length === 1 && state.ownedPartnerIds[0] === state.keptPartnerId)) {
        return { ...state, screen: 'home', lastScreen: 'home' };
      }
      if (state.ownedPartnerIds.includes(action.partner.id)) {
        return { ...state, keptPartnerId: null, screen: 'home', lastScreen: 'home' };
      }
      return {
        ...state,
        screen: 'home',
        lastScreen: 'home',
        ownedPartnerIds: state.ownedPartnerIds.includes(action.partner.id)
          ? state.ownedPartnerIds
          : [...state.ownedPartnerIds, action.partner.id],
        // 留贤留下的伴侣仍随行（她带着心事与技能等级）；开局新选的入府
        escortPartnerId: state.keptPartnerId && state.ownedPartnerIds.includes(state.keptPartnerId) ? state.keptPartnerId : action.partner.id,
        keptPartnerId: null,
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
    case 'collectTreasury': {
      // 有待决事件先去定夺（首页主按钮改成「府中来报 · 去定夺」）
      if (state.pendingChoice || !state.selectedLordId) return state;
      // 测试开关 jiaye-clock-manual：先推进 1 日（军令按日回），再当场收取这一日
      const base = action.advance ? stepDay(state, { log: true, dayOrders: true }) : state;
      return collectTreasury(base, action.kind, { log: !action.advance });
    }
    case 'clockTick': {
      // 真实时间：按锚点推进日子（钱进府库）与军令；后台节流、tick 漏几次都不少算，时间回拨不推进
      if (!state.selectedLordId) return state;
      return advanceOrders(advanceClock(state, action.now).state, action.now);
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
          orders: picked.kind === 'order' ? Math.min(orderCapOf(state), state.orders + 1) : state.orders,
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
        orders: option.id === 'order' ? Math.min(orderCapOf(state), state.orders + 1) : state.orders,
        eventLog: [
          { id: `choice-${state.pendingChoice.day}-${option.id}`, day: state.day, title: `${event.title} · ${option.label}`, detail: option.id === 'order' ? orderGainDetail(state, option.detail) : option.detail, goldDelta: gold || undefined },
          ...state.eventLog
        ].slice(0, 18)
      };
    }
    case 'upgradeFarm':
      if (state.gold < action.cost || action.nextLevel !== state.farmLevel + 1 || action.cost !== realmFarmCost(effectiveRealms(state), findFarmLevel(action.nextLevel).cost)) {
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
      if (!fief || !policy || nextFief(state.fiefs, state.faction)?.id !== fief.id || state.gold < action.cost || action.cost !== fiefCostOf(state, fief)) {
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
    case 'startConquest': {
      const fief = findFief(action.fiefId);
      const policy = findFiefPolicy(action.policyId);
      // 只能攻相邻的郡；侯府开放；要 1 道军令和足额军资
      if (!fief || !policy || state.activeBattle || state.homeLevel < FIEF_UNLOCK_HOME_LEVEL || !attackableFiefs(state.fiefs, state.seat).some((item) => item.id === fief.id)
        || state.orders < 1 || action.stake !== conquestStakeOf(state, fief) || state.gold < action.stake) {
        return state;
      }
      return {
        ...state,
        gold: state.gold - action.stake,
        orders: state.orders - 1,
        activeBattle: { mode: 'land', lossGold: 0, doudizhu: true, conquest: { fiefId: fief.id, policyId: policy.id, stake: action.stake, ...(action.refundRate ? { refundRate: clampRefundRate(action.refundRate) } : {}), ...(reclaimRemainingMs(state, fief.id) > 0 ? { kind: 'reclaim' as const } : {}) } }
      };
    }
    case 'resolveConquest': {
      const conquest = state.activeBattle?.conquest;
      if (!conquest) return state;
      const fief = findFief(conquest.fiefId);
      const policy = findFiefPolicy(conquest.policyId);
      if (!fief || !policy) return { ...state, activeBattle: null };
      // 糜夫人「舍身」：攻郡未克退还一部分军资
      // 比例以出兵时记下的为准（与刷新离开一致），老存档没记就用撤兵时传来的
      const refundRate = conquest.refundRate ?? action.refundRate ?? 0;
      const refund = !action.win && refundRate ? Math.round(conquest.stake * clampRefundRate(refundRate)) : 0;
      const now = Date.now();
      const lostFiefs = { ...state.lostFiefs };
      if (action.win) delete lostFiefs[fief.id];
      const reclaimed = conquest.kind === 'reclaim';
      return {
        ...state,
        activeBattle: null,
        gold: state.gold + refund,
        fiefs: action.win ? { ...state.fiefs, [fief.id]: policy.id } : state.fiefs,
        // 得郡（含收复）：城防满、72 小时保护期从现在算；首郡开始反攻计时
        ...(action.win ? { fiefTakenAt: { ...state.fiefTakenAt, [fief.id]: now }, fiefWalls: { ...state.fiefWalls, [fief.id]: FIEF_WALLS }, lostFiefs, nextSiegeAt: state.nextSiegeAt || now + SIEGE_INTERVAL_MS } : {}),
        battleWins: action.win ? state.battleWins + 1 : state.battleWins,
        battleLosses: action.win ? state.battleLosses : state.battleLosses + 1,
        eventLog: [
          action.win
            ? { id: `conquest-${fief.id}-${Date.now()}`, day: state.day, title: `${reclaimed ? '收复' : '攻取'}${fief.name}`, detail: `牌桌上力克守将${fief.garrison}，${fief.name}${reclaimed ? '重' : ''}归府下，行「${policy.name}」之策（${policy.effect}），所有牌局得「${fief.perk.name}」：${fief.perk.detail}。` }
            : { id: `conquest-fail-${fief.id}-${Date.now()}`, day: state.day, title: `${reclaimed ? '收复' : '攻'}${fief.name}未克`, detail: refund > 0 ? `未克守将${fief.garrison}，${conquest.stake.toLocaleString()} 金军资没入敌手，糜夫人舍身护得 ${refund.toLocaleString()} 金带回。` : `守将${fief.garrison}棋高一着，${conquest.stake.toLocaleString()} 金军资没入敌手，可整军再攻。`, goldDelta: refund > 0 ? refund : undefined },
          ...state.eventLog
        ].slice(0, 18)
      };
    }
    case 'siegeTick': {
      if (!state.selectedLordId) return state;
      const step = advanceSiege(state, action.now, { force: action.force, target: action.target });
      if (step.siege === state.siege && step.nextSiegeAt === state.nextSiegeAt && step.fiefWalls === state.fiefWalls && step.firstSiegeDone === state.firstSiegeDone && !step.event) return state;
      return {
        ...state,
        siege: step.siege,
        nextSiegeAt: step.nextSiegeAt,
        fiefWalls: step.fiefWalls,
        firstSiegeDone: step.firstSiegeDone,
        eventLog: step.event ? [step.event, ...state.eventLog].slice(0, 18) : state.eventLog
      };
    }
    case 'startDefense': {
      // 守城：不耗军令、不押军资；随行伴侣照常
      const siege = state.siege;
      if (!siege || state.activeBattle || !state.fiefs[siege.fiefId]) return state;
      return { ...state, activeBattle: { mode: 'land', lossGold: 0, doudizhu: true, conquest: { fiefId: siege.fiefId, policyId: state.fiefs[siege.fiefId], stake: 0, kind: 'defend' } } };
    }
    case 'resolveDefense': {
      // 守住：城防回满、发犒赏、守城胜场 +1；失手（含主动弃城）：城防 −1，到 0 失郡；都排下一次反攻
      const siege = state.siege;
      const fief = siege ? findFief(siege.fiefId) : null;
      const defending = state.activeBattle?.conquest?.kind === 'defend' ? null : state.activeBattle;
      if (!siege || !fief || !state.fiefs[fief.id]) return { ...state, activeBattle: defending, siege: null };
      const now = Date.now();
      // 三朝元老：本朝第一次反攻城防不扣（这一次结了就算用过）
      const guarded = !action.win && firstSiegeGuarded(state);
      const base = { ...state, activeBattle: defending, siege: null, nextSiegeAt: now + SIEGE_INTERVAL_MS, firstSiegeDone: true };
      if (guarded) {
        return {
          ...base,
          battleLosses: state.battleLosses + 1,
          eventLog: [
            { id: `siege-guard-${fief.id}-${now}`, day: state.day, title: `${fief.name}城池必保`, detail: `${action.abandon ? '主公弃城' : '守城未克'}，三朝元老坐镇，本朝首次反攻城防不扣，${fief.name}仍为城防 ${wallsOf(state, fief.id)}。` },
            ...state.eventLog
          ].slice(0, 18)
        };
      }
      if (action.win) {
        const bounty = siegeBountyOf(state, fief);
        return {
          ...base,
          gold: state.gold + bounty,
          fiefWalls: { ...state.fiefWalls, [fief.id]: FIEF_WALLS },
          frontierWins: state.frontierWins + 1,
          battleWins: state.battleWins + 1,
          eventLog: [
            { id: `siege-win-${fief.id}-${now}`, day: state.day, title: `守住${fief.name}`, detail: `牌桌上击退${siege.attacker}，${fief.name}城防回满，犒赏三军 ${bounty.toLocaleString()} 金。`, goldDelta: bounty },
            ...state.eventLog
          ].slice(0, 18)
        };
      }
      // 兜底：被围郡已不是末端郡或已天下归心时不失郡，最低留 1（丢它会连带丢后方，或破坏结局）
      const walls = Math.max(canLoseFief(state, fief.id) ? 0 : 1, wallsOf(state, fief.id) - 1);
      const how = action.abandon ? '主公弃城' : '守城未克';
      if (walls <= 0) {
        const lost = loseFief(base, fief.id, now);
        const cap = orderCapOf(lost);
        return {
          ...lost,
          battleLosses: state.battleLosses + 1,
          eventLog: [
            { id: `siege-lost-${fief.id}-${now}`, day: state.day, title: `${fief.name}暂归${siege.attacker}`, detail: `${how}，城防尽失，${fief.name}暂归${siege.attacker}。72 小时内可押四分之一军资收复${state.orders > cap ? `；军令上限降为 ${cap}` : ''}。` },
            ...state.eventLog
          ].slice(0, 18)
        };
      }
      return {
        ...base,
        fiefWalls: { ...state.fiefWalls, [fief.id]: walls },
        battleLosses: state.battleLosses + 1,
        eventLog: [
          { id: `siege-alert-${fief.id}-${now}`, day: state.day, title: `${fief.name}告急`, detail: `${how}，${fief.name}城防降为 ${walls}，郡中牌桌特权「${fief.perk.name}」暂停。修城或下次守住即回满。` },
          ...state.eventLog
        ].slice(0, 18)
      };
    }
    case 'repairWall': {
      const fief = findFief(action.fiefId);
      if (!fief || !state.fiefs[fief.id] || wallsOf(state, fief.id) >= FIEF_WALLS) return state;
      const cost = wallRepairCostOf(state, fief);
      if (state.gold < cost) return state;
      return {
        ...state,
        gold: state.gold - cost,
        fiefWalls: { ...state.fiefWalls, [fief.id]: FIEF_WALLS },
        eventLog: [
          { id: `wall-repair-${fief.id}-${Date.now()}`, day: state.day, title: `修缮${fief.name}城防`, detail: `耗 ${cost.toLocaleString()} 金修满城防，「${fief.perk.name}」恢复。`, goldDelta: -cost },
          ...state.eventLog
        ].slice(0, 18)
      };
    }
    case 'setEscort':
      // 随行伴侣：须已入府；切换免费
      if (!state.ownedPartnerIds.includes(action.partnerId) || state.escortPartnerId === action.partnerId) return state;
      return { ...state, escortPartnerId: action.partnerId };
    case 'recordSkillUse': {
      if (!partners.some((partner) => partner.id === action.partnerId)) return state;
      const prev = state.skillStats[action.partnerId] ?? { games: 0, uses: 0 };
      return { ...state, skillStats: { ...state.skillStats, [action.partnerId]: { games: prev.games + 1, uses: prev.uses + Math.max(0, Math.floor(action.uses)) } } };
    }
    case 'refundOrder': {
      // 糜夫人「舍身」：失手 ×4 起返还本局军令，不超过上限
      const cap = orderCapOf(state);
      if (state.orders >= cap) return state;
      const name = action.partnerId ? findPartnerName(action.partnerId) : '';
      return {
        ...state,
        orders: state.orders + 1,
        eventLog: [
          { id: `refund-order-${Date.now()}`, day: state.day, title: '舍身护主', detail: `${name || '伴侣'}舍身相护，本局军令返还。` },
          ...state.eventLog
        ].slice(0, 18)
      };
    }
    case 'setFiefPolicy': {
      const fief = findFief(action.fiefId);
      const policy = findFiefPolicy(action.policyId);
      const current = fief ? state.fiefs[fief.id] : undefined;
      if (!fief || !policy || !current || current === policy.id || state.gold < action.cost || action.cost !== policyChangeCostOf(state, fief)) {
        return state;
      }
      const fiefs = { ...state.fiefs, [fief.id]: policy.id };
      const newCap = orderCapOf({ ...state, fiefs });
      const reclaimed = Math.max(0, state.orders - newCap);
      return {
        ...state,
        gold: state.gold - action.cost,
        fiefs,
        // 撤掉整军方略后军令上限下降，存量超出的部分收回
        orders: Math.min(newCap, state.orders),
        eventLog: [
          {
            id: `fief-policy-${fief.id}-${Date.now()}`,
            day: state.day,
            title: '改弦更张',
            detail: `${fief.name}改行「${policy.name}」之策，耗 ${action.cost.toLocaleString()} 金：${policy.effect}${reclaimed > 0 ? `，军令上限降为 ${newCap}，收回 ${reclaimed} 道` : ''}。`,
            goldDelta: -action.cost
          },
          ...state.eventLog
        ].slice(0, 18)
      };
    }
    case 'upgradeHome':
      // 价格按造价曲线校验（王城 v2 18 万 / v3 36 万），与按钮显示同一取价入口
      if (action.nextLevel !== state.homeLevel + 1 || action.cost !== homeUpgradeCostOf(state, action.nextLevel) || state.gold < action.cost) {
        return state;
      }
      return {
        ...state,
        gold: state.gold - action.cost,
        homeLevel: action.nextLevel,
        // 升到侯府（含第二代起带着封地重回侯府）：反攻至少 48 小时后才来，继承下来的过期计时不算
        ...(action.nextLevel === FIEF_UNLOCK_HOME_LEVEL && ownedFiefCount(state.fiefs) > 0 ? { nextSiegeAt: Math.max(state.nextSiegeAt, Date.now() + SIEGE_FIRST_DELAY_MS) } : {}),
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
        // 还没有随行伴侣时，新入府的随行；招到良缘伴侣时换她随行
        escortPartnerId: !state.escortPartnerId || !state.ownedPartnerIds.includes(state.escortPartnerId) || action.partner.bestMatchLordId === state.selectedLordId ? action.partner.id : state.escortPartnerId,
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
      const rewardGold = Math.round(action.rewardGold * bonus * (action.doudizhu ? 1 : realmRewardScale(effectiveRealms(state), action.mode) * bountyScale(state.day, action.mode)));
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
            title: action.doudizhu ? (action.win ? '牌局得胜' : action.retreat ? '离席认输' : '牌局失手') : action.win ? ({ land: '讨伐得胜', naval: '水战告捷', court: '朝议得胜', frontier: '靖边得胜' } as const)[action.mode] : frontierSettled ? '城池暂失' : '整军再战',
            detail: action.win
              ? `${action.doudizhu ? '牌桌赢得' : ({ land: '军中缴获', naval: '江上缴获', court: '朝廷赏赐', frontier: '边军缴获' } as const)[action.mode]} ${rewardGold.toLocaleString()} 金${bonus > 1 ? '（练兵之策翻倍）' : ''}。`
              : frontierSettled ? `守城未克，边郡遭劫，折损 ${frontierPenalty.toLocaleString()} 金。` : action.mode === 'frontier' ? '退守关内，边患未解，须尽快再战。' : action.doudizhu ? `${action.retreat ? '中途认输' : '对手先走完'}，付出 ${lossGold.toLocaleString()} 金。` : action.retreat ? `认输回府，折损军资 ${lossGold.toLocaleString()} 金。` : `此战未竟，折损军资 ${lossGold.toLocaleString()} 金。`,
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
    case 'setPlaque':
      // 主城挂哪块匾：只认已得的称号匾与旧誉纪念匾，null = 按最高档自动
      if (action.plaque !== null && !availablePlaques(state).includes(action.plaque)) return state;
      return state.plaque === action.plaque ? state : { ...state, plaque: action.plaque };
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
      // v3.1 传位：只换主公，宅邸、屯田、封地、城防、伴侣、兵器、任务、本朝战绩全部留下；进行中的反攻照常计时
      // 府库里没收的金子先按钱粮全额并入，再按递增价折家业点（第 n 点 5 万×n，富国家风八折），扣多少折多少，余金留给新主
      // gained < 1 也可传位（只换主公、不加点）；只看王城
      const heir = state.treasury.gold > 0 || state.treasury.days > 0 ? collectTreasury(state, 'treasury') : state;
      if (heir.homeLevel < SUCCESSION_HOME_LEVEL || !heir.selectedLordId || heir.activeBattle) {
        return state;
      }
      const rate = legacyPriceRateFor(heir);
      // v3.2 志向下线（改为势力宏愿，奖励是下一朝的遗泽），传位只按递增价折点
      const plan = successionPlan(heir.gold, heir.legacyPoints, rate, 0);
      const gained = plan.gained;
      const spent = plan.spent;
      const legacyPoints = plan.after;
      const now = Date.now();
      const entry = {
        generation: heir.generation,
        lordId: heir.selectedLordId,
        days: genDays(heir),
        gold: heir.gold,
        wins: genWins(heir),
        fiefs: ownedFiefCountOf(heir.fiefs),
        ambition: null,
        ambitionDone: false,
        openDays: foundedDays(heir.foundedAt, now)
      };
      const chronicle = trimChronicle([...heir.chronicle, entry]);
      const next: GameState = {
        ...heir,
        selectedLordId: null,
        screen: 'lordSelect',
        lastScreen: 'lordSelect',
        gold: heir.gold - spent,
        legacyPoints,
        generation: heir.generation + 1,
        chronicle,
        // 政务练出的属性是上一位主公自己的，随主公清零
        affairTraining: { strength: 0, civil: 0 },
        // 本朝最高郡数随家传下去：上一代丢的郡，新主收复回来不算「新开拓」（开疆志向）
        peakFiefs: Math.max(heir.peakFiefs ?? 0, ownedFiefCount(heir.fiefs)),
        genStart: { day: heir.day + 1, wins: heir.battleWins, defends: heir.frontierWins },
        foundedAt: now,
        tutorialDone: true,
        earnedTitles: collectEarnedTitles(heir).earnedTitles,
        eventLog: [
          {
            id: `succeed-${now}`,
            day: heir.day,
            title: '传位',
            detail: `第 ${heir.generation} 代传位：${gained > 0 ? `以 ${spent.toLocaleString()} 金折家业点 ${gained} 点，` : ''}家业点累计 ${legacyPoints}；宅邸、封地、伴侣、兵器尽数留给新主。`,
            goldDelta: spent > 0 ? -spent : undefined
          },
          ...heir.eventLog
        ].slice(0, 18)
      };
      // 强兵家风（老档冻结，本朝照旧）：传位时把军令补满
      return activeTradition(heir)?.id === 'might' ? { ...next, orders: Math.max(next.orders, orderCapOf(next)) } : next;
    }
    case 'foundDynasty': {
      // v3.2 开新朝：选国号 = 选下一朝的开局势力，再选遗泽（只管下一朝）；国号效果按「冻结遗泽 + 本朝一份」，不再按朝叠加
      const faction = FACTIONS[action.faction];
      if (!faction || !FOUNDABLE_FACTIONS.includes(faction.id) || !faction.unlocked(state) || !isEndingReached(state)) return state;
      const bequests = [...new Set(action.bequests)].filter(isBequestId);
      if (bequests.length !== action.bequests.length || bequests.length > bequestSlots(state)) return state;
      const keepId = bequests.includes('keeper') ? action.keepPartnerId ?? null : null;
      if (bequests.includes('keeper') && (!keepId || !state.ownedPartnerIds.includes(keepId))) return state;
      const summary = dynastySummary(state);
      // 国号计数照旧 +1（家声、前朝录、HUD 用）；汉（v3.3）不记国号
      const realms = faction.realm ? { ...state.realms, [faction.realm]: state.realms[faction.realm] + 1 } : state.realms;
      const dynasty = state.pastDynasties.length + 1;
      const lordIds = [...state.chronicle.map((entry) => entry.lordId), state.selectedLordId ?? ''].filter(Boolean);
      const lordsKept = lordIds.length <= 8 ? lordIds : [lordIds[0], ...lordIds.slice(-7)];
      const gold = foundingGoldFor(state, bequests.includes('treasury'));
      const now = Date.now();
      const keptFields = keepId
        ? {
            ownedPartnerIds: [keepId],
            partnerBoosts: state.partnerBoosts[keepId] ? { [keepId]: state.partnerBoosts[keepId] } : {},
            resolvedPartnerEvents: Object.fromEntries(Object.entries(state.resolvedPartnerEvents).filter(([key]) => partnerIdOfKey(key) === keepId)),
            skillStats: state.skillStats[keepId] ? { [keepId]: state.skillStats[keepId] } : {},
            escortPartnerId: keepId
          }
        : {};
      const notes = [
        `开国金 ${gold.total.toLocaleString()}${gold.treasury > 0 ? `（府库 +${gold.treasury.toLocaleString()}）` : ''}`,
        gold.comp > 0 ? `前朝旧例补发 ${gold.comp.toLocaleString()} 金` : '',
        bequests.length > 0 ? `遗泽 ${bequests.map((id) => findBequest(id)?.name).join('、')}` : ''
      ].filter(Boolean);
      return {
        ...defaultGameState,
        ...keptFields,
        screen: 'lordSelect',
        lastScreen: 'lordSelect',
        soundEnabled: state.soundEnabled,
        tutorialDone: true,
        faction: faction.id,
        seat: faction.seat,
        realm: faction.realm ?? state.realm,
        realms,
        // 冻结遗泽只读：不随新朝增长
        ancestralRealms: state.ancestralRealms,
        bequests,
        vow: vowFor(faction.id),
        vowsDone: state.vowsDone,
        keptPartnerId: keepId,
        foundingGold: gold.total,
        legacyTradition: null,
        migrationComp: { founding: false, bequest: false },
        paceCurve: 'v3',
        pastDynasties: [...state.pastDynasties, { dynasty, realm: state.realm, faction: state.faction, lords: lordsKept, vow: Boolean(state.vow?.done), generations: summary.generations, days: summary.days, wins: summary.wins, ambitions: summary.ambitions, ...(summary.openDays ? { openDays: summary.openDays } : {}) }].slice(-20),
        // 家声跨朝保留：天下归心等称号不随世代/封地重置被收回（先按重置前的存档补记一次，读档后未经任何操作就开新朝也不漏）
        earnedTitles: collectEarnedTitles(state).earnedTitles,
        plaque: state.plaque,
        eventLog: [
          { id: `dynasty-${now}`, day: 1, title: `开创新朝 · ${faction.name}`, detail: `${faction.name}起于${faction.capital}，宏愿「${VOWS[faction.id].name}」。${notes.join('；')}。`.slice(0, 80) }
        ]
      };
    }
    // 重开基业：放弃本朝重来，国号、前朝记录、家声是跨朝资产，本朝的势力、遗泽、宏愿、开国金也留着（只有「重置存档」才全清）
    case 'restart':
      return { ...defaultGameState, ...dynastyCarry(state), ...keptFieldsOf(state), soundEnabled: state.soundEnabled, earnedTitles: collectEarnedTitles(state).earnedTitles, legacyTradition: null, tutorialDone: dynastyCount(state.realms) > 0 };
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
  // 刚收下旧版（v3.1）标签页写的存档：这一次不写回（v3.2 字段在旁存里留着），否则两边按各自口径来回覆盖停不下来
  const skipSaveRef = useRef(false);

  useEffect(() => {
    // 首次落盘前若其他标签页已写入更新的存档，先同步过来，避免用加载时的旧值覆盖
    if (rawAtLoadRef.current !== null) {
      const currentRaw = readRawGameState();
      const changedElsewhere = currentRaw !== rawAtLoadRef.current;
      rawAtLoadRef.current = null;
      const synced = changedElsewhere ? parseSyncedGameState(currentRaw) : null;
      if (synced) {
        skipSaveRef.current = isOldTabRaw(currentRaw);
        dispatch({ type: 'sync', state: synced });
        return;
      }
    }
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
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
      skipSaveRef.current = isOldTabRaw(event.newValue);
      dispatch({ type: 'sync', state: synced });
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // 真实时间府库与军令 + 邻郡反攻：同一个 tick。读档后立刻一次，开着页面每 30 秒一次，切回前台再一次；
  // 计时只按锚点算（clockAt / orderClockAt），后台节流、漏几次 tick 都不少算。反攻只在页面可见时起（离线不起）
  // 测试开关 jiaye-clock-manual 下不起时间 tick（日子靠「处理政务」推进）
  useEffect(() => {
    const tick = () => {
      if (!clockManual()) dispatch({ type: 'clockTick', now: Date.now() });
      if (document.visibilityState !== 'visible') return;
      const flags = siegeTestFlags();
      dispatch({ type: 'siegeTick', now: Date.now(), force: flags.force, target: flags.target });
    };
    tick();
    const timer = window.setInterval(tick, CLOCK_TICK_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const selectedLord = useMemo(() => findLord(state.selectedLordId), [state.selectedLordId]);
  const equippedWeapon = useMemo(() => findWeapon(state.equippedWeaponId), [state.equippedWeaponId]);
  const currentHome = useMemo(() => findHomeLevel(state.homeLevel), [state.homeLevel]);
  // 下一级宅邸：价格按造价曲线（王城 v2 18 万 / v3 36 万），页面上所有 nextHome.upgradeCost 都是这一份
  const nextHome = useMemo(() => {
    const home = homeLevels.find((item) => item.level === state.homeLevel + 1);
    return home ? { ...home, upgradeCost: homeUpgradeCostOf(state, home.level) } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.homeLevel, state.paceCurve, state.faction]);
  const ownedPartners = useMemo(
    () => partners.filter((partner) => state.ownedPartnerIds.includes(partner.id)).map((partner) => mergePartnerBoost(partner, state.partnerBoosts[partner.id])),
    [state.ownedPartnerIds, state.partnerBoosts]
  );

  // 教化郡 + 国号吴（冻结遗泽 + 本朝）+ 主公旧部
  const fiefStat = statBonusOf(state);
  // 处理政务练出的属性：军务加武力，治理加智谋与声望
  const strengthExtra = fiefStat + state.affairTraining.strength;
  const civilExtra = fiefStat + state.affairTraining.civil;
  const orderCap = orderCapOf(state);
  const totalPower = selectedLord ? calculateTotalPower(selectedLord, ownedPartners, equippedWeapon, currentHome, strengthExtra) : 0;
  const navalPower = selectedLord ? calculateNavalPower(selectedLord, ownedPartners, currentHome, civilExtra) : 0;
  const courtPower = selectedLord ? calculateCourtPower(selectedLord, ownedPartners, currentHome, civilExtra) : 0;
  const intelligence = selectedLord ? calculateIntelligence(selectedLord, ownedPartners, civilExtra) : 0;
  const charisma = selectedLord ? calculateCharisma(selectedLord, ownedPartners, civilExtra) : 0;
  const questStatuses = getQuestStatuses(state, { currentHome, equippedWeapon, ownedPartners, totalPower });
  const titleStatus = useMemo(() => getTitleStatus(state), [state]);

  const currentFarm = useMemo(() => findFarmLevel(state.farmLevel), [state.farmLevel]);
  const nextFarm = useMemo(() => farmLevels.find((farm) => farm.level === state.farmLevel + 1) ?? null, [state.farmLevel]);
  // 劝农郡 + 国号蜀 + 乡绅（称号）
  const fiefPercent = incomePercentOf(state);
  const dailyIncome = totalDailyIncome(currentHome.dailyIncome, currentFarm.incomePercent, state.legacyPoints, intelligence, currentFarm.flatIncome, fiefPercent);
  // 再开一郡行劝农，每次政务多多少金（给封地弹窗算账用）
  const farmingGain = totalDailyIncome(currentHome.dailyIncome, currentFarm.incomePercent, state.legacyPoints, intelligence, currentFarm.flatIncome, fiefPercent + FIEF_INCOME_PERCENT) - dailyIncome;
  const buffActive = Boolean(state.incomeBuff && state.day + 1 <= state.incomeBuff.untilDay);
  // 下一日的政务收入（含减税招商与真实时间校准系数），与 stepDay 同一算法
  const displayedIncome = dayIncomeOf(state, state.day + 1, dailyIncome);
  const recruitDiscount = recruitDiscountPercent(charisma);
  const recruitCostFor = useCallback((partner: Partner) => effectiveRecruitCost(partner.recruitCost, charisma), [charisma]);

  /** 收取府库（按所办之事处置整笔），返回实际入账；测试开关 jiaye-clock-manual 下先推进 1 日再收 */
  const collectIncome = useCallback((kind: AffairKind = 'treasury') => {
    const current = stateRef.current;
    if (current.pendingChoice) return 0;
    const advance = clockManual();
    const preview = collectTreasury(advance ? stepDay(current, { log: true, dayOrders: true }) : current, kind);
    dispatch({ type: 'collectTreasury', kind, advance });
    return preview.gold - current.gold;
  }, []);

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
    const cost = nextFarm ? realmFarmCost(effectiveRealms(state), nextFarm.cost) : 0;
    if (!nextFarm || state.gold < cost) {
      return false;
    }
    dispatch({ type: 'upgradeFarm', nextLevel: nextFarm.level, cost });
    return true;
  }, [nextFarm, state]);

  const claimFief = useCallback(
    (policyId: FiefPolicyId) => {
      const fief = nextFief(state.fiefs, state.faction);
      const cost = fief ? fiefCostOf(state, fief) : 0;
      if (!fief || state.gold < cost) {
        return false;
      }
      dispatch({ type: 'claimFief', fiefId: fief.id, policyId, cost });
      return true;
    },
    [state]
  );

  /** 出兵攻郡：押军资、耗 1 军令，进攻郡牌局 */
  const startConquest = useCallback(
    (fiefId: string, policyId: FiefPolicyId, refundRate = 0) => {
      const fief = findFief(fiefId);
      if (!fief) return false;
      const stake = conquestStakeOf(state, fief);
      if (state.gold < stake || state.orders < 1) return false;
      dispatch({ type: 'startConquest', fiefId, policyId, stake, refundRate });
      return true;
    },
    [state]
  );
  const resolveConquest = useCallback((win: boolean, refundRate = 0) => dispatch({ type: 'resolveConquest', win, refundRate }), []);
  /** 迎战守城：不耗军令、不押军资 */
  const startDefense = useCallback(() => {
    if (!state.siege || state.activeBattle || !state.fiefs[state.siege.fiefId]) return false;
    dispatch({ type: 'startDefense' });
    return true;
  }, [state.siege, state.activeBattle, state.fiefs]);
  const resolveDefense = useCallback((win: boolean) => dispatch({ type: 'resolveDefense', win }), []);
  /** 弃城：按失手处理（调用方先二次确认） */
  const abandonSiege = useCallback(() => dispatch({ type: 'resolveDefense', win: false, abandon: true }), []);
  const repairWall = useCallback((fiefId: string) => {
    const fief = findFief(fiefId);
    if (!fief || !state.fiefs[fiefId] || wallsOf(state, fiefId) >= FIEF_WALLS || state.gold < wallRepairCostOf(state, fief)) return false;
    dispatch({ type: 'repairWall', fiefId });
    return true;
  }, [state]);

  const setFiefPolicy = useCallback(
    (fiefId: string, policyId: FiefPolicyId) => {
      const fief = findFief(fiefId);
      const cost = fief ? policyChangeCostOf(state, fief) : 0;
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
    startConquest,
    resolveConquest,
    startDefense,
    resolveDefense,
    abandonSiege,
    repairWall,
    setFiefPolicy,
    foundDynasty: (faction: FactionId, bequests: BequestId[], keepPartnerId?: string | null) => dispatch({ type: 'foundDynasty', faction, bequests, keepPartnerId }),
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
    setEscort: (partnerId: string) => dispatch({ type: 'setEscort', partnerId }),
    recordSkillUse: (partnerId: string, uses: number) => dispatch({ type: 'recordSkillUse', partnerId, uses }),
    refundOrder: (partnerId?: string) => dispatch({ type: 'refundOrder', partnerId }),
    resetGame: () => dispatch({ type: 'reset' }),
    restartGame: () => dispatch({ type: 'restart' }),
    setPlaque: (plaque: string | null) => dispatch({ type: 'setPlaque', plaque })
  };
}

// 攻郡军资、开拓价、改方略价等 v3.1 起统一在 lib/prices.ts（conquestStakeOf / fiefCostOf / policyChangeCostOf）
