import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Lord, Weapon } from '../data/gameData';
import { matchEnemy, matchNavalEnemy, NAVAL_UNLOCK_HOME_LEVEL, rollDamage } from '../lib/battle';
import type { BattleMode } from '../types';
import { imageUrl } from '../lib/assets';
import { DouDizhuGame } from './DouDizhuGame';
import { GameButton } from './common/GameButton';
import { ImageWithFallback } from './common/ImageWithFallback';

interface BattleScreenProps {
  lord: Lord;
  weapon: Weapon;
  totalPower: number;
  navalPower: number;
  homeLevel: number;
  wins: number;
  losses: number;
  onPlayEffect: (options: { videoPath: string; posterPath?: string; title: string; fallbackMs?: number }) => Promise<void>;
  onSfx: (path: string, volume?: number) => void;
  onResolved: (win: boolean, rewardGold: number, mode: BattleMode) => void;
  onReturnHome: () => void;
}

type BattlePhase = 'intro' | 'battle' | 'result';
type VenueId = 'beginner' | 'middle' | 'high';
type RegionId = 'jingzhou' | 'guandao' | 'jiangdong' | 'xuchang' | 'xishu' | 'beijiang';
type RegionMode = 'doudizhu' | 'battle' | 'naval' | 'locked';
interface Venue {
  id: VenueId;
  name: string;
  requiredPower: number;
  prize: string;
  rewardGold: number;
}

interface MapRegion {
  id: RegionId;
  name: string;
  state: string;
  x: number;
  y: number;
  mode: RegionMode;
}

interface BattleRuntime {
  phase: BattlePhase;
  playerHp: number;
  enemyHp: number;
  round: number;
  logs: string[];
  result: 'win' | 'loss' | 'retreat' | null;
}

const MAP_REGIONS: MapRegion[] = [
  { id: 'jingzhou', name: '荆州', state: '斗地主', x: 47, y: 58, mode: 'doudizhu' },
  { id: 'guandao', name: '官道', state: '自动讨伐', x: 52, y: 38, mode: 'battle' },
  { id: 'jiangdong', name: '江东', state: '水战', x: 76, y: 72, mode: 'naval' },
  { id: 'xuchang', name: '许都', state: '未开', x: 70, y: 18, mode: 'locked' },
  { id: 'xishu', name: '西蜀', state: '未开', x: 19, y: 52, mode: 'locked' },
  { id: 'beijiang', name: '北疆', state: '未开', x: 30, y: 16, mode: 'locked' }
];

const VENUES: Venue[] = [
  { id: 'beginner', name: '初级场', requiredPower: 80, prize: '胜利可得基础缴获', rewardGold: 1200 },
  { id: 'middle', name: '中级场', requiredPower: 140, prize: '更高金币奖励', rewardGold: 3000 },
  { id: 'high', name: '高级场', requiredPower: 190, prize: '名望与重赏', rewardGold: 8000 }
];

