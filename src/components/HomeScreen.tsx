import { useEffect, useMemo, useRef, useState } from 'react';
import { partnerSkillLevel, skillUpgradeCopy } from '../data/partnerSkills';
import { VENUES, venueReward, venueRewardScale } from '../data/venues';
import type { HomeLevel, Lord, Partner, Weapon } from '../data/gameData';
import type { QuestStatus } from '../data/progression';
import { imageUrl } from '../lib/assets';
import { legacyIncomeMultiplier, weaponBonusForLord } from '../lib/battle';
import { formatRemaining } from '../lib/frontier';
import { FIEF_WALLS, reclaimRemainingMs, SIEGE_ENABLED } from '../lib/siege';
import { resolvePendingEvent } from '../data/progression';
import { partners } from '../data/gameData';
import { partnerIdOfKey } from '../data/partnerEvents';
import type { GameState } from '../types';
import { AMBITION_FULL_GOLD, ambitionPreview, ambitionStatus, availableAmbitions, type AmbitionId } from '../data/ambitions';
import { dynastyCount, endingHint, findRealm, isEndingReached, realmIncomePercent } from '../data/dynasty';
import { clockManual, formatWait, foundedDays, nextDayInMs, nextOrderInMs, TRAIN_MIN_DAYS, TREASURY_HARD_CAP_DAYS, treasuryCapDays, treasuryOutcome } from '../lib/clock';
import { farmLevels, weapons } from '../data/gameData';
import { realmFarmCost } from '../data/dynasty';
import { traditionCandidate, traditionOf } from '../data/traditions';
import { conquestStakeOf, legacyPreview } from '../lib/prices';
import { titleBonuses } from '../data/titleEffects';
import { LEGACY_MAX_POINTS } from '../lib/battle';
import { HomeHonors } from './HomeHonors';
import { FIEF_UNLOCK_HOME_LEVEL, fiefIncomePercent, fiefs, fiefStatBonus, nextFief, ownedFiefCount } from '../data/fiefs';
import { AFFAIR_KIND_LABEL, AFFAIR_TRAINING_CAP, affairChoicesFor, affairOutcome, type Affair, type AffairKind } from '../data/affairs';
import { GameButton } from './common/GameButton';
import { ImageWithFallback } from './common/ImageWithFallback';
import { ModalShell } from './common/ModalShell';
import type { RegionId } from './BattleScreen';

interface HomeScreenProps {
  state: GameState;
  lord: Lord;
  currentHome: HomeLevel;
  nextHome: HomeLevel | null;
  weapon: Weapon;
  ownedPartners: Partner[];
  totalPower: number;
  intelligence: number;
  charisma: number;
  dailyIncome: number;
  farmPercent: number;
  farmFlat: number;
  orderCap: number;
  recruitDiscount: number;
  onCollectIncome: (kind?: AffairKind) => number;
  onResolveChoice: (optionId: string) => void;
  onUpgrade: () => boolean;
  onOpenPartner: () => void;
  onOpenPartnerTalk: () => void;
  onOpenWeapon: () => void;
  onBattle: () => void;
  /** 带预选区域进出征页（荆州：疆域图 + 斗地主；西蜀：屯田） */
  onBattleAt: (region: RegionId) => void;
  /** 邻郡反攻告急条：进疆域图并选中该郡 */
  onOpenSiege?: (fiefId: string) => void;
  onOpenFarm: () => void;
  onClaimQuest: (questId: string) => void;
  onCompleteTutorial: () => void;
  onOpenSettings: () => void;
  onOpenLord: () => void;
  onOpenFief: () => void;
  onChooseAmbition: (id: AmbitionId) => void;
  onOpenEnding: () => void;
  onIncomeSfx: () => void;
  onUpgradeEffect: (imagePath: string, name: string) => void;
  questStatuses: QuestStatus[];
  titleStatus: { current: { name: string }; next: { name: string; requirement: string } | null; missing: number; lineage: { name: string } | null };
}

interface FloatingIncome {
  id: number;
  amount: number;
}

// 顶栏格子只有 70px 宽，百万以上改用「万」
function compactGold(gold: number) {
  if (gold < 1_000_000) return gold.toLocaleString();
  const wan = gold / 10000;
  return `${wan >= 10000 ? Math.round(wan).toLocaleString() : wan.toFixed(1).replace(/\.0$/, '')}万`;
}

