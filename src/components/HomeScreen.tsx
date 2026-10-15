import { useEffect, useMemo, useRef, useState } from 'react';
import type { HomeLevel, Lord, Partner, Weapon } from '../data/gameData';
import type { QuestStatus } from '../data/progression';
import { imageUrl } from '../lib/assets';
import { bestValueTierIndex, enemyForTier, legacyIncomeMultiplier, legacyPointsGainable, ROSTERS, safeTierIndex, weaponBonusForLord } from '../lib/battle';
import { formatRemaining, raidRemainingMs } from '../lib/frontier';
import { resolvePendingEvent } from '../data/progression';
import { partners } from '../data/gameData';
import { partnerIdOfKey } from '../data/partnerEvents';
import type { GameState } from '../types';
import { ambitionStatus, availableAmbitions, type AmbitionId } from '../data/ambitions';
import { bountyScale, dynastyCount, endingHint, findRealm, isEndingReached, legacyMaxedHint, realmIncomePercent } from '../data/dynasty';
import { daysUntilNextOrder } from '../types';
import { farmLevels, weapons } from '../data/gameData';
import { realmFarmCost } from '../data/dynasty';
import { fiefCostFor, legacyGoldPerPointFor, traditionCandidate, traditionOf } from '../data/traditions';
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
  /** 带预选区域进出征地图（边患告警进北疆、引导出征进官道） */
  onBattleAt: (region: RegionId) => void;
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
  const [report, setReport] = useState<(Affair & { id: number; day: number; amount: number }) | null>(null);
  const reportTimer = useRef<number | null>(null);
  const ambition = ambitionStatus(state);
  // 家业点已满：传位不再可行，志向无从结算，志向卡/进度改提示还差几郡
  const maxedHint = legacyMaxedHint(state);
  const ambitionOpen = !isEndingReached(state) && !maxedHint;
  // 「稍后再定」只记在本次会话里，刷新后再提醒一次
  const [ambitionDeferred, setAmbitionDeferred] = useState(() => {
    try { return window.sessionStorage.getItem('jiaye-ambition-deferred') === String(state.generation); } catch { return false; }
  });
  const [endingSeen, setEndingSeen] = useState(() => {
    try { return window.sessionStorage.getItem('jiaye-ending-seen') === String(state.pastDynasties.length); } catch { return false; }
  });
  const markEndingSeen = () => {
    setEndingSeen(true);
    try { window.sessionStorage.setItem('jiaye-ending-seen', String(state.pastDynasties.length)); } catch { /* 无存储也能用 */ }
  };
  const deferAmbition = () => {
    setAmbitionDeferred(true);
    try { window.sessionStorage.setItem('jiaye-ambition-deferred', String(state.generation)); } catch { /* 无存储也能用 */ }
  };
  const nextFiefToClaim = nextFief(state.fiefs);
  const nextFiefCost = nextFiefToClaim ? fiefCostFor(state, nextFiefToClaim) : 0;
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
      { label: '升级木屋', done: state.homeLevel >= 2, target: 'upgrade' as const, hint: nextHome && state.gold < nextHome.upgradeCost ? `先点「处理政务」攒到 ${nextHome.upgradeCost.toLocaleString()} 金，再升级宅邸。` : '点「升级宅邸」把茅草屋升成木屋，收入翻三倍。' },
      { label: '招募伴侣', done: state.ownedPartnerIds.length >= 2, target: 'partner' as const, hint: state.gold < cheapestPartner ? '金币不够招人：先领上方任务奖励或点「处理政务」攒钱，再去「招募伴侣」请一位入府。' : '去「招募伴侣」再请一位入府，伴侣直接加战力、智谋或声望。' },
      { label: '换一把兵器', done: state.equippedWeaponId !== 'xuanjian', target: 'weapon' as const, hint: '攒 1,500 金去「兵器库」买把青釭剑或双股剑。第 5 日伴侣会来说心事，了却后任务「良缘佳话」正好奖 1,500 金。' },
      { label: '初战告捷', done: state.battleWins >= 1, target: 'battle' as const, hint: '点「出征讨伐」，到官道挑一个推荐对手打一场，缴获比处理政务多得多。' }
    ],
    [cheapestPartner, nextHome, state.battleWins, state.equippedWeaponId, state.gold, state.homeLevel, state.ownedPartnerIds.length]
  );
  const currentOrder = starterOrders.find((order) => !order.done) ?? null;
  // 官道一场推荐对手的缴获（与出征地图同口径：没赢过用高胜率档，否则用性价比档；含今日军功与练兵之策）
  const landTier = state.battleWins === 0 ? safeTierIndex(ROSTERS.land, totalPower) : bestValueTierIndex(ROSTERS.land, totalPower);
  const landFightGold = Math.round(enemyForTier(ROSTERS.land, landTier, totalPower).rewardGold * (state.nextBattleBonus && state.nextBattleBonus > 1 ? state.nextBattleBonus : 1) * bountyScale(state.day, 'land'));
  // 第 3 步买兵器差钱时，有军令就去官道打一场，别让新人连点二十多天政务干等
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
      ? `${currentHome.name}升成${nextHome?.name ?? ''}，每次政务收入从 ${currentHome.dailyIncome} 金涨到 ${nextHome?.dailyIncome ?? ''} 金。`
      : currentOrder.target === 'partner'
        ? '伴侣入府直接加武力、智谋或声望，最便宜的一位 ' + (Number.isFinite(cheapestPartner) ? cheapestPartner.toLocaleString() : '') + ' 金。'
        : currentOrder.target === 'weapon'
          ? `换一把好兵器，武力立刻上涨，出征胜率更高。青釭剑或双股剑 1,500 金。${weaponViaBattle ? `还差 ${shortOf.toLocaleString()} 金：去官道打一场推荐对手，胜可缴获约 ${landFightGold.toLocaleString()} 金，${landFightGold >= shortOf ? '一场就够' : `约 ${Math.ceil(shortOf / landFightGold)} 场凑齐`}。` : ''}`
          : '去官道挑「推荐」的对手打一场，赢了缴获远多于政务收入。';
  const guideAction: { label: string; run: () => void } | null = !currentOrder
    ? null
    : shortOf > 0 && claimableGold > 0
      ? { label: `先领任务奖励 +${claimableGold.toLocaleString()} 金`, run: () => claimableQuests.forEach((quest) => onClaimQuest(quest.id)) }
      : weaponViaBattle
        ? { label: '去出征赚钱 →', run: () => onBattleAt('guandao') }
      : shortOf > 0
        ? { label: `过一天 · +${dailyIncome.toLocaleString()} 金（还差 ${shortOf.toLocaleString()}）`, run: () => handleCollectIncome() }
        : currentOrder.target === 'upgrade'
          ? { label: `立即升级 · ${(nextHome?.upgradeCost ?? 0).toLocaleString()} 金`, run: () => handleUpgrade() }
          : currentOrder.target === 'partner'
            ? { label: '去招募伴侣 →', run: onOpenPartner }
            : currentOrder.target === 'weapon'
              ? { label: '去兵器库 →', run: onOpenWeapon }
              : { label: '去出征 →', run: () => onBattleAt('guandao') };
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

  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!state.frontierRaid) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, [state.frontierRaid]);

  // 府中三件事：点「处理政务」先弹出今日三件事挑一件办；办完留在弹层里接着办下一日
  const [affairsOpen, setAffairsOpen] = useState(false);
  const [lastAffair, setLastAffair] = useState<{ title: string; amount: number; gain: string } | null>(null);
  const affairChoices = affairChoicesFor(state.day + 1, state.homeLevel);
  const handleCollectIncome = (kind?: AffairKind) => {
    if (state.pendingChoice) {
      setAffairsOpen(false);
      setChoiceHiddenKey('');
      return;
    }
    if (!kind && !quickAffairs()) {
      setLastAffair(null);
      setAffairsOpen(true);
      return;
    }
    const chosenKind = kind ?? 'treasury';
    const chosen = affairChoices.find((item) => item.kind === chosenKind) ?? affairChoices[0];
    const { trains } = affairOutcome(chosenKind, dailyIncome, state.affairTraining);
    const amount = onCollectIncome(chosenKind);
    const id = Date.now();
    onIncomeSfx();
    setLastAffair({ title: chosen.title, amount, gain: trains ? (chosenKind === 'military' ? '武力 +1' : '智谋、声望 +1') : '' });
    setReport({ ...chosen, id, day: state.day + 1, amount });
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
    ...(state.homeLevel >= FIEF_UNLOCK_HOME_LEVEL && nextHome ? [{ name: nextHome.name, cost: nextHome.upgradeCost }] : []),
    ...(state.homeLevel >= FIEF_UNLOCK_HOME_LEVEL && nextFiefToClaim ? [{ name: nextFiefToClaim.name, cost: nextFiefCost }] : [])
  ].filter((goal) => state.gold < goal.cost).sort((a, b) => a.cost - b.cost);
  const goalChip = longGoals.length > 0 ? [{ key: 'goal', label: `下一目标 · ${longGoals[0].name}`, detail: `还差 ${(longGoals[0].cost - state.gold).toLocaleString()} 金`, onClick: undefined }] : [];
  const nextFarmCost = state.homeLevel >= 3 && nextFarmLevel ? realmFarmCost(state.realms, nextFarmLevel.cost) : null;
  const chances = [
    ...(state.tutorialDone && nextFarmCost !== null && state.gold >= nextFarmCost ? [{ key: 'farm', label: '可升西蜀屯田', detail: `${nextFarmCost.toLocaleString()} 金${state.homeLevel >= FIEF_UNLOCK_HOME_LEVEL && nextFiefToClaim && state.gold < nextFiefCost + nextFarmCost ? `，升后距${nextFiefToClaim.name}还差 ${(nextFiefCost - (state.gold - nextFarmCost)).toLocaleString()}` : ''}`, onClick: onOpenFarm }] : []),
    ...(state.tutorialDone && betterWeapon ? [{ key: 'weapon', label: `可购入${betterWeapon.name}`, detail: `${betterWeapon.price.toLocaleString()} 金，武力 +${weaponBonusForLord(betterWeapon, lord.id) - weaponBonusForLord(weapon, lord.id)}`, onClick: onOpenWeapon }] : []),
    ...(state.tutorialDone && Number.isFinite(cheapestPartner) && state.gold >= cheapestPartner && state.ownedPartnerIds.length < 10 ? [{ key: 'partner', label: '可再招一位伴侣', detail: `最便宜 ${cheapestPartner.toLocaleString()} 金`, onClick: onOpenPartner }] : []),
    ...goalChip,
    ...(claimable > 0 ? [{ key: 'claim', label: `可领赏 ${claimable} 项`, detail: '家业目标已达成', onClick: () => setSheet('goals') }] : []),
    ...(fiefAffordable && nextFiefToClaim ? [{ key: 'fief', label: `可开拓${nextFiefToClaim.name}`, detail: `${nextFiefCost.toLocaleString()} 金，余 ${(state.gold - nextFiefCost).toLocaleString()}`, onClick: onOpenFief }] : []),
    ...(state.homeLevel >= 6 && state.gold >= 100000 && state.legacyPoints < 20 && !isEndingReached(state)
      ? [{ key: 'succeed', label: `可传位换 ${legacyPointsGainable(state.gold, state.legacyPoints, legacyGoldPerPointFor(state))} 点家业点`, detail: [endingHint(state)?.replace(/。$/, '') ?? `下一代收入 +${Math.round((legacyIncomeMultiplier(Math.min(20, state.legacyPoints + legacyPointsGainable(state.gold, state.legacyPoints, legacyGoldPerPointFor(state)))) - 1) * 100)}%、开局 ${(1000 + Math.min(20, state.legacyPoints + legacyPointsGainable(state.gold, state.legacyPoints, legacyGoldPerPointFor(state))) * 3000).toLocaleString()} 金`, ambition && !ambition.done ? `志向还差 ${(ambition.target - ambition.progress).toLocaleString()} ${ambition.ambition.unit}` : ''].filter(Boolean).join('；'), onClick: onOpenSettings }]
      : []),
    ...(state.generation >= 2 && !state.ambition && ambitionOpen && ambitionDeferred ? [{ key: 'ambition', label: '本代志向未定', detail: '定下志向才有传位结算', onClick: () => setAmbitionDeferred(false) }] : []),
    // 家业点已满：传位不再加点，首页直接告诉玩家离天下归心还差什么
    ...(state.tutorialDone && maxedHint ? [{ key: 'maxed', label: '天下归心在望', detail: maxedHint.replace(/。$/, ''), onClick: state.homeLevel >= FIEF_UNLOCK_HOME_LEVEL ? onOpenFief : undefined }] : []),
    ...(isEndingReached(state) && endingSeen ? [{ key: 'ending', label: '天下归心', detail: '展开卷轴开创新朝', onClick: onOpenEnding }] : [])
  ];
  // 下一步按轻重排：终局 > 家业点满差几郡 > 领赏 > 传位 > 封郡 > 屯田 > 兵器 > 伴侣 > 志向 > 长线目标（长线目标不可点，只作进度）
  const CHANCE_ORDER = ['ending', 'maxed', 'claim', 'succeed', 'fief', 'farm', 'weapon', 'partner', 'ambition', 'goal'];
  const sortedChances = [...chances].sort((a, b) => CHANCE_ORDER.indexOf(a.key) - CHANCE_ORDER.indexOf(b.key));
  const [topChance, ...moreChances] = sortedChances;
  const ownedFiefs = ownedFiefCount(state.fiefs);
  const latestLog = state.eventLog[0];
  const canRecruit = Number.isFinite(cheapestPartner) && state.gold >= cheapestPartner && state.ownedPartnerIds.length < 10;
  const battleDot = Boolean(state.frontierRaid) || state.orders >= orderCap;
  const incomeDetail = `宅邸 ${currentHome.dailyIncome} 金${farmPercent > 0 ? `，西蜀屯田 +${farmFlat} 金且 +${farmPercent}%` : ''}${fiefIncomePercent(state.fiefs) > 0 ? `，劝农封地 +${fiefIncomePercent(state.fiefs)}%` : ''}${realmIncomePercent(state.realms) > 0 ? `，国号蜀 +${realmIncomePercent(state.realms)}%` : ''}${state.legacyPoints > 0 ? `，家业点 +${state.legacyPoints * 5}%` : ''}，智谋加成 +${Math.floor(intelligence / 10)}%${state.incomeBuff && state.day < state.incomeBuff.untilDay ? `，减税招商 +${state.incomeBuff.percent}% 至第 ${state.incomeBuff.untilDay} 日` : ''}`;

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
          <div>
            <strong>{state.orders}/{orderCap}</strong>
            <span title="每场出征耗 1 道军令（北疆边患除外）；府邸前每日回 1 道，之后每 2 日回 1 道">{state.orders < 1 ? `${daysUntilNextOrder(state.day, state.homeLevel)} 日后 +1` : '军令'}</span>
          </div>
          <div>
            <strong>{state.day}</strong>
            <span>日</span>
          </div>
        </div>
      </header>

      {state.frontierRaid && (
        <div className="frontier-alert" role="status">
          <span>北疆边患！{formatRemaining(raidRemainingMs(state.frontierRaid, clock))}内出征北疆迎战，否则边郡失守、损失 5% 金（最多 5,000）。</span>
          <button type="button" onClick={() => onBattleAt('beijiang')}>去迎战 →</button>
        </div>
      )}

      <section className="home-banner" aria-label="主城">
        <ImageWithFallback src={imageUrl(currentHome.imagePath, 512)} alt={currentHome.name} className="home-banner__image" loading="eager" />
        <div className="income-floats">
          {floating.map((item) => (
            <span key={item.id}>+{item.amount}金</span>
          ))}
        </div>
        {report && (
          <div key={report.id} className="affair-report" role="status">
            <span>第 {report.day} 日 · 今日政务</span>
            <strong>{report.title}<b>+{report.amount.toLocaleString()} 金</b></strong>
            <small>{report.detail}</small>
          </div>
        )}
        <div className="home-banner__text">
          <h2>Lv.{currentHome.level} {currentHome.name}</h2>
          <details className="home-banner__detail">
            <summary>每次政务 +{dailyIncome.toLocaleString()} 金 ⓘ</summary>
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
              <li><b>赚钱</b>：点「处理政务」过一天，宅邸给你收入。</li>
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
            <button type="button" className="choice-card__later" onClick={() => setChoiceHiddenKey(choiceKey)}>稍后再说</button>
          </section>
          </div>
        );
      })()}

      {affairsOpen && !state.pendingChoice && (
        <div className="modal-backdrop choice-modal affairs-modal">
          <section role="dialog" aria-modal="true" aria-label="府中三件事" className="choice-card affairs-card">
            <em className="choice-card__eyebrow">第 {state.day + 1} 日 · 府中三件事 · 挑一件去办</em>
            {lastAffair && (
              <p className="affairs-card__done" role="status">
                刚办完「{lastAffair.title}」+{lastAffair.amount.toLocaleString()} 金{lastAffair.gain ? ` · ${lastAffair.gain}` : ''}
              </p>
            )}
            <div className="choice-card__options affairs-card__options">
              {affairChoices.map((item) => {
                const { gold, trains } = affairOutcome(item.kind, dailyIncome, state.affairTraining);
                const trained = item.kind === 'military' ? state.affairTraining.strength : state.affairTraining.civil;
                const gain = item.kind === 'treasury'
                  ? '足额政务收入'
                  : trains
                    ? `${item.kind === 'military' ? '武力' : '智谋、声望'} +1（本代 ${trained}/${AFFAIR_TRAINING_CAP}）`
                    : `${item.kind === 'military' ? '武力' : '智谋声望'}已练满，按足额给金`;
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
          <span>六郡尽归、王城巍峨、家业点已满。可开创新朝：定一国号，加成永久保留，历朝叠加。</span>
          <button type="button" onClick={() => { markEndingSeen(); onOpenEnding(); }}>展开卷轴 →</button>
        </section>
      )}

      {state.generation >= 2 && !state.ambition && ambitionOpen && !ambitionDeferred && (
        <section className="ambition-card" aria-label="本代志向">
          <div className="section-title">
            <span>第 {state.generation} 代 · 本代志向</span>
            <strong>三选一，传位时结算</strong>
          </div>
          <p className="starter-hint">先祖已留下家业，这一代要做成什么？达成者载入家谱，下一代开局多得 10,000 金；三代达成得家声「家学渊源」。</p>
          <div className="ambition-options">
            {availableAmbitions(state).map((item) => (
              <button key={item.id} type="button" onClick={() => onChooseAmbition(item.id)}>
                <strong>{item.name}</strong>
                <span>{item.describe(item.target(state.generation))}</span>
                <small>{candidate === item.id ? '上一代刚达成，再成一次即立家风 · ' : ''}{item.hint(state, item.target(state.generation))}</small>
              </button>
            ))}
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
        <GameButton onClick={() => handleCollectIncome()} className={`home-actions__main ${state.pendingChoice ? 'is-guided' : guided('income')}`}>
          {state.pendingChoice ? '府中来报 · 去定夺' : `处理政务 · +${dailyIncome.toLocaleString()}金`}
        </GameButton>
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
              <p className="ambition-progress">本代志向「{ambition.ambition.name}」：{ambition.ambition.describe(ambition.target)}，现 {ambition.progress.toLocaleString()} {ambition.ambition.unit}{ambition.done ? '，已达成，传位即载入家谱' : ''}。</p>
            )}
            {maxedHint && <p className="ambition-progress legacy-maxed-hint">{maxedHint}</p>}
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
            <p className="home-record">战绩：官道与牌局 {state.battleWins - state.navalWins - state.courtWins - state.frontierWins} · 水战 {state.navalWins} · 朝议 {state.courtWins} · 靖边 {state.frontierWins} · 负 {state.battleLosses}</p>
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

/** 测试用：设了这个开关，「处理政务」不弹三件事，直接办钱粮 */
const AFFAIR_QUICK_KEY = 'jiaye-affair-quick';
function quickAffairs() {
  try {
    return window.localStorage.getItem(AFFAIR_QUICK_KEY) === '1';
  } catch {
    return false;
  }
}
