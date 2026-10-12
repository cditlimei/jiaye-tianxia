import { useEffect, useMemo, useRef, useState } from 'react';
import type { HomeLevel, Lord, Partner, Weapon } from '../data/gameData';
import type { QuestStatus } from '../data/progression';
import { imageUrl } from '../lib/assets';
import { legacyPointsGainable, weaponBonusForLord } from '../lib/battle';
import { formatRemaining, raidRemainingMs } from '../lib/frontier';
import { resolvePendingEvent } from '../data/progression';
import { partners } from '../data/gameData';
import { partnerIdOfKey } from '../data/partnerEvents';
import type { GameState } from '../types';
import { ambitionStatus, availableAmbitions, type AmbitionId } from '../data/ambitions';
import { dynastyCount, endingHint, findRealm, isEndingReached, realmIncomePercent } from '../data/dynasty';
import { fiefCostFor, legacyGoldPerPointFor, traditionCandidate, traditionOf } from '../data/traditions';
import { FIEF_UNLOCK_HOME_LEVEL, fiefIncomePercent, fiefs, fiefStatBonus, nextFief, ownedFiefCount } from '../data/fiefs';
import { GameButton } from './common/GameButton';
import { ImageWithFallback } from './common/ImageWithFallback';
import { StatBar } from './common/StatBar';

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
  onCollectIncome: () => number;
  onResolveChoice: (optionId: string) => void;
  onUpgrade: () => boolean;
  onOpenPartner: () => void;
  onOpenPartnerTalk: () => void;
  onOpenWeapon: () => void;
  onBattle: () => void;
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
  onOpenPartnerTalk,
  onOpenWeapon,
  onBattle,
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
  const ambition = ambitionStatus(state);
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
  // 开局引导：四步，每步指向一个按钮；钱不够时先指向「处理政务」
  const starterOrders = useMemo(
    () => [
      { label: '升级木屋', done: state.homeLevel >= 2, target: 'upgrade' as const, hint: nextHome && state.gold < nextHome.upgradeCost ? `先点「处理政务」攒到 ${nextHome.upgradeCost.toLocaleString()} 金，再升级宅邸。` : '点「升级宅邸」把茅草屋升成木屋，收入翻三倍。' },
      { label: '招募伴侣', done: state.ownedPartnerIds.length >= 2, target: 'partner' as const, hint: state.gold < 800 ? '金币不够招人：先领上方任务奖励或点「处理政务」攒钱，再去「招募伴侣」请一位入府。' : '去「招募伴侣」再请一位入府，伴侣直接加战力、智谋或声望。' },
      { label: '换一把兵器', done: state.equippedWeaponId !== 'xuanjian', target: 'weapon' as const, hint: '攒 1,500 金去「兵器库」买把青釭剑或双股剑。第 5 日伴侣会来说心事，了却后任务「良缘佳话」正好奖 1,500 金。' },
      { label: '初战告捷', done: state.battleWins >= 1, target: 'battle' as const, hint: '点「出征讨伐」，到官道挑一个推荐对手打一场，缴获比处理政务多得多。' }
    ],
    [nextHome, state.battleWins, state.equippedWeaponId, state.gold, state.homeLevel, state.ownedPartnerIds.length]
  );
  const currentOrder = starterOrders.find((order) => !order.done) ?? null;
  const guidedTarget: 'income' | 'upgrade' | 'partner' | 'weapon' | 'battle' | null = state.tutorialDone || !currentOrder
    ? null
    : currentOrder.target === 'upgrade' && nextHome && state.gold < nextHome.upgradeCost
      ? 'income'
      : currentOrder.target === 'weapon' && state.gold < 1500
        ? 'income'
        : currentOrder.target === 'partner' && state.gold < 800
          ? 'income'
          : currentOrder.target;
  const guided = (target: typeof guidedTarget) => (guidedTarget === target ? 'is-guided' : '');
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
    return [...ready, ...active, ...claimed].slice(0, 4);
  }, [questStatuses]);

  const choiceRef = useRef<HTMLElement | null>(null);
  const actionRef = useRef<HTMLElement | null>(null);
  const questRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (state.pendingChoice) choiceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [state.pendingChoice]);

  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!state.frontierRaid) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, [state.frontierRaid]);

  const handleCollectIncome = () => {
    const amount = onCollectIncome();
    const id = Date.now();
    onIncomeSfx();
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
  const chances = [
    ...(claimable > 0 ? [{ key: 'claim', label: `可领赏 ${claimable} 项`, detail: '家业目标已达成', onClick: () => questRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }] : []),
    ...(fiefAffordable && nextFiefToClaim ? [{ key: 'fief', label: `可开拓${nextFiefToClaim.name}`, detail: `${nextFiefCost.toLocaleString()} 金，余 ${(state.gold - nextFiefCost).toLocaleString()}`, onClick: onOpenFief }] : []),
    ...(state.homeLevel >= 6 && state.gold >= 100000 && state.legacyPoints < 20 && !isEndingReached(state)
      ? [{ key: 'succeed', label: `可传位换 ${legacyPointsGainable(state.gold, state.legacyPoints, legacyGoldPerPointFor(state))} 点家业点`, detail: [endingHint(state)?.replace(/。$/, '') ?? (fiefAffordable ? '先封郡再传位更划算' : ''), ambition && !ambition.done ? `志向还差 ${(ambition.target - ambition.progress).toLocaleString()} ${ambition.ambition.unit}` : ''].filter(Boolean).join('；'), onClick: onOpenSettings }]
      : []),
    ...(state.generation >= 2 && !state.ambition && !isEndingReached(state) && ambitionDeferred ? [{ key: 'ambition', label: '本代志向未定', detail: '定下志向才有传位结算', onClick: () => setAmbitionDeferred(false) }] : []),
    ...(isEndingReached(state) && endingSeen ? [{ key: 'ending', label: '天下归心', detail: '展开卷轴开创新朝', onClick: onOpenEnding }] : [])
  ];
  return (
    <main className="screen home-screen">
      <header className="home-hud">
        <div className="home-hud__lord">
          <ImageWithFallback src={imageUrl(lord.imagePath, 96)} alt={lord.name} className="home-hud__avatar" loading="eager" />
          <div>
            <strong>{lord.name}</strong>
            <span>{lord.title}{dynastyCount(state.realms) > 0 ? ` · ${state.realm ? `${findRealm(state.realm)?.name} · ` : ''}第 ${dynastyCount(state.realms) + 1} 朝` : ''}{state.generation > 1 ? ` · 第 ${state.generation} 代` : ''}</span>
            {(tradition || (ambition && !isEndingReached(state))) && (
              <em className="home-hud__ambition" title={tradition?.effect}>{[tradition?.name, ambition && !isEndingReached(state) ? `志向 ${ambition.ambition.name} ${ambition.done ? '已达成' : `${ambition.progress.toLocaleString()}/${ambition.target.toLocaleString()}`}` : null].filter(Boolean).join(' · ')}</em>
            )}
            <em className="home-hud__honor" title={titleStatus.next ? `下一称号「${titleStatus.next.name}」：${titleStatus.next.requirement}` : titleStatus.missing > 0 ? `已是最高称号，另有 ${titleStatus.missing} 个称号待集齐` : '称号已集齐'}>「{titleStatus.current.name}」</em>
          </div>
        </div>
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
            <span>军令</span>
          </div>
          <div>
            <strong>{state.day}</strong>
            <span>第几日</span>
          </div>
        </div>
        <button className="sound-toggle sound-toggle--inset" onClick={onOpenSettings} aria-label="打开设置">
          设
        </button>
      </header>

      {state.frontierRaid && (
        <div className="frontier-alert" role="status">
          <span>北疆边患！{formatRemaining(raidRemainingMs(state.frontierRaid, clock))}内出征北疆迎战，否则边郡失守、损失 5% 金。</span>
          <button type="button" onClick={onBattle}>去迎战 →</button>
        </div>
      )}

      {!state.tutorialDone && currentOrder && (
        <>
          {!state.tutorialDone && currentOrder && (
            <section className="starter-panel" aria-label="开局引导">
              <div className="section-title">
                <span>开局引导 · 第 {completedStarterOrders + 1} 步 / {starterOrders.length}</span>
                <strong>{currentOrder.label}</strong>
              </div>
              <p className="starter-hint">{currentOrder.hint}</p>
              <div className="starter-list">
                {starterOrders.map((order) => (
                  <span key={order.label} className={order.done ? 'is-done' : order === currentOrder ? 'is-current' : ''}>
                    {order.done ? '已成' : order === currentOrder ? '进行中' : '待办'} · {order.label}
                  </span>
                ))}
              </div>
              <div className="starter-actions">
                <button type="button" className="starter-go" onClick={() => actionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>去做这一步 ↓</button>
                <button type="button" onClick={onCompleteTutorial}>跳过引导</button>
              </div>
            </section>
          )}
        </>
      )}

      {state.pendingChoice && (() => {
        const event = resolvePendingEvent(state.pendingChoice);
        if (!event) return null;
        const partner = event.id.startsWith('partner:') ? partners.find((item) => item.id === partnerIdOfKey(event.id.slice('partner:'.length))) : event.id.startsWith('minor:') ? partners.find((item) => item.id === event.id.split(':')[2]) : null;
        return (
          <section ref={choiceRef} className={`choice-card ${partner ? 'choice-card--partner' : ''}`} aria-label={event.id.startsWith('minor:') ? '府中小事' : partner ? '伴侣心事' : '府中事件'}>
            {partner && <ImageWithFallback src={imageUrl(partner.imagePath, 160)} alt={partner.name} className="choice-card__portrait" />}
            <span>第 {state.pendingChoice.day} 日 · {partner ? `${partner.name} · ` : ''}{event.title}</span>
            <strong>{event.prompt}</strong>
            <div className="choice-card__options">
              {event.options.map((option) => (
                <button key={option.id} type="button" onClick={() => onResolveChoice(option.id)}>
                  <strong>{option.label}</strong>
                  <small>{option.detail}</small>
                </button>
              ))}
            </div>
          </section>
        );
      })()}

      {state.tutorialDone && isEndingReached(state) && !endingSeen && (
        <section className="succession-hint ending-hint" aria-label="天下归心">
          <strong>天下归心</strong>
          <span>六郡尽归、王城巍峨、家业点已满。可开创新朝：定一国号，加成永久保留，历朝叠加。</span>
          <button type="button" onClick={() => { markEndingSeen(); onOpenEnding(); }}>展开卷轴 →</button>
        </section>
      )}

      {state.generation >= 2 && !state.ambition && !isEndingReached(state) && !ambitionDeferred && (
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

      {chances.length > 0 && (
        <nav className="chance-bar" aria-label="可做的事">
          {chances.map((item) => (
            <button key={item.key} type="button" onClick={item.onClick} disabled={!item.onClick}>
              <strong>{item.label}</strong>
              {item.detail && <span>{item.detail}</span>}
            </button>
          ))}
        </nav>
      )}

      <section className="home-estate">
        <div className="home-estate__image-wrap">
          <ImageWithFallback src={imageUrl(currentHome.imagePath, 512)} alt={currentHome.name} className="home-estate__image" loading="eager" />
          <div className="income-floats">
            {floating.map((item) => (
              <span key={item.id}>+{item.amount}金</span>
            ))}
          </div>
          <div className="home-estate__content">
            <span className="eyebrow">主城经营</span>
            <h2>Lv.{currentHome.level} {currentHome.name}</h2>
            <p>处理政务可推进 1 日并收入 {dailyIncome} 金（宅邸 {currentHome.dailyIncome} 金{farmPercent > 0 ? `，西蜀屯田 +${farmFlat} 金且 +${farmPercent}%` : ''}{fiefIncomePercent(state.fiefs) > 0 ? `，劝农封地 +${fiefIncomePercent(state.fiefs)}%` : ''}{realmIncomePercent(state.realms) > 0 ? `，国号蜀 +${realmIncomePercent(state.realms)}%` : ''}{state.legacyPoints > 0 ? `，家业点 +${state.legacyPoints * 5}%` : ''}，智谋加成 +{Math.floor(intelligence / 10)}%{state.incomeBuff && state.day < state.incomeBuff.untilDay ? `，减税招商 +${state.incomeBuff.percent}%（至第 ${state.incomeBuff.untilDay} 日）` : ''}）；声望让招募伴侣便宜 {recruitDiscount}%。战力由主公、伴侣、兵器与宅邸共同构成。</p>
          </div>
          <div className="home-estate__stats">
            <StatBar label="武力" value={totalPower} max={280} tone="red" />
            <StatBar label="智谋" value={intelligence} max={230} tone="blue" />
            <StatBar label="声望" value={charisma} max={230} tone="gold" />
          </div>
        </div>
        <div className="home-support-grid">
          <div>
            <span>当前兵器</span>
            <strong>{weapon.name}</strong>
            <small>武力 +{weaponBonusForLord(weapon, lord.id)}</small>
          </div>
          <div>
            <span>伴侣状态</span>
            <strong>已招募 {ownedPartners.length} 位</strong>
            <small>{partnerNames === '尚未招募' ? '尚未招募伴侣，当前内庭寂静。' : partnerNames}</small>
          </div>
          <div className="home-support-grid__fief">
            <span>封地</span>
            <strong>{ownedFiefCount(state.fiefs) > 0 ? `已开拓 ${ownedFiefCount(state.fiefs)}/${fiefs.length} 郡` : state.homeLevel >= FIEF_UNLOCK_HOME_LEVEL ? '尚未封郡' : '侯府后开放'}</strong>
            <small>{ownedFiefCount(state.fiefs) > 0 ? `劝农 +${fiefIncomePercent(state.fiefs)}% · 军令上限 ${orderCap} · 教化 +${fiefStatBonus(state.fiefs)}` : '六郡依次开拓，每郡定一条方略。'}</small>
            <button type="button" className="home-support-grid__link" onClick={onOpenFief}>经略封地</button>
          </div>
        </div>
      </section>

      <section className="action-grid" ref={actionRef}>
        <GameButton onClick={handleCollectIncome} className={guided('income')} disabled={Boolean(state.pendingChoice)}>
          {state.pendingChoice ? '先决断上方事件' : `处理政务 · +${dailyIncome.toLocaleString()}金`}
        </GameButton>
        <GameButton onClick={handleUpgrade} disabled={!canUpgrade} className={guided('upgrade')}>
          {nextHome ? (<>升级宅邸<small className="game-button__sub">{nextHome.upgradeCost.toLocaleString()} 金</small></>) : '宅邸已满'}
        </GameButton>
        <GameButton variant="secondary" onClick={onOpenPartner} className={guided('partner')}>
          招募伴侣
        </GameButton>
        <GameButton variant="secondary" onClick={onOpenWeapon} className={guided('weapon')}>
          兵器库
        </GameButton>
        <GameButton variant="danger" onClick={onBattle} className={guided('battle')}>
          出征讨伐
        </GameButton>
      </section>

      <nav className="home-tabbar" aria-label="主城导航">
        <button type="button" className="is-active" aria-current="page">
          <span>家业</span>
        </button>
        <button type="button" onClick={onBattle}>
          <span>出征</span>
        </button>
        <button type="button" onClick={onOpenPartnerTalk}>
          <span>伴侣</span>
        </button>
        <button type="button" onClick={onOpenWeapon}>
          <span>兵器</span>
        </button>
        <button type="button" onClick={onOpenLord}>
          <span>主公</span>
        </button>
      </nav>

      <section className="quest-panel" ref={questRef}>
        <div className="section-title">
          <span>家业目标</span>
          <strong>{questStatuses.filter((quest) => quest.claimed).length}/{questStatuses.length}</strong>
        </div>
        {ambition && !isEndingReached(state) && (
          <p className="ambition-progress">本代志向「{ambition.ambition.name}」：{ambition.ambition.describe(ambition.target)}，现 {ambition.progress.toLocaleString()} {ambition.ambition.unit}{ambition.done ? '，已达成，传位即载入家谱' : ''}。</p>
        )}
        <p className="honor-hint">
          当前称号「{titleStatus.current.name}」{titleStatus.next ? `，${titleStatus.next.requirement}可得「${titleStatus.next.name}」` : titleStatus.missing > 0 ? `，已是本代最高称号，另有 ${titleStatus.missing} 个称号待集齐（点头像查看）` : '，本代称号已集齐'}。
        </p>
        <div className="section-title" hidden>
          <span />
        </div>
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
                <em>{quest.rewardGold.toLocaleString()}金</em>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="event-panel">
        <div className="section-title">
          <span>府中纪事</span>
          <strong>近事</strong>
        </div>
        <div className="event-list">
          {state.eventLog.length === 0 ? (
            <p>尚无纪事，经营数日后会有府中回报。</p>
          ) : (
            state.eventLog.slice(0, 4).map((event) => (
              <article key={event.id}>
                <span>第 {event.day} 日 · {event.title}</span>
                <p>{event.detail}{event.goldDelta ? ` ${event.goldDelta > 0 ? '+' : '−'}${Math.abs(event.goldDelta).toLocaleString()}金` : ''}</p>
              </article>
            ))
          )}
        </div>
      </section>

      <footer className="home-footer">
        <span>官道与牌局 {state.battleWins - state.navalWins - state.courtWins - state.frontierWins} · 水战 {state.navalWins} · 朝议 {state.courtWins} · 靖边 {state.frontierWins} · 负 {state.battleLosses}</span>
        <button onClick={onOpenSettings}>设置与存档</button>
      </footer>
    </main>
  );
}