export function HomeScreen({
  state,
  lord,
  currentHome,
  nextHome,
  weapon,
  ownedPartners,
  totalPower,
  intelligence,
  charisma,
  dailyIncome,
  farmPercent,
  farmFlat,
  orderCap,
  recruitDiscount,
  onCollectIncome,
  onResolveChoice,
  onUpgrade,
  onOpenPartner,
  onOpenWeapon,
  onBattle,
  onBattleAt,
  onOpenSiege,
  onOpenFarm,
  onClaimQuest,
  onCompleteTutorial,
  onOpenSettings,
  onOpenLord,
  onOpenFief,
  onChooseAmbition,
  onOpenEnding,
  onIncomeSfx,
  onUpgradeEffect,
  questStatuses,
  titleStatus
}: HomeScreenProps) {
  const [floating, setFloating] = useState<FloatingIncome[]>([]);
  // 今日政务回报：点一次政务弹一条「这天忙了什么、入账多少」，3 秒后收起
  const [report, setReport] = useState<(Affair & { id: number; day: number; amount: number; days: number }) | null>(null);
  const reportTimer = useRef<number | null>(null);
  // 真实时间（v2.3）：测试开关 jiaye-clock-manual 下退回「处理政务」推进一日
  const [manualClock] = useState(() => clockManual());
  const realtime = !manualClock;
  const [clock, setClock] = useState(() => Date.now());
  const treasuryCap = treasuryCapDays(state.homeLevel);
  const treasuryDays = state.treasury.days;
  const treasuryFull = treasuryDays >= treasuryCap;
  // 三段：未满 / 已满再放半数 / 已积满 48 日不再积存
  const treasuryHard = treasuryDays >= TREASURY_HARD_CAP_DAYS;
  const canCollect = treasuryDays >= 1 || state.treasury.gold > 0;
  const nextDayWait = formatWait(nextDayInMs(state, clock));
  const orderWaitMs = nextOrderInMs(state, clock);
  // 顶栏格子窄：军令倒计时一律写分钟（府邸起最多 120 分）
  const orderWait = orderWaitMs === null ? '' : `约${Math.max(1, Math.ceil(orderWaitMs / 60000))}分`;
  const openDays = foundedDays(state.foundedAt, clock);
  const ambition = ambitionStatus(state);
  // v3.1：家业点满了志向照常（奖励改发金），只有天下归心时收起
  const ambitionOpen = !isEndingReached(state);
  // 「稍后再定」只在本次打开页面内有效（模块变量，刷新即失效，不落存储）
  const [ambitionDeferred, setAmbitionDeferredState] = useState(() => ambitionDeferredGen === state.generation);
  const setAmbitionDeferred = (value: boolean) => {
    ambitionDeferredGen = value ? state.generation : null;
    setAmbitionDeferredState(value);
  };
  const [endingSeen, setEndingSeen] = useState(() => {
    try { return window.sessionStorage.getItem('jiaye-ending-seen') === String(state.pastDynasties.length); } catch { return false; }
  });
  const markEndingSeen = () => {
    setEndingSeen(true);
    try { window.sessionStorage.setItem('jiaye-ending-seen', String(state.pastDynasties.length)); } catch { /* 无存储也能用 */ }
  };
  const deferAmbition = () => setAmbitionDeferred(true);
  const nextFiefToClaim = nextFief(state.fiefs);
  // 攻郡押的军资（开拓价的一半）；还要有军令才能出兵
  const nextFiefCost = nextFiefToClaim ? conquestStakeOf(state, nextFiefToClaim) : 0;
  const fiefAffordable = state.homeLevel >= FIEF_UNLOCK_HOME_LEVEL && nextFiefToClaim !== null && state.gold >= nextFiefCost;
  const tradition = traditionOf(state.chronicle);
  const candidate = traditionCandidate(state.chronicle);
  const canUpgrade = Boolean(nextHome && state.gold >= nextHome.upgradeCost);
  const partnerNames = useMemo(() => ownedPartners.map((partner) => partner.name).join('、') || '尚未招募', [ownedPartners]);
  // 招人门槛按最便宜的未招伴侣算（含声望折扣），不写死
  const cheapestPartner = Math.min(...partners.filter((item) => !state.ownedPartnerIds.includes(item.id)).map((item) => Math.round(item.recruitCost * (1 - recruitDiscount / 100))), Infinity);
  // 开局引导：四步，每步指向一个按钮；钱不够时先指向「处理政务」
  const starterOrders = useMemo(
    () => [
      { label: '升级木屋', done: state.homeLevel >= 2, target: 'upgrade' as const, hint: nextHome && state.gold < nextHome.upgradeCost ? `先点「${realtime ? '收取府库' : '处理政务'}」攒到 ${nextHome.upgradeCost.toLocaleString()} 金，再升级宅邸。` : '点「升级宅邸」把茅草屋升成木屋，收入翻三倍。' },
      { label: '招募伴侣', done: state.ownedPartnerIds.length >= 2, target: 'partner' as const, hint: state.gold < cheapestPartner ? '金币不够招人：先领上方任务奖励、收取府库或去打一局斗地主攒钱，再去「招募伴侣」请一位入府。' : '去「招募伴侣」再请一位入府：伴侣随你上牌桌，各有一招，还加战力、智谋或声望。' },
      { label: '换一把兵器', done: state.equippedWeaponId !== 'xuanjian', target: 'weapon' as const, hint: '攒 1,500 金去「兵器库」买把青釭剑或双股剑。第 5 日伴侣会来说心事，了却后任务「良缘佳话」正好奖 1,500 金。' },
      { label: '初战告捷', done: state.battleWins >= 1, target: 'battle' as const, hint: '点底栏「出征」，进斗地主初级场打一局，赢了缴获比处理政务多得多。' }
    ],
    [cheapestPartner, nextHome, state.battleWins, state.equippedWeaponId, state.gold, state.homeLevel, state.ownedPartnerIds.length]
  );
  const currentOrder = starterOrders.find((order) => !order.done) ?? null;
  // 斗地主初级场一局的胜利缴获（与出征页同口径，含练兵之策）；新手引导缺钱时指去打一局
  const landFightGold = Math.round(venueReward(VENUES[0], venueRewardScale({ land: totalPower, naval: 0, court: 0 }, 1)) * (state.nextBattleBonus && state.nextBattleBonus > 1 ? state.nextBattleBonus : 1));
  // 第 3 步买兵器差钱时，有军令就去打一局斗地主，别让新人连点二十多天政务干等
  const weaponViaBattle = currentOrder?.target === 'weapon' && state.gold < 1500 && state.orders >= 1 && landFightGold > 0;
  const guidedTarget: 'income' | 'upgrade' | 'partner' | 'weapon' | 'battle' | null = state.tutorialDone || !currentOrder
    ? null
    : currentOrder.target === 'upgrade' && nextHome && state.gold < nextHome.upgradeCost
      ? 'income'
      : currentOrder.target === 'weapon' && state.gold < 1500
        ? weaponViaBattle ? 'battle' : 'income'
        : currentOrder.target === 'partner' && state.gold < cheapestPartner
          ? 'income'
          : currentOrder.target;
  const guided = (target: typeof guidedTarget) => (guidedTarget === target ? 'is-guided' : '');
  // 引导卡里直接给一个能点的按钮：钱够就去做这一步；不够先领任务奖励，再不够就「过一天」攒钱
  const claimableQuests = questStatuses.filter((quest) => quest.complete && !quest.claimed);
  const claimableGold = claimableQuests.reduce((sum, quest) => sum + quest.rewardGold, 0);
  const stepCost = currentOrder?.target === 'upgrade' ? nextHome?.upgradeCost ?? 0 : currentOrder?.target === 'partner' ? cheapestPartner : currentOrder?.target === 'weapon' ? 1500 : 0;
  const shortOf = Math.max(0, stepCost - state.gold);
  const guideReason = !currentOrder
    ? ''
    : currentOrder.target === 'upgrade'
      ? `${currentHome.name}升成${nextHome?.name ?? ''}，${realtime ? '每日' : '每次'}政务收入从 ${currentHome.dailyIncome} 金涨到 ${nextHome?.dailyIncome ?? ''} 金。`
      : currentOrder.target === 'partner'
        ? '伴侣随你上牌桌，各有一招（技能为主、属性为辅），最便宜的一位 ' + (Number.isFinite(cheapestPartner) ? cheapestPartner.toLocaleString() : '') + ' 金。'
        : currentOrder.target === 'weapon'
          ? `换一把好兵器，武力立刻上涨，出征胜率更高。青釭剑或双股剑 1,500 金。${weaponViaBattle ? `还差 ${shortOf.toLocaleString()} 金：去斗地主初级场打一局，胜可缴获约 ${landFightGold.toLocaleString()} 金，${landFightGold >= shortOf ? '一场就够' : `约 ${Math.ceil(shortOf / landFightGold)} 场凑齐`}。` : ''}`
          : '去斗地主初级场打一局，赢了缴获远多于政务收入。';
  const guideAction: { label: string; run: () => void } | null = !currentOrder
    ? null
    : shortOf > 0 && claimableGold > 0
      ? { label: `先领任务奖励 +${claimableGold.toLocaleString()} 金`, run: () => claimableQuests.forEach((quest) => onClaimQuest(quest.id)) }
      : weaponViaBattle
        ? { label: '去打一局斗地主 →', run: () => onBattleAt('jingzhou') }
      : shortOf > 0 && !realtime
        ? { label: `过一天 · +${dailyIncome.toLocaleString()} 金（还差 ${shortOf.toLocaleString()}）`, run: () => handleCollectIncome() }
      : shortOf > 0 && canCollect
        ? { label: `收取府库 · +${state.treasury.gold.toLocaleString()} 金（还差 ${shortOf.toLocaleString()}）`, run: () => handleCollectIncome() }
      : shortOf > 0 && state.orders >= 1
        ? { label: '去打一局斗地主攒钱 →', run: () => onBattleAt('jingzhou') }
      : shortOf > 0
        ? { label: `府库积存中 · 下一日${nextDayWait}后`, run: () => undefined }
        : currentOrder.target === 'upgrade'
          ? { label: `立即升级 · ${(nextHome?.upgradeCost ?? 0).toLocaleString()} 金`, run: () => handleUpgrade() }
          : currentOrder.target === 'partner'
            ? { label: '去招募伴侣 →', run: onOpenPartner }
            : currentOrder.target === 'weapon'
              ? { label: '去兵器库 →', run: onOpenWeapon }
              : { label: '去打一局斗地主 →', run: () => onBattleAt('jingzhou') };
  const completedStarterOrders = starterOrders.filter((order) => order.done).length;
  useEffect(() => {
    if (!state.tutorialDone && completedStarterOrders === starterOrders.length) {
      onCompleteTutorial();
    }
  }, [completedStarterOrders, onCompleteTutorial, starterOrders.length, state.tutorialDone]);
  const visibleQuests = useMemo(() => {
    const ready = questStatuses.filter((quest) => quest.complete && !quest.claimed);
    const active = questStatuses.filter((quest) => !quest.claimed && !ready.includes(quest));
    const claimed = questStatuses.filter((quest) => quest.claimed);
    return [...ready, ...active, ...claimed];
  }, [questStatuses]);

  const choiceRef = useRef<HTMLElement | null>(null);
  const actionRef = useRef<HTMLElement | null>(null);
  const questRef = useRef<HTMLElement | null>(null);
  // 府中事件/伴侣心事直接弹窗，不再塞在页面中间等玩家自己往下找；可「稍后再说」，主按钮随时重新打开
  const choiceKey = state.pendingChoice ? `${state.pendingChoice.eventId}@${state.pendingChoice.day}` : '';
  const [choiceHiddenKey, setChoiceHiddenKey] = useState('');
  const choiceOpen = Boolean(state.pendingChoice) && choiceHiddenKey !== choiceKey;

  // 首页只留一张「下一步」卡，其余可做的事收进「还有 N 件」；目标与纪事收进底部弹层
  const [sheet, setSheet] = useState<'goals' | 'log' | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  // 告急条：反攻中 > 城防不满 > 失郡可半价收复（同时只显示一条，最急的那条）
  const siegeFief = SIEGE_ENABLED && state.siege ? fiefs.find((fief) => fief.id === state.siege?.fiefId && state.fiefs[fief.id]) ?? null : null;
  const wallAlertFief = SIEGE_ENABLED ? fiefs.find((fief) => state.fiefs[fief.id] && (state.fiefWalls[fief.id] ?? FIEF_WALLS) < FIEF_WALLS) ?? null : null;
  const reclaimFief = SIEGE_ENABLED ? fiefs.find((fief) => reclaimRemainingMs(state, fief.id, clock) > 0) ?? null : null;
  // 真实时间：府库「下一日约 N 分」、军令「下一道约 N 分」、告急倒计时都靠它刷新
  const needsClock = Boolean(siegeFief || reclaimFief) || realtime;
  useEffect(() => {
    if (!needsClock) return undefined;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), realtime ? 15000 : 60000);
    return () => window.clearInterval(timer);
  }, [needsClock, realtime]);
  // 状态一变（tick 推进了日子、收取了府库）就把显示用的时钟对齐，免得倒计时停在旧值
  useEffect(() => {
    if (realtime) setClock(Date.now());
  }, [realtime, state.clockAt, state.orderClockAt, state.treasury.days]);

  // 府中三件事：点「处理政务」先弹出今日三件事挑一件办；办完留在弹层里接着办下一日
  const [affairsOpen, setAffairsOpen] = useState(false);
  const [lastAffair, setLastAffair] = useState<{ title: string; amount: number; gain: string } | null>(null);
  // 真实时间：三件事按当日轮换、处置的是府库这一整笔；测试开关下仍是「下一日」的三件事
  const affairChoices = affairChoicesFor(realtime ? state.day : state.day + 1, state.homeLevel);
  const handleCollectIncome = (kind?: AffairKind) => {
    if (state.pendingChoice) {
      setAffairsOpen(false);
      setChoiceHiddenKey('');
      return;
    }
    if (realtime && !canCollect) return;
    if (!kind && !quickAffairs()) {
      setLastAffair(null);
      setAffairsOpen(true);
      return;
    }
    const chosenKind = kind ?? 'treasury';
    const chosen = affairChoices.find((item) => item.kind === chosenKind) ?? affairChoices[0];
    // 测试开关下每次只收 1 日，积不满 4 日，不练属性
    const { trains } = treasuryOutcome(state, chosenKind);
    const collectedDays = treasuryDays;
    const amount = onCollectIncome(chosenKind);
    const id = Date.now();
    onIncomeSfx();
    setLastAffair({ title: chosen.title, amount, gain: trains ? (chosenKind === 'military' ? '武力 +1' : '智谋、声望 +1') : '' });
    // 真实时间下一次收完府库就空了，弹层收起；测试开关下留着接着办下一日
    if (realtime) setAffairsOpen(false);
    setReport({ ...chosen, id, day: realtime ? state.day : state.day + 1, amount, days: realtime ? collectedDays : 0 });
    if (reportTimer.current !== null) window.clearTimeout(reportTimer.current);
    reportTimer.current = window.setTimeout(() => setReport(null), 3000);
    setFloating((items) => [...items, { id, amount }].slice(-3));
    window.setTimeout(() => setFloating((items) => items.filter((item) => item.id !== id)), 1500);
  };

  const handleUpgrade = () => {
    const target = nextHome;
    if (onUpgrade() && target) {
      onUpgradeEffect(target.imagePath, target.name);
    }
  };

  // 传位前府库会先按钱粮并入，传位提示按手上 + 府库算（与传位面板、reducer 实扣同一组函数）
  const heir = legacyPreview(state);
  // 机会栏：封郡 / 传位 / 志向未定 / 天下归心 等非阻塞选择合成一行，首屏只留真正要决断的事
  const claimable = questStatuses.filter((quest) => quest.complete && !quest.claimed).length;
  // 钱够就亮：比手上更强、买得起的兵器里最强的一把；屯田下一级
  const betterWeapon = weapons
    // 提升至少 8 点或一成才值得提示（曾推过 5,000 金只加 1 点武力的方天画戟）
    .filter((item) => !state.ownedWeaponIds.includes(item.id) && state.gold >= item.price && weaponBonusForLord(item, lord.id) - weaponBonusForLord(weapon, lord.id) >= Math.max(8, Math.round(weaponBonusForLord(weapon, lord.id) * 0.1)))
    .sort((a, b) => weaponBonusForLord(b, lord.id) - weaponBonusForLord(a, lord.id))[0] ?? null;
  const nextFarmLevel = farmLevels.find((farm) => farm.level === state.farmLevel + 1) ?? null;
  // 侯府以后的长线目标：王城与下一郡里更近的一个，显示还差多少（不可点，只是进度）
  const longGoals = [
    ...(state.homeLevel >= FIEF_UNLOCK_HOME_LEVEL && nextHome ? [{ name: nextHome.name, price: nextHome.upgradeCost }] : []),
    ...(state.homeLevel >= FIEF_UNLOCK_HOME_LEVEL && nextFiefToClaim ? [{ name: nextFiefToClaim.name, price: nextFiefCost }] : [])
  ].filter((goal) => state.gold < goal.price).sort((a, b) => a.price - b.price);
  const goalChip = longGoals.length > 0 ? [{ key: 'goal', label: `下一目标 · ${longGoals[0].name}`, detail: `还差 ${(longGoals[0].price - state.gold).toLocaleString()} 金`, onClick: undefined }] : [];
  const nextFarmCost = state.homeLevel >= 3 && nextFarmLevel ? realmFarmCost(state.realms, nextFarmLevel.cost) : null;
  const chances = [
    ...(state.tutorialDone && nextFarmCost !== null && state.gold >= nextFarmCost ? [{ key: 'farm', label: '可升西蜀屯田', detail: `${nextFarmCost.toLocaleString()} 金${state.homeLevel >= FIEF_UNLOCK_HOME_LEVEL && nextFiefToClaim && state.gold < nextFiefCost + nextFarmCost ? `，升后距${nextFiefToClaim.name}还差 ${(nextFiefCost - (state.gold - nextFarmCost)).toLocaleString()}` : ''}`, onClick: onOpenFarm }] : []),
    ...(state.tutorialDone && betterWeapon ? [{ key: 'weapon', label: `可购入${betterWeapon.name}`, detail: `${betterWeapon.price.toLocaleString()} 金，武力 +${weaponBonusForLord(betterWeapon, lord.id) - weaponBonusForLord(weapon, lord.id)}`, onClick: onOpenWeapon }] : []),
    ...(state.tutorialDone && Number.isFinite(cheapestPartner) && state.gold >= cheapestPartner && state.ownedPartnerIds.length < 10 ? [{ key: 'partner', label: '可再招一位伴侣', detail: `最便宜 ${cheapestPartner.toLocaleString()} 金`, onClick: onOpenPartner }] : []),
    ...goalChip,
    ...(claimable > 0 ? [{ key: 'claim', label: `可领赏 ${claimable} 项`, detail: '家业目标已达成', onClick: () => setSheet('goals') }] : []),
    ...(fiefAffordable && nextFiefToClaim ? [{ key: 'fief', label: `可攻${nextFiefToClaim.name}`, detail: `押 ${nextFiefCost.toLocaleString()} 金军资，和守将${nextFiefToClaim.garrison}打一局斗地主`, onClick: onOpenFief }] : []),
    // 传位（v3.1）：王城后能折到 1 点家业点，或志向已达成待领赏，就提示；只换主公、家业全留
    ...(state.homeLevel >= 6 && !isEndingReached(state) && (heir.gained >= 1 || ambition?.done)
      ? [{ key: 'succeed', label: heir.gained >= 1 ? `可传位换 ${heir.gained} 点家业点` : '可传位领志向之赏', detail: [state.treasury.gold > 0 ? `含府库未收 ${state.treasury.gold.toLocaleString()} 金` : '', heir.gained >= 1 ? `花 ${heir.spent.toLocaleString()} 金、余 ${heir.left.toLocaleString()} 金，收入 +${Math.round((legacyIncomeMultiplier(heir.after) - 1) * 100)}%` : '', ambition?.done ? `志向已达成，${[heir.rewardPoints > 0 ? `再得 ${heir.rewardPoints} 点` : '', heir.rewardGold > 0 ? `得 ${heir.rewardGold.toLocaleString()} 金` : ''].filter(Boolean).join('、')}` : ambition ? `志向还差 ${(ambition.target - ambition.progress).toLocaleString()} ${ambition.unit}` : '', '宅邸封地伴侣全留'].filter(Boolean).join('；'), onClick: onOpenSettings }]
      : []),
    ...(state.generation >= 2 && !state.ambition && ambitionOpen && ambitionDeferred ? [{ key: 'ambition', label: '本代志向未定', detail: '定下志向才有传位结算', onClick: () => setAmbitionDeferred(false) }] : []),
    // 离天下归心只差一样（六郡或王城）：首页直接告诉玩家
    ...(state.tutorialDone && endingHint(state) ? [{ key: 'maxed', label: '天下归心在望', detail: endingHint(state)!.replace(/。$/, ''), onClick: state.homeLevel >= FIEF_UNLOCK_HOME_LEVEL && ownedFiefCount(state.fiefs) < 6 ? onOpenFief : undefined }] : []),
    ...(isEndingReached(state) && endingSeen ? [{ key: 'ending', label: '天下归心', detail: '展开卷轴开创新朝', onClick: onOpenEnding }] : [])
  ];
  // 下一步按轻重排：终局 > 天下归心在望 > 领赏 > 传位 > 封郡 > 屯田 > 兵器 > 伴侣 > 志向 > 长线目标（长线目标不可点，只作进度）
  const CHANCE_ORDER = ['ending', 'maxed', 'claim', 'succeed', 'fief', 'farm', 'weapon', 'partner', 'ambition', 'goal'];
  const sortedChances = [...chances].sort((a, b) => CHANCE_ORDER.indexOf(a.key) - CHANCE_ORDER.indexOf(b.key));
  const [topChance, ...moreChances] = sortedChances;
  const ownedFiefs = ownedFiefCount(state.fiefs);
  const latestLog = state.eventLog[0];
  const canRecruit = Number.isFinite(cheapestPartner) && state.gold >= cheapestPartner && state.ownedPartnerIds.length < 10;
  const battleDot = Boolean(siegeFief) || state.orders >= orderCap;
  const incomeDetail = `宅邸 ${currentHome.dailyIncome} 金${farmPercent > 0 ? `，西蜀屯田 +${farmFlat} 金且 +${farmPercent}%` : ''}${fiefIncomePercent(state.fiefs) > 0 ? `，劝农封地 +${fiefIncomePercent(state.fiefs)}%` : ''}${realmIncomePercent(state.realms) > 0 ? `，国号蜀 +${realmIncomePercent(state.realms)}%` : ''}${titleBonuses(state).incomePct > 0 ? `，称号 +${titleBonuses(state).incomePct}%` : ''}${state.legacyPoints > 0 ? `，家业点 +${state.legacyPoints * 5}%` : ''}，智谋加成 +${Math.floor(intelligence / 10)}%${state.incomeBuff && state.day < state.incomeBuff.untilDay ? `，减税招商 +${state.incomeBuff.percent}% 至第 ${state.incomeBuff.untilDay} 日` : ''}`;

  return (
    <main className="screen home-screen home-v2">
      <header className="home-hud">
        <button type="button" className="home-hud__lord" onClick={onOpenLord} aria-label={`查看${lord.name}`}>
          <ImageWithFallback src={imageUrl(lord.imagePath, 96)} alt={lord.name} className="home-hud__avatar" loading="eager" />
          <div>
            <strong>{lord.name}<em className="home-hud__honor" title={titleStatus.next ? `下一称号「${titleStatus.next.name}」：${titleStatus.next.requirement}` : titleStatus.missing > 0 ? `已是最高称号，另有 ${titleStatus.missing} 个称号待集齐` : '称号已集齐'}>「{titleStatus.current.name}」</em></strong>
            <span>{lord.title}{dynastyCount(state.realms) > 0 ? ` · ${state.realm ? `${findRealm(state.realm)?.name} · ` : ''}第 ${dynastyCount(state.realms) + 1} 朝` : ''}{state.generation > 1 ? ` · 第 ${state.generation} 代` : ''}</span>
            {(tradition || (ambition && ambitionOpen)) && (
              <em className="home-hud__ambition" title={tradition?.effect}>{[tradition?.name, ambition && ambitionOpen ? `志向 ${ambition.ambition.name} ${ambition.done ? '已达成' : `${ambition.progress.toLocaleString()}/${ambition.target.toLocaleString()}`}` : null].filter(Boolean).join(' · ')}</em>
            )}
          </div>
        </button>
        <button className="sound-toggle sound-toggle--inset" onClick={onOpenSettings} aria-label="设置与存档" title="设置与存档">
          设
        </button>
        <div className="home-hud__chips">
          <div>
            <strong title={`${state.gold.toLocaleString()} 金`}>{compactGold(state.gold)}</strong>
            <span>金</span>
          </div>
          <div>
            <strong>{totalPower}</strong>
            <span>武力</span>
          </div>
          <div className="home-hud__orders">
            <strong>{state.orders}/{orderCap}</strong>
            <span title="每场出征耗 1 道军令（守城、切磋除外）；府邸前约 20 分钟回 1 道，府邸起约 2 小时回 1 道">{realtime && orderWait ? `下一道${orderWait}` : '军令'}</span>
          </div>
          <div className="home-hud__days" title={`开府 ${openDays} 天（第 ${state.day} 日）`}>
            <strong>{openDays} 天</strong>
            <span>第 {state.day} 日</span>
          </div>
        </div>
      </header>

      {siegeFief && state.siege ? (
        <div className="frontier-alert siege-alert is-besieged" role="status">
          <span>{siegeFief.name.replace(/郡$/, '')}告急 · {state.siege.attacker}卷土重来 · {formatRemaining(Math.max(0, state.siege.dueAt - clock))}{(state.fiefWalls[siegeFief.id] ?? FIEF_WALLS) < FIEF_WALLS ? ' · 城防仅余 1，再失手即失郡' : ''}</span>
          <button type="button" onClick={() => onOpenSiege?.(siegeFief.id)}>去守城 →</button>
        </div>
      ) : wallAlertFief ? (
        <div className="frontier-alert siege-alert is-wall" role="status">
          <span>{wallAlertFief.name.replace(/郡$/, '')}城防告急，郡中特权暂停 → 修城 / 等下次守住</span>
          <button type="button" onClick={() => onOpenSiege?.(wallAlertFief.id)}>去修城 →</button>
        </div>
      ) : reclaimFief ? (
        <div className="frontier-alert siege-alert is-lost" role="status">
          <span>{reclaimFief.name.replace(/郡$/, '')}暂归{reclaimFief.garrison} · {formatRemaining(reclaimRemainingMs(state, reclaimFief.id, clock))}内可半价收复</span>
          <button type="button" onClick={() => onOpenSiege?.(reclaimFief.id)}>去收复 →</button>
        </div>
      ) : null}

      <section className="home-banner" aria-label="主城">
        <ImageWithFallback src={imageUrl(currentHome.imagePath, 512)} alt={currentHome.name} className="home-banner__image" loading="eager" />
        <HomeHonors state={state} />
        <div className="income-floats">
          {floating.map((item) => (
            <span key={item.id}>+{item.amount}金</span>
          ))}
        </div>
        {report && (
          <div key={report.id} className="affair-report" role="status">
            <span>{report.days > 0 ? `收取府库 · 积 ${report.days} 日` : `第 ${report.day} 日 · 今日政务`}</span>
            <strong>{report.title}<b>+{report.amount.toLocaleString()} 金</b></strong>
            <small>{report.detail}</small>
          </div>
        )}
        <div className="home-banner__text">
          <h2>Lv.{currentHome.level} {currentHome.name}</h2>
          <details className="home-banner__detail">
            <summary>{realtime ? `每日政务 +${dailyIncome.toLocaleString()} 金（1 小时 1 日）` : `每次政务 +${dailyIncome.toLocaleString()} 金`} ⓘ</summary>
            <p>{incomeDetail}；声望让招募伴侣便宜 {recruitDiscount}%。</p>
          </details>
        </div>
        <div className="home-banner__stats" aria-label="属性">
          <span>武力 <b>{totalPower}</b></span>
          <span>智谋 <b>{intelligence}</b></span>
          <span>声望 <b>{charisma}</b></span>
        </div>
      </section>

      {!state.tutorialDone && currentOrder && (
        <section className="starter-panel" aria-label="开局引导">
          <div className="section-title">
            <span>开局引导 · 第 {starterOrders.indexOf(currentOrder) + 1} 步 / {starterOrders.length}</span>
            <button type="button" className="starter-skip" onClick={onCompleteTutorial}>跳过引导</button>
          </div>
          {starterOrders.indexOf(currentOrder) < 2 && (
            <ol className="starter-howto" aria-label="怎么玩">
              <li><b>赚钱</b>：{realtime ? '宅邸每小时把一日收入积进府库，回来点「收取府库」入账。' : '点「处理政务」过一天，宅邸给你收入。'}</li>
              <li><b>变强</b>：用金币升宅邸、招伴侣、买兵器。</li>
              <li><b>出征</b>：战力够了去打仗，缴获比政务多得多。</li>
            </ol>
          )}
          <div className="starter-step">
            <strong>这一步：{currentOrder.label}</strong>
            <p>{guideReason}</p>
            {guideAction && (
              <button type="button" className="starter-do" onClick={guideAction.run}>{guideAction.label}</button>
            )}
          </div>
          <div className="starter-progress" aria-label="引导进度">
            {starterOrders.map((order) => (
              <span key={order.label} className={order.done ? 'is-done' : order === currentOrder ? 'is-current' : ''}>
                {order.done ? '✓' : order === currentOrder ? '●' : '○'} {order.label}
              </span>
            ))}
          </div>
        </section>
      )}

      {state.pendingChoice && choiceOpen && (() => {
        const event = resolvePendingEvent(state.pendingChoice);
        if (!event) return null;
        const partner = event.id.startsWith('partner:') ? partners.find((item) => item.id === partnerIdOfKey(event.id.slice('partner:'.length))) : event.id.startsWith('minor:') ? partners.find((item) => item.id === event.id.split(':')[2]) : null;
        return (
          <div className="modal-backdrop choice-modal">
          <section ref={choiceRef} role="dialog" aria-modal="true" className={`choice-card ${partner ? 'choice-card--partner' : ''}`} aria-label={event.id.startsWith('minor:') ? '府中小事' : partner ? '伴侣心事' : '府中事件'}>
            <em className="choice-card__eyebrow">府中来报 · 请主公定夺</em>
            {partner && <ImageWithFallback src={imageUrl(partner.imagePath, 160)} alt={partner.name} className="choice-card__portrait" />}
            <span>第 {state.pendingChoice.day} 日 · {partner ? `${partner.name} · ` : ''}{event.title}</span>
            <strong>{event.prompt}</strong>
            <div className="choice-card__options">
              {event.options.map((option) => (
                <button key={option.id} type="button" onClick={() => onResolveChoice(option.id)}>
                  <strong>{option.label}</strong>
                  <small>{option.detail}</small>
                  {/* 练兵之策不叠加：已有一次翻倍待用时提醒，免得白白放弃现钱 */}
                  {option.id === 'battleBonus' && state.nextBattleBonus && state.nextBattleBonus > 1 && (
                    <small className="choice-card__warn" style={{ color: '#ffb38a' }}>已有一次翻倍待用，再选不叠加</small>
                  )}
                </button>
              ))}
            </div>
            {/* 心事了却后伴侣的牌桌技能升一重（属性 +6 照旧） */}
            {partner && event.id.startsWith('partner:') && skillUpgradeCopy(partner.id, partnerSkillLevel(partner.id, state)) && (
              <p className="choice-card__skill-up">了却心事，{skillUpgradeCopy(partner.id, partnerSkillLevel(partner.id, state))}</p>
            )}
            <button type="button" className="choice-card__later" onClick={() => setChoiceHiddenKey(choiceKey)}>稍后再说</button>
          </section>
          </div>
        );
      })()}

      {affairsOpen && !state.pendingChoice && (
        <div className="modal-backdrop choice-modal affairs-modal">
          <section role="dialog" aria-modal="true" aria-label="府中三件事" className="choice-card affairs-card">
            <em className="choice-card__eyebrow">{realtime ? `府库积 ${treasuryDays} 日 · 府中三件事 · 挑一件处置这一笔` : `第 ${state.day + 1} 日 · 府中三件事 · 挑一件去办`}</em>
            {lastAffair && (
              <p className="affairs-card__done" role="status">
                刚办完「{lastAffair.title}」+{lastAffair.amount.toLocaleString()} 金{lastAffair.gain ? ` · ${lastAffair.gain}` : ''}
              </p>
            )}
            <div className="choice-card__options affairs-card__options">
              {affairChoices.map((item) => {
                // 真实时间：处置府库这一整笔——钱粮全额；军务/治理积满 4 日才练（少拿 1 日收入），不满 4 日或练满按全额
                // 测试开关下每次只推进 1 日：同一套规则，积不满 4 日，不练属性
                const outcome = realtime ? treasuryOutcome(state, item.kind) : { ...treasuryOutcome({ ...state, treasury: { gold: dailyIncome, days: 1 } }, item.kind), gold: dailyIncome };
                const { gold, trains, trainable } = outcome;
                const trained = item.kind === 'military' ? state.affairTraining.strength : state.affairTraining.civil;
                const statName = item.kind === 'military' ? '武力' : '智谋、声望';
                const gain = item.kind === 'treasury'
                  ? realtime ? '全额入账' : '足额政务收入'
                  : trains
                    ? `少拿 1 日 · ${statName} +1（本代 ${trained}/${AFFAIR_TRAINING_CAP}）`
                    : trainable
                      ? `积满 ${TRAIN_MIN_DAYS} 日才练${item.kind === 'military' ? '武力' : '智谋声望'}，此番全额`
                      : `${item.kind === 'military' ? '武力' : '智谋声望'}已练满，按全额给金`;
                return (
                  <button key={item.kind} type="button" className={`affairs-option affairs-option--${item.kind}`} onClick={() => handleCollectIncome(item.kind)}>
                    <span className="affairs-option__tag">{AFFAIR_KIND_LABEL[item.kind]}</span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                    <b>+{gold.toLocaleString()} 金 · {gain}</b>
                  </button>
                );
              })}
            </div>
            <button type="button" className="choice-card__later" onClick={() => setAffairsOpen(false)}>回府</button>
          </section>
        </div>
      )}

      {state.tutorialDone && isEndingReached(state) && !endingSeen && (
        <section className="succession-hint ending-hint" aria-label="天下归心">
          <strong>天下归心</strong>
          <span>六郡尽归、王城巍峨。可开创新朝：定一国号，加成永久保留，历朝叠加。</span>
          <button type="button" onClick={() => { markEndingSeen(); onOpenEnding(); }}>展开卷轴 →</button>
        </section>
      )}

      {state.generation >= 2 && !state.ambition && ambitionOpen && !ambitionDeferred && (
        <section className="ambition-card" aria-label="本代志向">
          <div className="section-title">
            <span>第 {state.generation} 代 · 本代志向</span>
            <strong>三选一，传位时结算</strong>
          </div>
          <p className="starter-hint">先祖已留下家业，这一代要做成什么？达成者载入家谱，传位时得 {heir.ambitionPoints} 点家业点{state.legacyPoints >= LEGACY_MAX_POINTS ? `（家业点已满，改得 ${(AMBITION_FULL_GOLD * heir.ambitionPoints).toLocaleString()} 金）` : ''}；累计三代达成得家声「家学渊源」。</p>
          <div className="ambition-options">
            {availableAmbitions(state).map((item) => {
              const preview = ambitionPreview(item, state);
              return (
                <button key={item.id} type="button" onClick={() => onChooseAmbition(item.id)}>
                  <strong>{item.name}</strong>
                  <span>{preview.text}</span>
                  <small>{candidate === item.id ? '上一代刚达成，再成一次即立家风 · ' : ''}{preview.hint}</small>
                </button>
              );
            })}
          </div>
          <div className="starter-actions">
            <button type="button" onClick={deferAmbition}>稍后再定</button>
          </div>
        </section>
      )}

      {state.tutorialDone && topChance && (
        <section className="chance-bar next-step" aria-label="下一步">
          <button type="button" className={`next-step__main ${topChance.onClick ? '' : 'is-static'}`} onClick={topChance.onClick} disabled={!topChance.onClick}>
            <span className="next-step__tag">下一步</span>
            <span className="next-step__body">
              <strong>{topChance.label}</strong>
              {topChance.detail && <span>{topChance.detail}</span>}
            </span>
            {topChance.onClick && <span className="next-step__go" aria-hidden="true">›</span>}
          </button>
          {moreChances.length > 0 && (
            <>
              <button type="button" className="next-step__more" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
                {moreOpen ? '收起' : `还有 ${moreChances.length} 件可做 ▾`}
              </button>
              <div className="next-step__list" hidden={!moreOpen}>
                {moreChances.map((item) => (
                  <button key={item.key} type="button" onClick={item.onClick} disabled={!item.onClick}>
                    <strong>{item.label}</strong>
                    {item.detail && <span>{item.detail}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <section className="home-actions" ref={actionRef}>
        <div className="home-actions__collect">
          <GameButton
            onClick={() => handleCollectIncome()}
            disabled={realtime && !state.pendingChoice && !canCollect}
            className={`home-actions__main ${state.pendingChoice ? 'is-guided' : guided('income')} ${realtime && treasuryFull && !state.pendingChoice ? 'is-full' : ''}`}
          >
            {state.pendingChoice
              ? '府中来报 · 去定夺'
              : !realtime
                ? `处理政务 · +${dailyIncome.toLocaleString()}金`
                : canCollect
                  ? (<><span className="treasury-label">收取府库</span> <span className="treasury-amount">+{state.treasury.gold.toLocaleString()}金</span><small className="game-button__sub">积 {treasuryDays} 日</small></>)
                  : (<>收取府库<small className="game-button__sub">下一日{nextDayWait}后</small></>)}
            {realtime && treasuryFull && !state.pendingChoice && <i className="home-dot treasury-dot" aria-hidden="true" />}
          </GameButton>
          {realtime && (
            <div className={`treasury-meter ${treasuryFull ? 'is-full' : ''} ${treasuryHard ? 'is-hard' : ''}`} role="progressbar" aria-label="府库积存" aria-valuemin={0} aria-valuemax={treasuryCap} aria-valuenow={Math.min(treasuryDays, treasuryCap)}>
              <span className="treasury-meter__bar"><i style={{ width: `${Math.min(100, (treasuryDays / treasuryCap) * 100)}%` }} /></span>
              <span className="treasury-meter__text">
                {treasuryHard
                  ? `府库积满 ${TREASURY_HARD_CAP_DAYS} 日 · 不再积存`
                  : treasuryFull
                    ? `府库 ${treasuryDays} 日（满额 ${treasuryCap}）· 再放减半`
                    : `府库 ${treasuryDays}/${treasuryCap} 日 · 下一日${nextDayWait}后`}
              </span>
            </div>
          )}
        </div>
        <GameButton variant="secondary" onClick={handleUpgrade} disabled={!canUpgrade} className={guided('upgrade')}>
          {nextHome ? (<>升级宅邸<small className="game-button__sub">{nextHome.upgradeCost.toLocaleString()} 金{!canUpgrade ? ` · 差 ${(nextHome.upgradeCost - state.gold).toLocaleString()}` : ''}</small></>) : '宅邸已满'}
        </GameButton>
      </section>

      <nav className="home-tiles" aria-label="家业">
        <button type="button" onClick={() => setSheet('goals')}>
          <span>家业目标</span>
          <strong>{claimable > 0 ? `${claimable} 项可领` : `${questStatuses.filter((quest) => quest.claimed).length}/${questStatuses.length}`}</strong>
          {claimable > 0 && <i className="home-dot" aria-hidden="true" />}
        </button>
        <button type="button" onClick={() => setSheet('log')}>
          <span>府中纪事</span>
          <strong>{latestLog ? latestLog.title : '暂无'}</strong>
        </button>
        {state.homeLevel >= 3 && (
          <button type="button" onClick={onOpenFief}>
            <span>封地</span>
            <strong>{ownedFiefs > 0 ? `${ownedFiefs}/${fiefs.length} 郡` : state.homeLevel >= FIEF_UNLOCK_HOME_LEVEL ? '可开拓' : '侯府开放'}</strong>
            {fiefAffordable && <i className="home-dot" aria-hidden="true" />}
          </button>
        )}
      </nav>

      <nav className="home-tabbar" aria-label="主城导航">
        <button type="button" className="is-active" aria-current="page">
          <span>家业</span>
        </button>
        <button type="button" onClick={onBattle} className={guided('battle')}>
          <span>出征</span>
          {battleDot && <i className="home-dot" aria-hidden="true" />}
        </button>
        <button type="button" onClick={onOpenPartner} className={guided('partner')}>
          <span>伴侣</span>
          {state.tutorialDone && canRecruit && <i className="home-dot" aria-hidden="true" />}
        </button>
        <button type="button" onClick={onOpenWeapon} className={guided('weapon')}>
          <span>兵器</span>
          {state.tutorialDone && betterWeapon && <i className="home-dot" aria-hidden="true" />}
        </button>
        <button type="button" onClick={onOpenLord}>
          <span>主公</span>
        </button>
      </nav>

      {sheet === 'goals' && (
        <ModalShell title="家业目标" onClose={() => setSheet(null)}>
          <section className="quest-panel" ref={questRef}>
            <div className="section-title">
              <span>已领 {questStatuses.filter((quest) => quest.claimed).length}/{questStatuses.length}</span>
              {claimable > 1 && <button type="button" className="quest-claim-all" onClick={() => claimableQuests.forEach((quest) => onClaimQuest(quest.id))}>全部领取 +{claimableGold.toLocaleString()} 金</button>}
            </div>
            {ambition && ambitionOpen && (
              <p className="ambition-progress">本代志向「{ambition.ambition.name}」：{ambition.text}，现 {ambition.progress.toLocaleString()} {ambition.unit}{ambition.done ? '，已达成，传位即载入家谱' : ''}。</p>
            )}
            {endingHint(state) && <p className="ambition-progress legacy-maxed-hint">{endingHint(state)}</p>}
            <p className="honor-hint">
              当前称号「{titleStatus.current.name}」{titleStatus.next ? `，${titleStatus.next.requirement}可得「${titleStatus.next.name}」` : titleStatus.missing > 0 ? `，已是本代最高称号，另有 ${titleStatus.missing} 个称号待集齐（点头像查看）` : '，本代称号已集齐'}。
            </p>
            <div className="quest-list">
              {visibleQuests.map((quest) => (
                <article key={quest.id} className={`quest-item ${quest.complete ? 'is-complete' : ''} ${quest.claimed ? 'is-claimed' : ''}`}>
                  <div>
                    <strong>{quest.title}</strong>
                    <span>{quest.description}</span>
                  </div>
                  {quest.claimed ? (
                    <em>已领</em>
                  ) : quest.complete ? (
                    <button onClick={() => onClaimQuest(quest.id)}>领赏</button>
                  ) : (
                    <em>{quest.id === 'power-200' ? `${totalPower}/180 · ` : ''}{quest.rewardGold.toLocaleString()}金</em>
                  )}
                </article>
              ))}
            </div>
            <p className="home-record">战绩：胜 {state.battleWins}（牌局与攻郡 {state.battleWins - state.frontierWins} · 守城 {state.frontierWins}）· 负 {state.battleLosses}</p>
          </section>
        </ModalShell>
      )}

      {sheet === 'log' && (
        <ModalShell title="府中纪事" onClose={() => setSheet(null)}>
          <section className="event-panel">
            <div className="event-list">
              {state.eventLog.length === 0 ? (
                <p>尚无纪事，经营数日后会有府中回报。</p>
              ) : (
                state.eventLog.slice(0, 12).map((event) => (
                  <article key={event.id}>
                    <span>第 {event.day} 日 · {event.title}</span>
                    <p>{event.detail}{event.goldDelta ? ` ${event.goldDelta > 0 ? '+' : '−'}${Math.abs(event.goldDelta).toLocaleString()}金` : ''}</p>
                  </article>
                ))
              )}
            </div>
          </section>
        </ModalShell>
      )}
    </main>
  );
}

/** 「稍后再定」志向：只在本次打开页面内有效（记哪一代推迟过；刷新即清） */
let ambitionDeferredGen: number | null = null;

/** 测试用：设了这个开关，「处理政务」不弹三件事，直接办钱粮 */
const AFFAIR_QUICK_KEY = 'jiaye-affair-quick';
function quickAffairs() {
  try {
    return window.localStorage.getItem(AFFAIR_QUICK_KEY) === '1';
  } catch {
    return false;
  }
}
