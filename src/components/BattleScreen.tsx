import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Enemy, FarmLevel, Lord, Weapon } from '../data/gameData';
import { enemyImagePath } from '../data/gameData';
import { FARM_UNLOCK_HOME_LEVEL } from '../data/gameData';
import { COURT_UNLOCK_HOME_LEVEL, ENEMY_CRIT_RATE, enemyForTier, enemyMaxHp, estimateWinRate, NAVAL_UNLOCK_HOME_LEVEL, PLAYER_CRIT_RATE, playerMaxHp, recommendedTierIndex, rollDamage, ROSTERS } from '../lib/battle';
import { formatRemaining, FRONTIER_UNLOCK_HOME_LEVEL, RAID_PENALTY_CAP, RAID_PENALTY_RATE, raidPenalty, raidRemainingMs } from '../lib/frontier';
import { daysUntilNextOrder, LOSS_PENALTY_RATE, ORDER_CAP, type BattleMode } from '../types';
import { imageUrl } from '../lib/assets';
import { DouDizhuGame } from './DouDizhuGame';
import { GameButton } from './common/GameButton';
import { ImageWithFallback } from './common/ImageWithFallback';

interface BattleScreenProps {
  lord: Lord;
  weapon: Weapon;
  totalPower: number;
  navalPower: number;
  courtPower: number;
  homeLevel: number;
  farm: { current: FarmLevel; next: FarmLevel | null; gold: number; homeIncome: number };
  orders: number;
  day: number;
  frontier: { raid: { startDay: number; startedAt: number; dueAt: number } | null; nextRaidDay: number; day: number };
  onUpgradeFarm: () => boolean;
  onBattleStart: (mode: BattleMode, lossGold: number) => void;
  wins: number;
  losses: number;
  onPlayEffect: (options: { videoPath: string; posterPath?: string; title: string; fallbackMs?: number }) => Promise<void>;
  onSfx: (path: string, volume?: number) => void;
  onResolved: (win: boolean, rewardGold: number, mode: BattleMode, retreat?: boolean, lossGold?: number) => void;
  onReturnHome: () => void;
}

type BattlePhase = 'intro' | 'battle' | 'result';
type VenueId = 'beginner' | 'middle' | 'high';
type RegionId = 'jingzhou' | 'guandao' | 'jiangdong' | 'xuchang' | 'xishu' | 'beijiang';
type RegionMode = 'doudizhu' | BattleMode | 'farm' | 'locked';
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
  { id: 'guandao', name: '官道', state: '自动讨伐', x: 52, y: 38, mode: 'land' },
  { id: 'jiangdong', name: '江东', state: '水战', x: 76, y: 72, mode: 'naval' },
  { id: 'xuchang', name: '许都', state: '朝堂', x: 70, y: 18, mode: 'court' },
  { id: 'xishu', name: '西蜀', state: '屯田', x: 19, y: 52, mode: 'farm' },
  { id: 'beijiang', name: '北疆', state: '边境安宁', x: 30, y: 16, mode: 'frontier' }
];

interface ModeConfig {
  region: string;
  title: string;
  statLabel: string;
  unlockHomeLevel: number;
  unlockHomeName: string;
  enterLabel: string;
  background: string | null;
  summary: string;
  eyebrow: string;
  intro: string;
  fighting: string;
  attack: string;
  crit: string;
  counter: string;
  counterCrit: string;
  win: string;
  loss: string;
  enemyBroken: string;
  exhausted: string;
  retreat: string;
  scoutReport: (enemy: string) => string;
  departure: (lord: string, weapon: string) => string;
  battleStart: (weapon: string) => string;
}

