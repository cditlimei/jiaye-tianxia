import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lord, Weapon } from '../data/gameData';
import { matchEnemy, rollDamage } from '../lib/battle';
import { imageUrl } from '../lib/assets';
import { GameButton } from './common/GameButton';
import { ImageWithFallback } from './common/ImageWithFallback';

interface BattleScreenProps {
  lord: Lord;
  weapon: Weapon;
  totalPower: number;
  wins: number;
  losses: number;
  onPlayEffect: (options: { videoPath: string; posterPath?: string; title: string; fallbackMs?: number }) => Promise<void>;
  onSfx: (path: string, volume?: number) => void;
  onResolved: (win: boolean, rewardGold: number) => void;
  onReturnHome: () => void;
}

type BattlePhase = 'intro' | 'battle' | 'result';

interface BattleRuntime {
  phase: BattlePhase;
  playerHp: number;
  enemyHp: number;
  round: number;
  logs: string[];
  result: 'win' | 'loss' | 'retreat' | null;
}

export function BattleScreen({
  lord,
  weapon,
  totalPower,
  wins,
  losses,
  onPlayEffect,
  onSfx,
  onResolved,
  onReturnHome
}: BattleScreenProps) {
  const enemy = useMemo(() => matchEnemy(totalPower), [totalPower]);
  const maxPlayerHp = 100 + Math.round(totalPower * 0.5);
  const maxEnemyHp = 90 + Math.round(enemy.power * 0.55);
  const settledRef = useRef(false);
  const startedRef = useRef(false);
  const [runtime, setRuntime] = useState<BattleRuntime>({
    phase: 'intro',
    playerHp: maxPlayerHp,
    enemyHp: maxEnemyHp,
    round: 0,
    logs: [`斥候回报：${enemy.name}列阵于前。`, `${lord.name}提${weapon.name}出征。`],
    result: null
  });

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    let cancelled = false;

    async function runIntro() {
      await onPlayEffect({
        videoPath: 'assets/ui/ui_entrance_effect.mp4',
        posterPath: 'assets/ui/ui_entrance_effect.png',
        title: '旌旗入阵',
        fallbackMs: 1800
      });
      onSfx(weapon.sfxPath, 0.5);
      await onPlayEffect({
        videoPath: weapon.videoPath,
        posterPath: weapon.imagePath,
        title: weapon.name,
        fallbackMs: 1800
      });
      if (!cancelled) {
        setRuntime((prev) => ({
          ...prev,
          phase: 'battle',
          logs: [`${weapon.name}锋芒毕露，战斗开始。`, ...prev.logs]
        }));
      }
    }

    void runIntro();
    return () => {
      cancelled = true;
    };
  }, [lord.name, onPlayEffect, onSfx, weapon]);

  useEffect(() => {
    if (runtime.phase !== 'battle') {
      return;
    }

    const timer = window.setInterval(() => {
      setRuntime((prev) => {
        if (prev.phase !== 'battle' || prev.result) {
          return prev;
        }

        const playerCrit = Math.random() < 0.18;
        const enemyCrit = Math.random() < 0.12;
        const playerDamage = rollDamage(totalPower, enemy.power, playerCrit);
        let nextEnemyHp = Math.max(0, prev.enemyHp - playerDamage);
        let nextPlayerHp = prev.playerHp;
        const round = prev.round + 1;
        const logs = [
          `第${round}合：${lord.name}${playerCrit ? '暴击' : '出手'}，造成 ${playerDamage} 伤害。`,
          ...prev.logs
        ];

        let result: BattleRuntime['result'] = null;
        if (nextEnemyHp <= 0) {
          result = 'win';
          logs.unshift(`${enemy.name}阵脚崩溃，缴获 ${enemy.rewardGold} 金。`);
        } else {
          const enemyDamage = rollDamage(enemy.power, totalPower, enemyCrit);
          nextPlayerHp = Math.max(0, prev.playerHp - enemyDamage);
          logs.unshift(`${enemy.name}${enemyCrit ? '反扑暴击' : '反击'}，造成 ${enemyDamage} 伤害。`);
          if (nextPlayerHp <= 0) {
            result = 'loss';
            logs.unshift(`${lord.name}兵势已尽，只得暂退。`);
          }
        }

        return {
          phase: result ? 'result' : 'battle',
          playerHp: nextPlayerHp,
          enemyHp: nextEnemyHp,
          round,
          logs: logs.slice(0, 12),
          result
        };
      });
    }, 800);

    return () => window.clearInterval(timer);
  }, [enemy, lord.name, runtime.phase, totalPower]);

  useEffect(() => {
    if (!runtime.result || settledRef.current) {
      return;
    }
    settledRef.current = true;
    const win = runtime.result === 'win';
    onSfx(win ? 'audio/sfx/sfx_victory.mp3' : 'audio/sfx/sfx_defeat.mp3', 0.58);
    onResolved(win, win ? enemy.rewardGold : 0);
  }, [enemy.rewardGold, onResolved, onSfx, runtime.result]);

  const retreat = () => {
    if (runtime.phase === 'result') {
      onReturnHome();
      return;
    }

    if (!settledRef.current) {
      settledRef.current = true;
      onResolved(false, 0);
    }
    setRuntime((prev) => ({
      ...prev,
      phase: 'result',
      result: 'retreat',
      logs: ['鸣金收兵，保全实力，来日再战。', ...prev.logs]
    }));
  };

  const resultTitle = runtime.result === 'win' ? '讨伐得胜' : runtime.result === 'retreat' ? '鸣金收兵' : '败退整军';

  return (
    <main className="screen battle-screen">
      <header className="screen-header">
        <div>
          <span className="eyebrow">自动回合战</span>
          <h2>{runtime.phase === 'intro' ? '整军出征' : resultTitle}</h2>
        </div>
        <span className="battle-record">胜 {wins} · 负 {losses}</span>
      </header>

      <section className="battle-arena">
        <BattleFighter name={lord.name} title={weapon.name} image={imageUrl(lord.imagePath, 512)} hp={runtime.playerHp} maxHp={maxPlayerHp} />
        <div className="battle-vs">VS</div>
        <BattleFighter name={enemy.name} title={enemy.description} image={imageUrl('assets/ui/ui_entrance_effect.png', 256)} hp={runtime.enemyHp} maxHp={maxEnemyHp} enemy />
      </section>

      <section className="battle-info">
        <div>
          <span>匹配敌军</span>
          <strong>{enemy.name}</strong>
        </div>
        <div>
          <span>当前兵器</span>
          <strong>{weapon.name}</strong>
        </div>
        <div>
          <span>潜在奖励</span>
          <strong>{enemy.rewardGold.toLocaleString()} 金</strong>
        </div>
      </section>

      <section className="battle-log" aria-live="polite">
        {runtime.logs.map((log, index) => (
          <p key={`${log}-${index}`}>{log}</p>
        ))}
      </section>

      <GameButton block variant={runtime.phase === 'result' ? 'primary' : 'danger'} onClick={retreat}>
        {runtime.phase === 'result' ? '返回家业' : '鸣金收兵'}
      </GameButton>
    </main>
  );
}

interface BattleFighterProps {
  name: string;
  title: string;
  image: string;
  hp: number;
  maxHp: number;
  enemy?: boolean;
}

function BattleFighter({ name, title, image, hp, maxHp, enemy = false }: BattleFighterProps) {
  const width = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  return (
    <article className={`battle-fighter ${enemy ? 'is-enemy' : ''}`}>
      <ImageWithFallback src={image} alt={name} className="battle-fighter__image" />
      <div className="battle-fighter__panel">
        <strong>{name}</strong>
        <span>{title}</span>
        <div className="hp-bar" aria-label={`${name}血量`}>
          <div style={{ width: `${width}%` }} />
        </div>
        <small>{hp} / {maxHp}</small>
      </div>
    </article>
  );
}