export function BattleScreen({
  lord,
  weapon,
  totalPower,
  navalPower,
  homeLevel,
  wins,
  losses,
  onPlayEffect,
  onSfx,
  onResolved,
  onReturnHome
}: BattleScreenProps) {
  const settledRef = useRef(false);
  const startedRef = useRef(false);
  const [mapOpen, setMapOpen] = useState(true);
  const [doudizhuOpen, setDoudizhuOpen] = useState(false);
  const [selectedRegionId, setSelectedRegionId] = useState<RegionId>('jingzhou');
  const [venueId, setVenueId] = useState<VenueId>('beginner');
  const selectedRegion = MAP_REGIONS.find((region) => region.id === selectedRegionId) ?? MAP_REGIONS[0];
  const selectedVenue = VENUES.find((venue) => venue.id === venueId) ?? VENUES[0];
  const mode: BattleMode = selectedRegion.mode === 'naval' ? 'naval' : 'land';
  const navalLocked = homeLevel < NAVAL_UNLOCK_HOME_LEVEL;
  // 水战比智谋、不看兵器；陆战比武力
  const attackPower = mode === 'naval' ? navalPower : totalPower;
  const enemy = useMemo(() => (mode === 'naval' ? matchNavalEnemy(navalPower) : matchEnemy(totalPower)), [mode, navalPower, totalPower]);
  const maxPlayerHp = 100 + Math.round(attackPower * 0.5);
  const maxEnemyHp = 90 + Math.round(enemy.power * 0.55);
  const selectedVenueLocked = selectedRegion.mode === 'doudizhu' && totalPower < selectedVenue.requiredPower;
  const canEnterSelectedRegion =
    selectedRegion.mode !== 'locked' && !selectedVenueLocked && !(selectedRegion.mode === 'naval' && navalLocked);
  const wording = mode === 'naval'
    ? { eyebrow: '江东水战', intro: '整船列阵', fighting: '鏖战江上', attack: '放箭', crit: '火攻', counter: '撞船反扑', counterCrit: '火船逼近', win: '水战告捷', loss: '折戟江上', enemyBroken: '船阵溃散', exhausted: '战船受损，只得回港' }
    : { eyebrow: '自动回合战', intro: '整军出征', fighting: '激战正酣', attack: '出手', crit: '暴击', counter: '反击', counterCrit: '反扑暴击', win: '讨伐得胜', loss: '败退整军', enemyBroken: '阵脚崩溃', exhausted: '兵势已尽，只得暂退' };
  const [runtime, setRuntime] = useState<BattleRuntime>(() => ({
    phase: 'intro',
    playerHp: maxPlayerHp,
    enemyHp: maxEnemyHp,
    round: 0,
    logs: [],
    result: null
  }));

  useEffect(() => {
    if (mapOpen || doudizhuOpen || startedRef.current) {
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
      if (!cancelled && !settledRef.current) {
        setRuntime((prev) => ({
          ...prev,
          phase: 'battle',
          logs: [mode === 'naval' ? '战鼓擂响，船阵前压。' : `${weapon.name}锋芒毕露，战斗开始。`, ...prev.logs]
        }));
      }
    }

    void runIntro();
    return () => {
      cancelled = true;
    };
  }, [doudizhuOpen, lord.name, mapOpen, mode, onPlayEffect, onSfx, weapon]);

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
        const playerDamage = rollDamage(attackPower, enemy.power, playerCrit);
        let nextEnemyHp = Math.max(0, prev.enemyHp - playerDamage);
        let nextPlayerHp = prev.playerHp;
        const round = prev.round + 1;
        const logs = [
          `第${round}合：${lord.name}${playerCrit ? wording.crit : wording.attack}，造成 ${playerDamage} 伤害。`,
          ...prev.logs
        ];

        let result: BattleRuntime['result'] = null;
        if (nextEnemyHp <= 0) {
          result = 'win';
          logs.unshift(`${enemy.name}${wording.enemyBroken}，缴获 ${enemy.rewardGold} 金。`);
        } else {
          const enemyDamage = rollDamage(enemy.power, attackPower, enemyCrit);
          nextPlayerHp = Math.max(0, prev.playerHp - enemyDamage);
          logs.unshift(`${enemy.name}${enemyCrit ? wording.counterCrit : wording.counter}，造成 ${enemyDamage} 伤害。`);
          if (nextPlayerHp <= 0) {
            result = 'loss';
            logs.unshift(`${lord.name}${wording.exhausted}。`);
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
  }, [attackPower, enemy, lord.name, runtime.phase, wording]);

  useEffect(() => {
    if (!runtime.result || settledRef.current) {
      return;
    }
    settledRef.current = true;
    const win = runtime.result === 'win';
    onSfx(win ? 'audio/sfx/sfx_victory.mp3' : 'audio/sfx/sfx_defeat.mp3', 0.58);
    onResolved(win, win ? enemy.rewardGold : 0, mode);
  }, [enemy.rewardGold, mode, onResolved, onSfx, runtime.result]);

  const retreat = () => {
    if (runtime.phase === 'result') {
      onReturnHome();
      return;
    }

    if (!settledRef.current) {
      settledRef.current = true;
      onResolved(false, 0, mode);
    }
    setRuntime((prev) => ({
      ...prev,
      phase: 'result',
      result: 'retreat',
      logs: ['鸣金收兵，保全实力，来日再战。', ...prev.logs]
    }));
  };

  const resultTitle = runtime.result === 'win' ? wording.win : runtime.result === 'retreat' ? '鸣金收兵' : runtime.result === 'loss' ? wording.loss : wording.fighting;

  if (doudizhuOpen) {
    return (
      <DouDizhuGame
        lord={lord}
        wins={wins}
        losses={losses}
        rewardGold={selectedVenue.rewardGold}
        onSfx={onSfx}
        onResolved={(win, rewardGold) => onResolved(win, rewardGold, 'land')}
        onReturnHome={onReturnHome}
      />
    );
  }

  if (mapOpen) {
    return (
      <main className="screen battle-screen expedition-screen">
        <header className="screen-header">
          <div>
            <span className="eyebrow">第五屏 · 出征地图</span>
            <h2>九州征途</h2>
          </div>
          <GameButton variant="ghost" onClick={onReturnHome}>
            回府
          </GameButton>
        </header>

        <section className="expedition-map" aria-label="三国地图">
          <div className="expedition-map__terrain" />
          {MAP_REGIONS.map((region) => {
            const available = region.mode !== 'locked' && !(region.mode === 'naval' && navalLocked);
            const stateLabel = region.mode === 'naval' && navalLocked ? '砖瓦宅后开放' : region.state;
            return (
              <button
                key={region.id}
                type="button"
                className={`map-node ${available ? 'is-available' : 'is-locked'} ${region.id === selectedRegionId ? 'is-selected' : ''}`}
                style={{ left: `${region.x}%`, top: `${region.y}%` }}
                disabled={!available}
                onClick={() => setSelectedRegionId(region.id)}
              >
                <strong>{region.name}</strong>
                <span>{stateLabel}</span>
              </button>
            );
          })}
        </section>

        {selectedRegion.mode === 'doudizhu' ? (
          <section className="venue-panel" aria-label="场次选择">
          <div className="section-title">
            <span>荆州 · 斗地主 · 当前战力 {totalPower}</span>
            <strong>选择场次</strong>
          </div>
          <div className="venue-grid">
            {VENUES.map((venue) => {
              const locked = totalPower < venue.requiredPower;
              const powerGap = Math.max(0, venue.requiredPower - totalPower);
              return (
                <button
                  key={venue.id}
                  type="button"
                  className={`venue-card ${venue.id === venueId ? 'is-selected' : ''}`}
                  disabled={locked}
                  onClick={() => setVenueId(venue.id)}
                >
                  <strong>{venue.name}</strong>
                  <span>推荐战力 {venue.requiredPower}+</span>
                  <em>{locked ? `战力不足，还差 ${powerGap}` : venue.prize}</em>
                </button>
              );
            })}
          </div>
          <p className="venue-summary">
            {selectedVenueLocked
              ? `当前场次战力不足，还差 ${selectedVenue.requiredPower - totalPower}。`
              : `本场缴获 ${selectedVenue.rewardGold.toLocaleString()} 金。`}
          </p>
          </section>
        ) : selectedRegion.mode === 'naval' ? (
          <section className="venue-panel" aria-label="水战说明">
            <div className="section-title">
              <span>江东 · 水战 · 当前智谋 {navalPower}</span>
              <strong>{navalLocked ? '尚未开放' : enemy.name}</strong>
            </div>
            <p className="venue-summary">
              {navalLocked
                ? `宅邸升至砖瓦宅（${NAVAL_UNLOCK_HOME_LEVEL} 级）后可出战。水战比的是智谋，兵器不计。`
                : `水战比智谋（主公 + 伴侣 + 宅邸），兵器不计；胜利可缴获 ${enemy.rewardGold.toLocaleString()} 金。`}
            </p>
          </section>
        ) : (
          <section className="venue-panel" aria-label="自动讨伐说明">
            <div className="section-title">
              <span>官道 · 自动回合战 · 当前战力 {totalPower}</span>
              <strong>{enemy.name}</strong>
            </div>
            <p className="venue-summary">
              普通讨伐将自动结算攻防回合，胜利可缴获 {enemy.rewardGold.toLocaleString()} 金。
            </p>
          </section>
        )}

        <GameButton
          block
          variant="danger"
          disabled={!canEnterSelectedRegion}
          onClick={() => {
            onSfx('audio/sfx/sfx_button.mp3', 0.35);
            setRuntime({
              phase: 'intro',
              playerHp: maxPlayerHp,
              enemyHp: maxEnemyHp,
              round: 0,
              logs: mode === 'naval'
                ? [`哨船回报：${enemy.name}列阵江上。`, `${lord.name}登楼船督战。`]
                : [`斥候回报：${enemy.name}列阵于前。`, `${lord.name}提${weapon.name}出征。`],
              result: null
            });
            setDoudizhuOpen(selectedRegion.mode === 'doudizhu');
            setMapOpen(false);
          }}
        >
          {selectedRegion.mode === 'doudizhu' ? '进入斗地主' : selectedRegion.mode === 'naval' ? '扬帆出战' : '出征讨伐'}
        </GameButton>
      </main>
    );
  }

  return (
    <main className={`screen battle-screen ${mode === 'naval' ? 'is-naval' : ''}`} style={mode === 'naval' ? { '--battle-bg': `url(${imageUrl('assets/ui/ui_naval_battle.png', 512)})` } as CSSProperties : undefined}>
      <header className="screen-header">
        <div>
          <span className="eyebrow">{wording.eyebrow}</span>
          <h2>{runtime.phase === 'intro' ? wording.intro : resultTitle}</h2>
        </div>
        <span className="battle-record">胜 {wins} · 负 {losses}</span>
      </header>

      <section className="battle-arena">
        <BattleFighter name={lord.name} title={mode === 'naval' ? `智谋 ${navalPower}` : weapon.name} image={imageUrl(lord.imagePath, 512)} hp={runtime.playerHp} maxHp={maxPlayerHp} />
        <div className="battle-vs">VS</div>
        <BattleFighter name={enemy.name} title={enemy.description} image={imageUrl(mode === 'naval' ? 'assets/ui/ui_naval_battle.png' : 'assets/ui/ui_entrance_effect.png', 256)} hp={runtime.enemyHp} maxHp={maxEnemyHp} enemy />
      </section>

      <section className="battle-info">
        <div>
          <span>匹配敌军</span>
          <strong>{enemy.name}</strong>
        </div>
        <div>
          <span>{mode === 'naval' ? '比拼' : '当前兵器'}</span>
          <strong>{mode === 'naval' ? '智谋' : weapon.name}</strong>
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