// 三个战场：官道比武力、江东比智谋、许都比声望；后两者不计兵器
const MODE_CONFIG: Record<BattleMode, ModeConfig> = {
  land: {
    region: '官道', title: '自动回合战', statLabel: '战力', unlockHomeLevel: 1, unlockHomeName: '', enterLabel: '出征讨伐', background: null,
    summary: '普通讨伐将自动结算攻防回合',
    eyebrow: '自动回合战', intro: '整军出征', fighting: '激战正酣', attack: '出手', crit: '暴击', counter: '反击', counterCrit: '反扑暴击',
    win: '讨伐得胜', loss: '败退整军', enemyBroken: '阵脚崩溃', exhausted: '兵势已尽，只得暂退', retreat: '鸣金收兵',
    scoutReport: (enemy) => `斥候回报：${enemy}列阵于前。`, departure: (lord, weapon) => `${lord}提${weapon}出征。`, battleStart: (weapon) => `${weapon}锋芒毕露，战斗开始。`
  },
  naval: {
    region: '江东', title: '水战', statLabel: '智谋', unlockHomeLevel: NAVAL_UNLOCK_HOME_LEVEL, unlockHomeName: '砖瓦宅', enterLabel: '扬帆出战', background: 'assets/ui/ui_naval_battle.png',
    summary: '水战比智谋（主公 + 伴侣 + 宅邸），兵器不计',
    eyebrow: '江东水战', intro: '整船列阵', fighting: '鏖战江上', attack: '放箭', crit: '火攻', counter: '撞船反扑', counterCrit: '火船逼近',
    win: '水战告捷', loss: '折戟江上', enemyBroken: '船阵溃散', exhausted: '战船受损，只得回港', retreat: '鸣金收兵',
    scoutReport: (enemy) => `哨船回报：${enemy}列阵江上。`, departure: (lord) => `${lord}登楼船督战。`, battleStart: () => '战鼓擂响，船阵前压。'
  },
  court: {
    region: '许都', title: '朝堂', statLabel: '声望', unlockHomeLevel: COURT_UNLOCK_HOME_LEVEL, unlockHomeName: '府邸', enterLabel: '入朝议事', background: 'assets/ui/ui_court_battle.png',
    summary: '朝议比声望（主公 + 伴侣 + 宅邸），兵器不计',
    eyebrow: '许都朝堂', intro: '整冠入朝', fighting: '朝议正酣', attack: '进言', crit: '弹劾', counter: '结党反驳', counterCrit: '构陷', 
    win: '朝议得胜', loss: '失势出京', enemyBroken: '理屈词穷', exhausted: '孤立无援，只得拂袖而去', retreat: '拂袖退朝',
    scoutReport: (enemy) => `朝中传报：${enemy}已联络党羽。`, departure: (lord) => `${lord}持笏入殿。`, battleStart: () => '钟鼓齐鸣，朝议开始。'
  },
  frontier: {
    region: '北疆', title: '边患', statLabel: '战力', unlockHomeLevel: FRONTIER_UNLOCK_HOME_LEVEL, unlockHomeName: '府邸', enterLabel: '出关迎战', background: 'assets/ui/ui_frontier_battle.png',
    summary: '边患每 10 日一起，须在 24 小时内出关迎战（比武力），缴获为陆战两倍；不管或战败则边郡失守，损失 5% 金币',
    eyebrow: '北疆边患', intro: '点兵出关', fighting: '鏖战边塞', attack: '冲阵', crit: '箭雨', counter: '胡骑回冲', counterCrit: '铁骑合围',
    win: '靖边得胜', loss: '边郡失守', enemyBroken: '溃散北遁', exhausted: '力竭退守关内', retreat: '退守关内',
    scoutReport: (enemy) => `烽燧急报：${enemy}已过长城。`, departure: (lord, weapon) => `${lord}提${weapon}点兵出关。`, battleStart: (weapon) => `${weapon}寒光一闪，边塞之战开始。`
  }
};

const VENUES: Venue[] = [
  { id: 'beginner', name: '初级场', requiredPower: 80, prize: '胜利可得基础缴获', rewardGold: 1500 },
  { id: 'middle', name: '中级场', requiredPower: 140, prize: '更高金币奖励', rewardGold: 4000 },
  { id: 'high', name: '高级场', requiredPower: 190, prize: '名望与重赏', rewardGold: 10000 }
];

// 出征开场动画（旌旗入阵 + 兵器特效）每次打开游戏只在第一场播放
let introPlayedThisSession = false;

