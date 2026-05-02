import { useEffect, useMemo, useState } from 'react';
import type { HomeLevel, Lord, Partner, Weapon } from '../data/gameData';
import type { QuestStatus } from '../data/progression';
import { imageUrl } from '../lib/assets';
import type { GameState } from '../types';
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
  onCollectIncome: () => number;
  onUpgrade: () => boolean;
  onOpenPartner: () => void;
  onOpenPartnerTalk: () => void;
  onOpenWeapon: () => void;
  onBattle: () => void;
  onClaimQuest: (questId: string) => void;
  onCompleteTutorial: () => void;
  onOpenSettings: () => void;
  onIncomeSfx: () => void;
  onUpgradeEffect: () => void;
  questStatuses: QuestStatus[];
}

interface FloatingIncome {
  id: number;
  amount: number;
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
  onCollectIncome,
  onUpgrade,
  onOpenPartner,
  onOpenPartnerTalk,
  onOpenWeapon,
  onBattle,
  onClaimQuest,
  onCompleteTutorial,
  onOpenSettings,
  onIncomeSfx,
  onUpgradeEffect,
  questStatuses
}: HomeScreenProps) {
  const [floating, setFloating] = useState<FloatingIncome[]>([]);
  const canUpgrade = Boolean(nextHome && state.gold >= nextHome.upgradeCost);
  const partnerNames = useMemo(() => ownedPartners.map((partner) => partner.name).join('、') || '尚未招募', [ownedPartners]);
  const starterOrders = useMemo(
    () => [
      { label: '宅邸升至木屋', done: state.homeLevel >= 2 },
      { label: '良缘入府', done: state.ownedPartnerIds.length >= 1 },
      { label: '更换兵器', done: state.equippedWeaponId !== 'xuanjian' },
      { label: '初战告捷', done: state.battleWins >= 1 }
    ],
    [state.battleWins, state.equippedWeaponId, state.homeLevel, state.ownedPartnerIds.length]
  );
  const completedStarterOrders = starterOrders.filter((order) => order.done).length;
  const visibleQuests = useMemo(() => {
    const ready = questStatuses.filter((quest) => quest.complete && !quest.claimed);
    const active = questStatuses.filter((quest) => !quest.claimed && !ready.includes(quest));
    const claimed = questStatuses.filter((quest) => quest.claimed);
    return [...ready, ...active, ...claimed].slice(0, 3);
  }, [questStatuses]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const amount = onCollectIncome();
      const id = Date.now();
      onIncomeSfx();
      setFloating((items) => [...items, { id, amount }].slice(-3));
      window.setTimeout(() => setFloating((items) => items.filter((item) => item.id !== id)), 1500);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [onCollectIncome, onIncomeSfx]);

  const handleUpgrade = () => {
    if (onUpgrade()) {
      onUpgradeEffect();
    }
  };

  return (
    <main className="screen home-screen">
      <header className="home-hud">
        <div className="home-hud__lord">
          <ImageWithFallback src={imageUrl(lord.imagePath, 96)} alt={lord.name} className="home-hud__avatar" loading="eager" />
          <div>
            <strong>{lord.name}</strong>
            <span>{lord.title}</span>
          </div>
        </div>
        <div className="home-hud__chips">
          <div>
            <strong>{state.gold.toLocaleString()}</strong>
            <span>金币</span>
          </div>
          <div>
            <strong>{totalPower}</strong>
            <span>战力</span>
          </div>
          <div>
            <strong>Lv.{currentHome.level}</strong>
            <span>宅邸</span>
          </div>
          <div>
            <strong>第 {state.day} 日</strong>
            <span>天数</span>
          </div>
        </div>
        <button className="sound-toggle sound-toggle--inset" onClick={onOpenSettings} aria-label="打开设置">
          设
        </button>
      </header>

      <section className="home-estate">
        <div className="home-estate__image-wrap">
          <ImageWithFallback src={imageUrl(currentHome.imagePath, 512)} alt={currentHome.name} className="home-estate__image" loading="eager" />
          <div className="income-floats">
            {floating.map((item) => (
              <span key={item.id}>+{item.amount}金</span>
            ))}
          </div>
          <div className="home-estate__content">
            <span className="eyebrow">主城经营 · 核心循环</span>
            <h2>Lv.{currentHome.level} {currentHome.name}</h2>
            <p>每 3 秒自动收入 {currentHome.dailyIncome} 金，当前战力由主公、伴侣、兵器与宅邸共同构成。</p>
          </div>
          <div className="home-estate__stats">
            <StatBar label="武力" value={totalPower} max={420} tone="red" />
            <StatBar label="智谋" value={intelligence} max={150} tone="blue" />
            <StatBar label="声望" value={charisma} max={150} tone="gold" />
          </div>
        </div>
        <div className="home-support-grid">
          <div>
            <span>当前兵器</span>
            <strong>{weapon.name}</strong>
            <small>武力 +{weapon.strengthBonus}</small>
          </div>
          <div>
            <span>伴侣状态</span>
            <strong>已招募 {ownedPartners.length} 位</strong>
            <small>{partnerNames === '尚未招募' ? '尚未招募伴侣，当前内庭寂静。' : partnerNames}</small>
          </div>
        </div>
      </section>

      <section className="action-grid">
        <GameButton onClick={handleUpgrade} disabled={!canUpgrade}>
          {nextHome ? `升级宅邸 · ${nextHome.upgradeCost.toLocaleString()}金` : '宅邸已满'}
        </GameButton>
        <GameButton variant="secondary" onClick={onOpenPartner}>
          招募伴侣
        </GameButton>
        <GameButton variant="secondary" onClick={onOpenWeapon}>
          兵器库
        </GameButton>
        <GameButton variant="danger" onClick={onBattle}>
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
        <button type="button" onClick={onOpenSettings}>
          <span>主公</span>
        </button>
      </nav>

      {!state.tutorialDone && (
        <section className="starter-panel">
          <div className="section-title">
            <span>开局军令</span>
            <strong>{completedStarterOrders}/{starterOrders.length}</strong>
          </div>
          <div className="starter-list">
            {starterOrders.map((order) => (
              <span key={order.label} className={order.done ? 'is-done' : ''}>
                {order.done ? '已成' : '待办'} · {order.label}
              </span>
            ))}
          </div>
          <button onClick={onCompleteTutorial}>{completedStarterOrders === starterOrders.length ? '收令' : '暂收'}</button>
        </section>
      )}

      <section className="quest-panel">
        <div className="section-title">
          <span>家业目标</span>
          <strong>{questStatuses.filter((quest) => quest.claimed).length}/{questStatuses.length}</strong>
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
                <span>第{event.day}天 · {event.title}</span>
                <p>{event.detail}{event.goldDelta ? ` +${event.goldDelta.toLocaleString()}金` : ''}</p>
              </article>
            ))
          )}
        </div>
      </section>

      <footer className="home-footer">
        <span>胜 {state.battleWins} · 负 {state.battleLosses}</span>
        <button onClick={onOpenSettings}>设置与存档</button>
      </footer>
    </main>
  );
}
