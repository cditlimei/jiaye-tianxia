import { useEffect, useMemo, useState } from 'react';
import type { HomeLevel, Lord, Partner, Weapon } from '../data/gameData';
import { wsrvUrl } from '../lib/assets';
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
  onOpenWeapon: () => void;
  onBattle: () => void;
  onIncomeSfx: () => void;
  onUpgradeEffect: () => void;
  onReset: () => void;
  onToggleSound: () => void;
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
  onOpenWeapon,
  onBattle,
  onIncomeSfx,
  onUpgradeEffect,
  onReset,
  onToggleSound
}: HomeScreenProps) {
  const [floating, setFloating] = useState<FloatingIncome[]>([]);
  const canUpgrade = Boolean(nextHome && state.gold >= nextHome.upgradeCost);
  const partnerNames = useMemo(() => ownedPartners.map((partner) => partner.name).join('、') || '尚未招募', [ownedPartners]);

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
          <ImageWithFallback src={wsrvUrl(lord.imagePath, 96)} alt={lord.name} className="home-hud__avatar" loading="eager" />
          <div>
            <strong>{lord.name}</strong>
            <span>{lord.title}</span>
          </div>
        </div>
        <div className="home-hud__numbers">
          <span>{state.gold.toLocaleString()} 金</span>
          <span>{totalPower} 战力</span>
          <span>第 {state.day} 天</span>
        </div>
        <button className="sound-toggle sound-toggle--inset" onClick={onToggleSound} aria-label="切换声音">
          {state.soundEnabled ? '音' : '静'}
        </button>
      </header>

      <section className="home-estate">
        <div className="home-estate__image-wrap">
          <ImageWithFallback src={wsrvUrl(currentHome.imagePath, 512)} alt={currentHome.name} className="home-estate__image" loading="eager" />
          <div className="income-floats">
            {floating.map((item) => (
              <span key={item.id}>+{item.amount}金</span>
            ))}
          </div>
        </div>
        <div className="home-estate__content">
          <span className="eyebrow">宅邸等级 {currentHome.level}</span>
          <h2>{currentHome.name}</h2>
          <p>每日收入 {currentHome.dailyIncome} 金 · 当前兵器 {weapon.name}</p>
          <p>伴侣：{partnerNames}</p>
        </div>
      </section>

      <section className="home-stats">
        <StatBar label="武力" value={totalPower} max={420} tone="red" />
        <StatBar label="智谋" value={intelligence} max={150} tone="blue" />
        <StatBar label="声望" value={charisma} max={150} tone="green" />
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

      <footer className="home-footer">
        <span>胜 {state.battleWins} · 负 {state.battleLosses}</span>
        <button onClick={onReset}>重置存档</button>
      </footer>
    </main>
  );
}