export function BattleScreen({
  lord,
  weapon,
  totalPower,
  navalPower,
  courtPower,
  homeLevel,
  farm,
  frontier,
  orders,
  day,
  onUpgradeFarm,
  onBattleStart,
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
  // 每个战场自选的对手档位；null = 推荐档。边患不可选
  const [tierByMode, setTierByMode] = useState<Record<BattleMode, number | null>>({ land: null, naval: null, court: null, frontier: null });
  const [farmNotice, setFarmNotice] = useState('');
  const selectedRegion = MAP_REGIONS.find((region) => region.id === selectedRegionId) ?? MAP_REGIONS[0];
  const selectedVenue = VENUES.find((venue) => venue.id === venueId) ?? VENUES[0];
  const mode: BattleMode = selectedRegion.mode === 'naval' || selectedRegion.mode === 'court' || selectedRegion.mode === 'frontier' ? selectedRegion.mode : 'land';
  const wording = MODE_CONFIG[mode];
  const powerByMode: Record<BattleMode, number> = { land: totalPower, naval: navalPower, court: courtPower, frontier: totalPower };
  const attackPower = powerByMode[mode];
  const isModeLocked = (regionMode: RegionMode) =>
    regionMode === 'farm' ? homeLevel < FARM_UNLOCK_HOME_LEVEL : regionMode !== 'doudizhu' && regionMode !== 'locked' && homeLevel < MODE_CONFIG[regionMode].unlockHomeLevel;
  const modeLocked = isModeLocked(selectedRegion.mode);
  const roster = ROSTERS[mode];
  const recommendedTier = recommendedTierIndex(roster, attackPower);
  const selectedTier = mode === 'frontier' ? recommendedTier : tierByMode[mode] ?? recommendedTier;
  const enemy = useMemo(() => enemyForTier(roster, selectedTier, attackPower), [roster, selectedTier, attackPower]);
  // 各档预估胜率（仅地图面板需要）
  const tierOdds = useMemo(
    () => (mapOpen && mode !== 'frontier' ? roster.map((_tier, index) => estimateWinRate(attackPower, enemyForTier(roster, index, attackPower).power)) : []),
    [attackPower, mapOpen, mode, roster]
  );
  const lossGold = Math.round(enemy.rewardGold * LOSS_PENALTY_RATE);
  // 北疆败则扣当前金币 5%（封顶），出征那一刻定下
  const [frontierLoss, setFrontierLoss] = useState(0);
  const maxPlayerHp = playerMaxHp(attackPower);
  const maxEnemyHp = enemyMaxHp(enemy.power);
  const selectedVenueLocked = selectedRegion.mode === 'doudizhu' && totalPower < selectedVenue.requiredPower;
  const raidActive = Boolean(frontier.raid);
  const needsOrder = selectedRegion.mode !== 'frontier';
  const outOfOrders = needsOrder && orders < 1;
  const canEnterSelectedRegion =
    selectedRegion.mode !== 'locked' && selectedRegion.mode !== 'farm' && !selectedVenueLocked && !modeLocked && !(selectedRegion.mode === 'frontier' && !raidActive) && !outOfOrders;
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
      if (introPlayedThisSession) {
        setRuntime((prev) => ({ ...prev, phase: 'battle', logs: [wording.battleStart(weapon.name), ...prev.logs] }));
        return;
      }
      introPlayedThisSession = true;
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
          logs: [wording.battleStart(weapon.name), ...prev.logs]
        }));
      }
    }

    void runIntro();
    return () => {
      cancelled = true;
    };
  }, [doudizhuOpen, lord.name, mapOpen, onPlayEffect, onSfx, weapon, wording]);

  // 一回合的攻防；定时器与「直接结算」共用
  const stepRound = useCallback((prev: BattleRuntime): BattleRuntime => {
    if (prev.phase !== 'battle' || prev.result) {
      return prev;
    }
    const playerCrit = Math.random() < PLAYER_CRIT_RATE;
    const enemyCrit = Math.random() < ENEMY_CRIT_RATE;
    const playerDamage = rollDamage(attackPower, enemy.power, playerCrit);
    const nextEnemyHp = Math.max(0, prev.enemyHp - playerDamage);
    let nextPlayerHp = prev.playerHp;
    const round = prev.round + 1;
    const logs = [`第${round}合：${lord.name}${playerCrit ? wording.crit : wording.attack}，造成 ${playerDamage} 伤害。`, ...prev.logs];

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
    return { phase: result ? 'result' : 'battle', playerHp: nextPlayerHp, enemyHp: nextEnemyHp, round, logs: logs.slice(0, 12), result };
  }, [attackPower, enemy, lord.name, wording]);

  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  useEffect(() => {
    if (runtime.phase !== 'battle') {
      return;
    }
    const timer = window.setInterval(() => setRuntime((prev) => stepRound(prev)), 800 / speed);
    return () => window.clearInterval(timer);
  }, [runtime.phase, speed, stepRound]);

  // 直接结算：把剩余回合一口气算完
  const finishInstantly = () => {
    setRuntime((prev) => {
      let next = prev;
      for (let guard = 0; guard < 600 && next.phase === 'battle' && !next.result; guard += 1) {
        next = stepRound(next);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!runtime.result || settledRef.current) {
      return;
    }
    settledRef.current = true;
    const win = runtime.result === 'win';
    onSfx(win ? 'audio/sfx/sfx_victory.mp3' : 'audio/sfx/sfx_defeat.mp3', 0.58);
    onResolved(win, win ? enemy.rewardGold : 0, mode, false, lossGold);
  }, [enemy.rewardGold, lossGold, mode, onResolved, onSfx, runtime.result]);

  const retreat = () => {
    if (runtime.phase === 'result') {
      onReturnHome();
      return;
    }

    if (!settledRef.current) {
      settledRef.current = true;
      onResolved(false, 0, mode, true, lossGold);
    }
    setRuntime((prev) => ({
      ...prev,
      phase: 'result',
      result: 'retreat',
      logs: [mode === 'frontier' ? `${wording.retreat}，边患未解，来日再战。` : `${wording.retreat}，折损军资 ${lossGold.toLocaleString()} 金。`, ...prev.logs]
    }));
  };

  const resultTitle = runtime.result === 'win' ? wording.win : runtime.result === 'retreat' ? wording.retreat : runtime.result === 'loss' ? wording.loss : wording.fighting;

  if (doudizhuOpen) {
    return (
      <DouDizhuGame
        lord={lord}
        wins={wins}
        losses={losses}
        rewardGold={selectedVenue.rewardGold}
        lossGold={Math.round(selectedVenue.rewardGold * LOSS_PENALTY_RATE)}
        onSfx={onSfx}
        onResolved={(win, rewardGold, lossGold) => onResolved(win, rewardGold, 'land', false, lossGold)}
        onReturnHome={onReturnHome}
      />
    );
  }

  if (mapOpen) {
    return (
      <main className="screen battle-screen expedition-screen">
        <header className="screen-header">
          <div>
            <span className="eyebrow">出征地图 · 军令 {orders}/{ORDER_CAP}{orders < ORDER_CAP ? `（${daysUntilNextOrder(day)} 日后 +1）` : ''}</span>
            <h2>九州征途</h2>
          </div>
          <GameButton variant="ghost" onClick={onReturnHome}>
            回府
          </GameButton>
        </header>

        <section className="expedition-map" aria-label="三国地图">
          <div className="expedition-map__terrain" />
          {MAP_REGIONS.map((region) => {
            const lockedByHome = isModeLocked(region.mode);
            const available = region.mode !== 'locked' && !lockedByHome;
            const stateLabel = lockedByHome
              ? region.mode === 'farm' ? '砖瓦宅后开放' : region.mode !== 'doudizhu' && region.mode !== 'locked' ? `${MODE_CONFIG[region.mode].unlockHomeName}后开放` : region.state
              : region.mode === 'farm' && farm.current.level > 0 ? `屯田 ${farm.current.level} 级` : region.mode === 'frontier' && raidActive ? '边患！' : region.state;
            return (
              <button
                key={region.id}
                type="button"
                className={`map-node ${available ? 'is-available' : 'is-locked'} ${region.id === selectedRegionId ? 'is-selected' : ''} ${region.mode === 'frontier' && raidActive ? 'is-alert' : ''}`}
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
              : `本场胜缴获 ${selectedVenue.rewardGold.toLocaleString()} 金，败折损 ${Math.round(selectedVenue.rewardGold * LOSS_PENALTY_RATE).toLocaleString()} 金。`}
          </p>
          </section>
        ) : selectedRegion.mode === 'farm' ? (
          <section className="venue-panel farm-panel" aria-label="屯田" style={{ '--battle-bg': `url(${imageUrl('assets/ui/ui_farm_xishu.png', 512)})` } as CSSProperties}>
            <div className="section-title">
              <span>西蜀 · 屯田 · 政务收入 +{farm.current.incomePercent}%</span>
              <strong>{modeLocked ? '尚未开放' : `${farm.current.name}${farm.current.level > 0 ? ` · ${farm.current.level} 级` : ''}`}</strong>
            </div>
            <p className="venue-summary">
              {modeLocked
                ? `宅邸升至砖瓦宅（${FARM_UNLOCK_HOME_LEVEL} 级）后可开垦。屯田是独立于宅邸的田产，投入一次，每日收入永久提高。`
                : farm.next
                  ? `${farm.current.description} 下一级「${farm.next.name}」需投入 ${farm.next.cost.toLocaleString()} 金，政务收入加成从 +${farm.current.incomePercent}% 提到 +${farm.next.incomePercent}%（按当前宅邸每次政务多约 ${Math.round(farm.homeIncome * (farm.next.incomePercent - farm.current.incomePercent) / 100)} 金，宅邸越高越值）。`
                  : `${farm.current.description} 屯田已达顶级。`}
            </p>
            {farmNotice && (
              <p className="partner-market__notice" role="status">
                {farmNotice}
              </p>
            )}
            {!modeLocked && farm.next && (
              <GameButton
                block
                variant={farm.gold >= farm.next.cost ? 'primary' : 'secondary'}
                onClick={() => {
                  if (onUpgradeFarm()) {
                    setFarmNotice(`屯田升至「${farm.next?.name}」。`);
                    return;
                  }
                  setFarmNotice(`金不足，还差 ${Math.max(0, (farm.next?.cost ?? 0) - farm.gold).toLocaleString()} 金。`);
                }}
              >
                {farm.gold >= farm.next.cost ? `投入 ${farm.next.cost.toLocaleString()} 金 · ${farm.next.name}` : `差 ${(farm.next.cost - farm.gold).toLocaleString()} 金 · ${farm.next.name}`}
              </GameButton>
            )}
          </section>
        ) : (
          <section className="venue-panel" aria-label={`${wording.title}说明`}>
            <div className="section-title">
              <span>{wording.region} · {wording.title} · {mode === 'naval' || mode === 'court' ? `${wording.statLabel}实力 ${attackPower}（${wording.statLabel} ${attackPower - homeLevel * 5} + 宅邸 ${homeLevel * 5}）` : `当前${wording.statLabel} ${attackPower}`}</span>
              {(modeLocked || mode === 'frontier') && <strong>{modeLocked ? '尚未开放' : enemy.name}</strong>}
            </div>
            {!modeLocked && mode !== 'frontier' && (
              <div className="venue-grid tier-grid" aria-label="选择对手">
                {roster.map((tier, index) => {
                  const odds = tierOdds[index] ?? 0;
                  const tierLoss = Math.round(tier.rewardGold * LOSS_PENALTY_RATE);
                  const unaffordable = tierLoss > farm.gold;
                  const hopeless = odds < 0.05 || unaffordable;
                  const recommended = index === recommendedTier;
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      className={`venue-card tier-card ${index === selectedTier ? 'is-selected' : ''} ${hopeless ? 'is-hopeless' : ''}`}
                      disabled={hopeless}
                      onClick={() => setTierByMode((prev) => ({ ...prev, [mode]: index }))}
                    >
                      <ImageWithFallback src={imageUrl(enemyImagePath(tier), 160)} alt={tier.name} className="tier-card__avatar" />
                      <strong>{tier.name}</strong>
                      <span>{recommended ? '推荐 · ' : ''}胜率约 {Math.round(odds * 20) * 5}%</span>
                      <em>{unaffordable ? `败损 ${tierLoss.toLocaleString()} 金，金币不足` : hopeless ? '力不能及' : `缴获 ${tier.rewardGold.toLocaleString()} 金`}</em>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="venue-summary">
              {modeLocked
                ? `宅邸升至${wording.unlockHomeName}（${wording.unlockHomeLevel} 级）后可进入。${wording.summary}。`
                : mode === 'frontier'
                  ? frontier.raid
                    ? `胡骑犯边！${formatRemaining(raidRemainingMs(frontier.raid))}内须出关迎战（不耗军令），预估胜率约 ${Math.round(estimateWinRate(attackPower, enemy.power) * 20) * 5}%，胜利可缴获 ${enemy.rewardGold.toLocaleString()} 金；不管或战败则损失 ${Math.round(RAID_PENALTY_RATE * 100)}% 金币（最多 ${RAID_PENALTY_CAP.toLocaleString()}）。`
                    : `边境安宁，下次边患不早于第 ${Math.max(frontier.nextRaidDay, frontier.day + 1)} 日（处理政务到那天即起）。${wording.summary}。`
                  : `${wording.summary}。已选 ${enemy.name}，预估胜率约 ${Math.round((tierOdds[selectedTier] ?? 0) * 20) * 5}%：胜缴获 ${enemy.rewardGold.toLocaleString()} 金，败折损 ${lossGold.toLocaleString()} 金。`}
            </p>
          </section>
        )}

        {selectedRegion.mode !== 'farm' && (
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
              logs: [wording.scoutReport(enemy.name), wording.departure(lord.name, weapon.name)],
              result: null
            });
            setFrontierLoss(raidPenalty(farm.gold));
            onBattleStart(
              selectedRegion.mode === 'doudizhu' ? 'land' : mode,
              selectedRegion.mode === 'doudizhu' ? Math.round(selectedVenue.rewardGold * LOSS_PENALTY_RATE) : lossGold
            );
            setDoudizhuOpen(selectedRegion.mode === 'doudizhu');
            setMapOpen(false);
          }}
        >
          {outOfOrders ? `军令不足 · ${daysUntilNextOrder(day)} 日后回复` : `${selectedRegion.mode === 'doudizhu' ? '进入斗地主' : wording.enterLabel}${needsOrder ? ' · 耗 1 军令' : ''}`}
        </GameButton>
        )}
        {selectedRegion.mode !== 'farm' && <p className="orders-note">每场出征耗 1 道军令（北疆边患除外），每 3 日回 1 道，最多存 {ORDER_CAP} 道。出征中途离开页面按认输处理。</p>}
      </main>
    );
  }

  return (
    <main className={`screen battle-screen ${wording.background ? 'has-backdrop' : ''}`} style={wording.background ? ({ '--battle-bg': `url(${imageUrl(wording.background, 512)})` } as CSSProperties) : undefined}>
      <header className="screen-header">
        <div>
          <span className="eyebrow">{wording.eyebrow}</span>
          <h2>{runtime.phase === 'intro' ? wording.intro : resultTitle}</h2>
        </div>
        <span className="battle-record">胜 {wins} · 负 {losses}</span>
      </header>

      <section className="battle-arena">
        <BattleFighter name={lord.name} title={mode === 'land' ? weapon.name : `${wording.statLabel} ${attackPower}`} image={imageUrl(lord.imagePath, 512)} hp={runtime.playerHp} maxHp={maxPlayerHp} />
        <div className="battle-vs">VS</div>
        <BattleFighter name={enemy.name} title={enemy.description} image={imageUrl(enemyImagePath(enemy), 320)} hp={runtime.enemyHp} maxHp={maxEnemyHp} enemy />
      </section>

      <section className="battle-info">
        <div>
          <span>匹配敌军</span>
          <strong>{enemy.name}</strong>
        </div>
        <div>
          <span>{mode === 'land' ? '当前兵器' : '比拼'}</span>
          <strong>{mode === 'land' ? weapon.name : wording.statLabel}</strong>
        </div>
        <div>
          <span>{runtime.phase === 'result' ? '本战金币' : '胜 / 败'}</span>
          <strong>
            {runtime.phase === 'result'
              ? runtime.result === 'win'
                ? `+${enemy.rewardGold.toLocaleString()} 金`
                : mode === 'frontier'
                  ? runtime.result === 'retreat' ? '±0 金' : `−${frontierLoss.toLocaleString()} 金`
                  : `−${lossGold.toLocaleString()} 金`
              : (
                  <>
                    <span className="battle-info__line">胜 +{enemy.rewardGold.toLocaleString()} 金</span>
                    <span className="battle-info__line">败 −{(mode === 'frontier' ? frontierLoss : lossGold).toLocaleString()} 金</span>
                  </>
                )}
          </strong>
        </div>
      </section>

      {runtime.phase === 'battle' && (
        <div className="battle-speed">
          <button type="button" className={speed === 1 ? 'is-active' : ''} onClick={() => setSpeed(1)}>常速</button>
          <button type="button" className={speed === 2 ? 'is-active' : ''} onClick={() => setSpeed(2)}>×2</button>
          <button type="button" className={speed === 4 ? 'is-active' : ''} onClick={() => setSpeed(4)}>×4</button>
          <button type="button" onClick={finishInstantly}>直接结算</button>
        </div>
      )}
      <section className="battle-log" aria-live="polite">
        {runtime.logs.map((log, index) => (
          <p key={`${log}-${index}`}>{log}</p>
        ))}
      </section>

      <GameButton block variant={runtime.phase === 'result' ? 'primary' : 'danger'} onClick={retreat}>
        {runtime.phase === 'result' ? '返回家业' : mode === 'frontier' ? wording.retreat : `认输 · 损失 ${lossGold.toLocaleString()} 金`}
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
        <small>兵力 {hp} / {maxHp}</small>
      </div>
    </article>
  );
}
