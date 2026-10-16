import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { lords } from '../data/gameData';
import type { Lord } from '../data/gameData';
import { imageUrl } from '../lib/assets';
import type { Card, Combo, PlayerIndex } from '../lib/doudizhu';
import { AI_SKILL_LABEL, AI_STYLE_LABEL, LORD_AI_STYLE, type AiSkill, type ComboType, canBeat, chooseAiPlay, comboLabel, createDoudizhuDeal, ddzRandom, evaluateCards, findPlayableCombos, formatCards, handSummary, sortCards, sortCardsDescending, unseenSummary } from '../lib/doudizhu';
import { MIFUREN_MIN_PAY, MIFUREN_REFUND_MULTIPLIER, partnerSkills, SKILL_LEVEL_NAME, xiaoqiaoLossFactor, ZHURONG_STEP, type EscortInfo } from '../data/partnerSkills';
import type { AiStyle } from '../lib/doudizhu';
import { GameButton } from './common/GameButton';
import { JokerArt, SuitIcon } from './common/CardArt';
import { ImageWithFallback } from './common/ImageWithFallback';

interface DouDizhuGameProps {
  lord: Lord;
  wins: number;
  losses: number;
  rewardGold: number;
  /** 场次决定农民牌艺 */
  aiSkill: AiSkill;
  lossGold: number;
  onSfx: (path: string, volume?: number) => void;
  /** skillUses：本局随行伴侣技能发动次数；refundOrder：糜夫人「舍身」失手 ×4 起返还军令 */
  onResolved: (win: boolean, rewardGold: number, lossGold: number, forfeit?: boolean, multiplier?: number, skillUses?: number, refundOrder?: boolean) => void;
  /** 倍数或身份变化时回写存档，中途刷新按当前认输金额结算 */
  onStakeChange?: (multiplier: number, share: number) => void;
  onReturnHome: () => void;
  /** 已拿下的郡（牌局特权）：changsha 农民赢也拿全份、bajun 赢牌至少 ×2、yingchuan 开局探下家三张、liaodong 叫地主前看一张底牌 */
  perks?: string[];
  /**
   * 攻郡牌局：对面坐守将，不赢金币，赢了拿下这郡；stakeRefund 是糜夫人「舍身」未克时护回的军资。
   * mode 'defend' 是守城局（邻郡反攻）：对面坐来犯将，不赢金不扣金，守住城防回满、失手城防 −1；forceLandlord 时城主坐庄（跳过叫地主）
   */
  conquest?: { fiefName: string; garrison: string; portrait: string; stakeRefund?: number; mode?: 'attack' | 'defend'; forceLandlord?: boolean };
  /** 随行伴侣（开局冻结）：牌桌技能按等级生效 */
  escort?: EscortInfo | null;
  /** 结算后「再来一局」；不传则只有返回家业 */
  onPlayAgain?: () => void;
  playAgainLabel?: string;
  /** 切磋局（v2.3）：不耗军令、不给缴获、不计战绩，随行伴侣技能照常；离席不扣金 */
  practice?: boolean;
}

interface PlayedMove {
  player: PlayerIndex;
  cards: Card[];
  combo: Combo;
}

interface TableState {
  hands: Record<PlayerIndex, Card[]>;
  landlordCards: Card[];
  selectedIds: string[];
  currentPlayer: PlayerIndex;
  consecutivePasses: number;
  lastPlay: PlayedMove | null;
  recentMoves: Record<PlayerIndex, Card[]>;
  recentActions: Record<PlayerIndex, SeatAction>;
  history: string[];
  winner: PlayerIndex | null;
  /** 倍数：炸弹、王炸各翻一倍，封顶 MAX_MULTIPLIER；春天/反春在结算时再翻一倍 */
  multiplier: number;
  /** 各家出过几手（判春天用） */
  plays: Record<PlayerIndex, number>;
  /** 已打出的所有牌（记牌器用） */
  played: Card[];
  /** 桌心大字特效，id 变了就重播动画 */
  flash: { id: number; text: string; big: boolean } | null;
  /** 叫地主阶段 → 出牌阶段 */
  phase: 'bidding' | 'playing';
  landlord: PlayerIndex;
  bid: BidState;
  /** 随行伴侣技能的牌局状态 */
  skill: SkillState;
}

interface SkillState {
  id: string | null;
  level: 0 | 1 | 2 | 3;
  usesLeft: number;
  /** 小乔「赤壁」：1 = 未加倍 */
  doubled: 1 | 2;
  /** 小乔「赤壁」：叫完地主后待选加不加倍 */
  offer: boolean;
  /** 孙尚香：本局你打出的炸弹数 */
  myBombs: number;
  /** 祝融：本局你打出的长牌型手数 */
  longCombos: number;
  /** 叫地主阶段额外看到的底牌张数（排在辽东那张之后） */
  peeked: number;
  /** 黄月英「木牛流马」：等你点一张手牌去换；flipIndex 是翻开待换的底牌（盲换为 null） */
  swapping: boolean;
  flipIndex: number | null;
  /** 步练师「问计」：回答与对应的选牌 */
  answer: { key: string; text: string } | null;
  /** 本局发动次数（结算时记入随行统计） */
  uses: number;
}

type BidWord = '叫地主' | '不叫' | '抢地主' | '不抢';

interface BidState {
  turn: PlayerIndex;
  /** 当前叫到地主的人（还没人叫为 null） */
  candidate: PlayerIndex | null;
  firstCaller: PlayerIndex | null;
  /** 一圈里已表态的人数；第一个叫的人在别人抢过之后还有一次回抢机会 */
  acted: number;
  rebidUsed: boolean;
  words: Record<PlayerIndex, BidWord | null>;
}

interface SeatAction {
  kind: 'idle' | 'play' | 'pass';
  label: string;
}

interface PlayerProfile {
  name: string;
  title: string;
  role: '地主' | '农民';
  imagePath: string;
  style: AiStyle | null;
  skill?: AiSkill;
}

const OPPONENT_POOL = ['caocao', 'sunquan', 'liubei', 'zhouyu', 'zhaoyun', 'simayi', 'zhugeliang', 'guanyu', 'zhangfei', 'lvbu', 'machao', 'sunce', 'luxun'];
// 竖屏手牌超过这个张数就分两行，避免 20 张挤成一排看不清点数
const TWO_ROW_THRESHOLD = 12;
// 平板竖屏也用两行手牌：样式里平板竖屏整桌 zoom 放大，排布按手机竖屏算
const PORTRAIT_QUERY = '(orientation: portrait)';

export function DouDizhuGame({ lord, wins, losses, rewardGold: rewardGoldProp, aiSkill, lossGold, onSfx, onResolved, onStakeChange, onReturnHome, perks = [], conquest, onPlayAgain, playAgainLabel, escort: escortProp, practice = false }: DouDizhuGameProps) {
  // 缴获按开局时定：练兵之策的翻倍在结算入账后就清掉，不冻结的话横幅会跟着掉回一半
  const [rewardGold] = useState(rewardGoldProp);
  // 随行伴侣与等级开局冻结
  const [escort] = useState<EscortInfo | null>(() => (escortProp && partnerSkills[escortProp.id] ? escortProp : null));
  const escortName = escort?.name ?? '';
  const defend = conquest?.mode === 'defend';
  const [table, setTable] = useState<TableState>(() => createInitialTable(newSkillState(escort), escortName, defend && Boolean(conquest?.forceLandlord)));
  const [hintIndex, setHintIndex] = useState(0);
  // 托管：连续两次超时自动进入（新手局除外），也可手动开；托管时由系统按老手水平代打，叫牌一律不叫
  const [autoPilot, setAutoPilot] = useState(false);
  // 小乔「赤壁」加倍选择待定（攻郡牌局不赢金币，加倍没有意义，不弹；托管时不弹）
  const offerPending = table.skill.offer && table.winner === null && !autoPilot && !conquest;
  const settledRef = useRef(false);
  const aiTimerRef = useRef<number | null>(null);
  const [gamesPlayedAtStart] = useState(() => wins + losses);
  // 新手局：倒计时加倍，超时只代这一手、不进托管
  const novice = gamesPlayedAtStart < NOVICE_GAMES;
  const profiles = useMemo(() => {
    const base = createPlayerProfiles(lord, gamesPlayedAtStart, aiSkill);
    // 攻郡：下家换成该郡守将
    return conquest ? { ...base, 1: { ...base[1], name: conquest.garrison, title: defend ? `来犯${conquest.fiefName}` : `${conquest.fiefName}守将`, imagePath: `assets/enemies/enemy_${conquest.portrait}.png` } } : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSkill, lord, gamesPlayedAtStart]);
  const hasPerk = (id: string) => perks.includes(id);
  // 颍川「谋士献策」：开局探得下家手里最大的三张（重新发牌时底牌变了就重探）
  const dealKey = table.landlordCards.map((card) => card.id).join(',');
  const scouted = useMemo(
    () => (hasPerk('yingchuan') ? sortCardsDescending(table.hands[1]).slice(0, 3) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dealKey]
  );
  // 貂蝉「闭月」：开局探得上家（座位 2）最大几张；打出去的就不再显示
  const skillId = table.skill.id;
  const skillDef = skillId ? partnerSkills[skillId] : null;
  const skillLevel = table.skill.level;
  const skillVal = skillValue(table.skill);
  const moonScouted = useMemo(
    () => (skillId === 'diaochan' ? sortCardsDescending(table.hands[2]).slice(0, skillVal) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dealKey]
  );
  const playerNames = useMemo(
    () => ({
      0: profiles[0].name,
      1: profiles[1].name,
      2: profiles[2].name
    }) satisfies Record<PlayerIndex, string>,
    [profiles]
  );
  const styles = useMemo(() => ({ 0: profiles[0].style, 1: profiles[1].style, 2: profiles[2].style }) satisfies Record<PlayerIndex, AiStyle | null>, [profiles]);
  const [portrait, setPortrait] = useState(() => typeof window !== 'undefined' && window.matchMedia(PORTRAIT_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(PORTRAIT_QUERY);
    const update = () => setPortrait(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const playerHand = table.hands[0];
  const displayedHand = useMemo(() => sortCardsDescending(playerHand), [playerHand]);
  const twoRows = portrait && displayedHand.length > TWO_ROW_THRESHOLD;
  const selectedCards = useMemo(
    () => sortCards(playerHand.filter((card) => table.selectedIds.includes(card.id))),
    [playerHand, table.selectedIds]
  );
  const selectedCombo = useMemo(() => evaluateCards(selectedCards), [selectedCards]);
  const targetCombo = table.lastPlay?.player === 0 ? null : table.lastPlay?.combo ?? null;
  const playableHints = useMemo(() => findPlayableCombos(playerHand, targetCombo), [playerHand, targetCombo]);
  const suggestedCards = playableHints.length > 0 ? playableHints[hintIndex % playableHints.length] : null;
  const canPlay = table.phase === 'playing' && table.currentPlayer === 0 && canBeat(selectedCombo, targetCombo);
  const canPass = table.currentPlayer === 0 && Boolean(table.lastPlay && table.lastPlay.player !== 0);
  const canHint = table.phase === 'playing' && table.currentPlayer === 0 && table.winner === null && playableHints.length > 0;
  const selectedCopy = table.winner !== null
    ? '牌局已结束'
    : table.currentPlayer !== 0
      ? `等待 ${playerNames[table.currentPlayer]}`
      : selectedCards.length === 0
        ? targetCombo
          ? `需压过 ${comboLabel(targetCombo)}`
          : '待选牌'
        : selectedCombo
          ? canBeat(selectedCombo, targetCombo)
            ? `${selectedCombo.label} · ${formatCards(selectedCards)}`
            : `${selectedCombo.label} 不够大`
          : '牌型不合法';
  const bidding = table.phase === 'bidding';
  const roleOf = (index: PlayerIndex) => (bidding ? '叫牌' : index === table.landlord ? '地主' : '农民');
  // 玩家赢：自己是地主就要自己先走完；自己是农民则任一农民先走完即可
  const playerWins = table.winner !== null && (table.landlord === 0 ? table.winner === 0 : table.winner !== table.landlord);
  // 农民输赢按地主的一半结算（主流规则里地主一打二、输赢翻倍）
  const share = !bidding && table.landlord !== 0 ? 0.5 : 1;
  // 长沙「兵源充沛」：当农民赢了也拿全份（输仍按半份）
  const winShare = hasPerk('changsha') ? 1 : share;
  const spring = springOf(table);
  const doubled = table.skill.doubled;
  // 小乔「赤壁」加倍：胜负一并翻倍（结算倍数 = 倍数 × 春天 × 加倍，仍封顶 8）
  const finalMultiplier = Math.min(MAX_MULTIPLIER, table.multiplier * (spring ? 2 : 1) * doubled);
  // 巴郡「盐铁之利」：赢牌倍数至少 ×2
  const bajunFloor = (multiplier: number) => (hasPerk('bajun') ? Math.max(2, multiplier) : multiplier);
  const winMultiplier = bajunFloor(finalMultiplier);
  // 祝融「烈火」：长牌型每手 +5%，到上限为止
  const fireBonus = skillId === 'zhurong' ? Math.min(skillVal, table.skill.longCombos * ZHURONG_STEP) : 0;
  const winGold = Math.round(rewardGold * winMultiplier * winShare * (1 + fireBonus));
  // 加倍是对赌：失手按「加倍实际多赢了多少」加付（正常一二重 ×20、三重 ×15，即平时两成 → 缴获 4 倍 / 3 倍）；
  // 倍数已到封顶 8 时加倍多赢不到，失手也不加付（xiaoqiaoLossFactor）
  const xiaoqiaoGain = (multiplier: number) => bajunFloor(Math.min(MAX_MULTIPLIER, multiplier * 2)) / bajunFloor(Math.min(MAX_MULTIPLIER, multiplier));
  const lossMultOf = (multiplier: number, isDoubled = doubled > 1) => Math.min(MAX_MULTIPLIER, multiplier) * (isDoubled ? xiaoqiaoLossFactor(skillLevel, xiaoqiaoGain(multiplier)) : 1);
  const lossMultiplier = lossMultOf(table.multiplier * (spring ? 2 : 1));
  const loseGold = Math.round(lossGold * lossMultiplier * share);
  // 认输与刷新逃局：按当前倍数（含加倍）结算
  const forfeitMultiplier = lossMultOf(table.multiplier);
  const forfeitGold = Math.round(lossGold * forfeitMultiplier * share);
  // 糜夫人「舍身」：失手倍数到 ×4 返还本局军令；攻郡不返军令，改退军资
  const refundOrder = skillId === 'mifuren' && !conquest && !practice && table.winner !== null && !playerWins && lossMultiplier >= MIFUREN_REFUND_MULTIPLIER;
  const mifurenCut = skillId === 'mifuren' && skillVal > 0 && !conquest;
  // 本局技能发动次数：主动技能按次，开局即生效的被动（闭月、胡笳辨音）记一次，舍身在失手时记一次
  const settleUses = (win: boolean) => table.skill.uses
    + (skillId === 'diaochan' || skillId === 'caiwenji' ? 1 : 0)
    + (skillId === 'mifuren' && !win && (mifurenCut || refundOrder || Boolean(conquest?.stakeRefund)) ? 1 : 0);
  // 叫地主阶段看得到的底牌：辽东一张 + 技能多看的
  const kittyVisible = Math.min(table.landlordCards.length, (hasPerk('liaodong') ? 1 : 0) + table.skill.peeked);
  // 记牌器：去掉自己手牌和已出的牌，剩下的就是另外两家手里的
  const counter = COUNTER_RANKS.map((item) => ({
    label: item.label,
    left: item.total - playerHand.filter(item.match).length - table.played.filter(item.match).length
  }));
  // 失手时顶栏/横幅仍显示牌桌倍数（封顶 8），对赌加付另写「付缴获 ×N」
  const shownMult = playerWins ? winMultiplier : doubled > 1 ? Math.min(MAX_MULTIPLIER, table.multiplier * (spring ? 2 : 1) * doubled) : lossMultiplier;
  // 「付缴获 ×N」= 实际扣金 ÷ 本场胜缴获（已含农民半份、汝南减半等）
  const payRatio = (gold: number) => (rewardGold > 0 ? formatMult(Math.round((gold / rewardGold) * 10) / 10) : '0');
  const shownShare = playerWins ? winShare : share;
  // 伴侣技能的结算项，写法与「巴郡保底」一致
  const skillTags = [
    doubled > 1 ? (playerWins ? '赤壁加倍 ×2' : `赤壁对赌 · 付缴获 ×${payRatio(loseGold)}`) : '',
    playerWins && fireBonus > 0 ? `烈火 +${Math.round(fireBonus * 100)}%` : '',
    !playerWins && mifurenCut ? `舍身少付 ${Math.round(Math.min(1 - MIFUREN_MIN_PAY, skillVal) * 100)}%` : '',
    refundOrder ? '舍身：军令已返还' : ''
  ].filter(Boolean);
  const multTag = shownMult > 1 || shownShare < 1 || skillTags.length > 0 ? `（×${formatMult(shownMult)}${shownShare < 1 ? ' · 农民半份' : ''}${spring ? ` · ${spring}` : ''}${playerWins && winMultiplier > finalMultiplier ? ' · 巴郡保底' : ''}${playerWins && winShare > share ? ' · 长沙全份' : ''}${skillTags.map((tag) => ` · ${tag}`).join('')}）` : '';
  const statusCopy = table.winner !== null
    ? defend && conquest
      ? playerWins
        ? `击退${conquest.garrison}，${conquest.fiefName}城防回满`
        : `${playerNames[table.winner]}先走完，${conquest.fiefName}城防 −1（不扣金）`
      : conquest
      ? playerWins
        ? `击败守将${conquest.garrison}，${conquest.fiefName}归府下`
        : `${playerNames[table.winner]}先走完，军资没入敌手${conquest.stakeRefund ? `（舍身护回 ${conquest.stakeRefund.toLocaleString()} 金）` : ''}`
      : practice
      ? playerWins
        ? `切磋得胜 · 不计缴获与战绩（×${formatMult(winMultiplier)}）`
        : `${playerNames[table.winner]}先走完 · 切磋不计得失`
      : playerWins
      ? `胜 +${winGold.toLocaleString()} 金${multTag}`
      : `${playerNames[table.winner]}先走完 −${loseGold.toLocaleString()} 金${multTag}`
    : bidding
      ? table.bid.turn === 0
        ? table.bid.candidate === null ? '看看手牌，叫不叫地主？' : `${playerNames[table.bid.candidate]}叫了地主，抢不抢？`
        : `${playerNames[table.bid.turn]}正在叫牌`
    : table.currentPlayer === 0
      ? targetCombo
        ? `请大过 ${playerNames[table.lastPlay!.player]} 的${comboLabel(targetCombo)}`
        : '本轮由你先出牌'
      : offerPending
        ? '先定加不加倍，再开打'
        : `${playerNames[table.currentPlayer]}思索中`;

  // 叫抢、定地主、炸弹改了倍数或身份就回写存档，刷新逃局与认输扣同样的金额
  useEffect(() => {
    if (table.winner === null) onStakeChange?.(forfeitMultiplier, share);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forfeitMultiplier, share]);

  useEffect(() => {
    document.body.classList.add('is-doudizhu-table');
    return () => document.body.classList.remove('is-doudizhu-table');
  }, []);

  useEffect(() => {
    setHintIndex(0);
  }, [playerHand, table.currentPlayer, table.lastPlay]);

  useEffect(() => {
    if (aiTimerRef.current !== null) {
      window.clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
    }

    // 小乔「赤壁」加倍选择未定之前 AI 不出牌：加倍须在任何人出牌前定下，不能先看对手开局再对赌
    if (table.phase !== 'playing' || table.winner !== null || table.currentPlayer === 0 || offerPending) {
      return undefined;
    }

    const activePlayer = table.currentPlayer;
    aiTimerRef.current = window.setTimeout(() => {
      setTable((prev) => {
        if (prev.winner !== null || prev.currentPlayer !== activePlayer) return prev;
        return resolveSingleAiTurn(prev, playerNames, styles, aiSkill);
      });
      aiTimerRef.current = null;
    }, 560);

    return () => {
      if (aiTimerRef.current !== null) {
        window.clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }
    };
  }, [aiSkill, playerNames, styles, table.currentPlayer, table.winner, offerPending]);

  useEffect(() => {
    if (table.winner === null || settledRef.current) {
      return;
    }
    settledRef.current = true;
    const win = playerWins;
    onSfx(win ? 'audio/sfx/sfx_victory.mp3' : 'audio/sfx/sfx_defeat.mp3', 0.58);
    onResolved(win, win ? winGold : 0, loseGold, false, win ? winMultiplier * winShare * (1 + fireBonus) : lossMultiplier * share, settleUses(win), refundOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalMultiplier, loseGold, onResolved, onSfx, playerWins, share, table.winner, winGold, winMultiplier, winShare]);

  // AI 叫抢：轮到 AI 表态时停顿一下再叫，像真人在看牌
  useEffect(() => {
    if (table.phase !== 'bidding' || table.bid.turn === 0) return undefined;
    const turn = table.bid.turn;
    const timer = window.setTimeout(() => {
      setTable((prev) => (prev.phase === 'bidding' && prev.bid.turn === turn ? applyBid(prev, turn, aiWantsLandlord(prev.hands[turn], aiSkill, prev.bid.candidate !== null), escortName) : prev));
    }, 750);
    return () => window.clearTimeout(timer);
  }, [aiSkill, table.bid.turn, table.phase, table.bid.acted]);

  // 出牌音效：任何一家出牌都响，炸弹/王炸换成爆炸声
  const playedCountRef = useRef(0);
  useEffect(() => {
    if (table.played.length <= playedCountRef.current) {
      playedCountRef.current = table.played.length;
      return;
    }
    playedCountRef.current = table.played.length;
    const type = table.lastPlay?.combo.type;
    if (type === 'bomb' || type === 'rocket') onSfx('audio/sfx/sfx_bomb.mp3', 0.55);
    else onSfx('audio/sfx/sfx_card_play.mp3', 0.45);
  }, [onSfx, table.lastPlay, table.played.length]);

  // 出牌倒计时：轮到你时开始数，到点自动「不要」/不叫；必须先出时出最小的一张
  const myTurn = table.winner === null && (bidding ? table.bid.turn === 0 : table.currentPlayer === 0);
  // 洛神重发、木牛流马换牌后手牌变了，倒计时重新数
  const turnKey = `${table.phase}-${table.bid.acted}-${table.currentPlayer}-${table.played.length}-${table.recentActions[0].kind}-${dealKey}`;
  const [clock, setClock] = useState<number | null>(null);
  const [autoReason, setAutoReason] = useState('');
  // 已超时一次：提示再超时将托管
  const [timeoutWarned, setTimeoutWarned] = useState(false);
  const timeoutsRef = useRef(0);
  // 这一手玩家已经点过按钮：同一帧里到点的倒计时不再代出
  const turnDoneRef = useRef(false);
  const markActed = () => {
    turnDoneRef.current = true;
    timeoutsRef.current = 0;
    setTimeoutWarned(false);
  };
  useEffect(() => {
    turnDoneRef.current = false;
    if (!myTurn || autoPilot) {
      setClock(null);
      return undefined;
    }
    const total = turnSeconds(bidding, novice);
    if (total <= 0) {
      setClock(null);
      return undefined;
    }
    const deadline = Date.now() + total * 1000;
    setClock(total);
    const timer = window.setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      if (left > 0) {
        setClock(left);
        return;
      }
      window.clearInterval(timer);
      setClock(0);
      if (turnDoneRef.current) return;
      turnDoneRef.current = true;
      timeoutsRef.current += 1;
      if (!novice) {
        if (timeoutsRef.current >= AUTO_PILOT_AFTER_TIMEOUTS) {
          setAutoReason('连续超时，已托管');
          setAutoPilot(true);
          setTimeoutWarned(false);
        } else {
          setTimeoutWarned(true);
        }
      }
      setTable((prev) => {
        if (prev.winner !== null) return prev;
        if (prev.phase === 'bidding') return prev.bid.turn === 0 ? withFlash(applyBid(prev, 0, false, escortName), prev.bid.candidate === null ? '超时 · 不叫' : '超时 · 不抢') : prev;
        if (prev.currentPlayer !== 0) return prev;
        if (prev.lastPlay && prev.lastPlay.player !== 0) return withFlash(applyPass(prev, 0, '你超时未出，自动不要。'), '超时 · 自动不要');
        const smallest = sortCards(prev.hands[0])[0];
        const combo = smallest ? evaluateCards([smallest]) : null;
        return smallest && combo ? withFlash(applyPlay(prev, 0, [smallest], combo, `你超时未出，自动出 ${formatCards([smallest])}`), '超时 · 自动出牌') : prev;
      });
    }, 250);
    return () => window.clearInterval(timer);
    // turnKey 变化即换了一手，重新计时
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn, turnKey, autoPilot]);

  useEffect(() => {
    if (!myTurn || !autoPilot) return undefined;
    const timer = window.setTimeout(() => {
      setTable((prev) => {
        if (prev.winner !== null) return prev;
        // 托管从不替玩家叫/抢地主
        if (prev.phase === 'bidding') return prev.bid.turn === 0 ? applyBid(prev, 0, false, escortName) : prev;
        if (prev.currentPlayer !== 0) return prev;
        return resolveSingleAiTurn({ ...prev, selectedIds: [] }, { ...playerNames, 0: '托管' }, { ...styles, 0: 'balanced' }, 'veteran');
      });
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn, turnKey, autoPilot]);

  // 桌心状态行（横屏下按钮上方的 readout 被牌桌挡住）：超时警告与托管原因在这里也说一遍
  const centerCopy = myTurn && autoPilot
    ? `${autoReason || '托管中'} · 系统代你${bidding ? '不叫' : '出牌'}`
    : myTurn && timeoutWarned
      ? `已超时一次，再超时将托管 · ${statusCopy}`
      : statusCopy;

  // —— 随行伴侣技能 ——
  const usesLeft = table.skill.usesLeft;
  const liaodong = hasPerk('liaodong');
  const visibleBaseOf = (prev: TableState) => Math.min(prev.landlordCards.length, (liaodong ? 1 : 0) + prev.skill.peeked);
  // 甄姬「洛神」：自己第一次表态之前（跳过叫地主时为首手之前）
  const redealOpen = (prev: TableState) => prev.skill.id === 'zhenji' && prev.skill.usesLeft > 0 && prev.winner === null && prev.played.length === 0 && prev.bid.words[0] === null
    && (prev.phase === 'bidding' ? prev.bid.turn === 0 : prev.currentPlayer === 0);
  const canRedeal = redealOpen(table) && !autoPilot;
  const redeal = () => {
    if (!canRedeal) return;
    onSfx('audio/sfx/sfx_button.mp3', 0.3);
    setTable((prev) => (redealOpen(prev) ? redealTable(prev, escortName) : prev));
  };
  // 黄月英「木牛流马」：叫地主阶段
  const canMuniu = skillId === 'huangyueying' && usesLeft > 0 && bidding && table.winner === null && !table.skill.swapping && !autoPilot;
  const startMuniu = () => {
    if (!canMuniu) return;
    onSfx('audio/sfx/sfx_button.mp3', 0.3);
    setTable((prev) => {
      if (prev.phase !== 'bidding' || prev.skill.usesLeft <= 0 || prev.skill.swapping) return prev;
      // 二重起先翻开一张底牌；一重直接等你点牌盲换
      return skillValue(prev.skill) >= 1 ? flipKitty(prev, visibleBaseOf(prev), escortName) : { ...prev, skill: { ...prev.skill, swapping: true, flipIndex: null } };
    });
  };
  const stopMuniu = () => setTable((prev) => ({ ...prev, skill: { ...prev.skill, swapping: false, flipIndex: null } }));
  const swapWith = (cardId: string) => setTable((prev) => swapKitty(prev, cardId, visibleBaseOf(prev), escortName));
  // 小乔「赤壁」：叫完地主后选一次
  // 攻郡牌局不赢金币，加倍没有意义，不弹
  const offerOpen = offerPending;
  const chooseDouble = (yes: boolean) => {
    onSfx('audio/sfx/sfx_button.mp3', 0.3);
    setTable((prev) => {
      if (!prev.skill.offer || prev.winner !== null) return prev;
      if (!yes) return { ...prev, skill: { ...prev.skill, offer: false } };
      const next = { ...prev, skill: { ...prev.skill, offer: false, doubled: 2 as const, usesLeft: Math.max(0, prev.skill.usesLeft - 1), uses: prev.skill.uses + 1 } };
      return withFlash({ ...next, history: ['赤壁：本局胜负一并翻倍。', ...prev.history].slice(0, 12) }, `${skillLabel(next.skill, escortName)} · 加倍`, true);
    });
  };
  // 步练师「问计」：选好能出的牌后，问下家、上家压不压得过
  const askKey = [...table.selectedIds].sort().join(',');
  const canAsk = skillId === 'bulianshi' && usesLeft > 0 && canPlay && table.winner === null && !autoPilot;
  const askAdvice = () => {
    if (!canAsk || !selectedCombo) return;
    onSfx('audio/sfx/sfx_button.mp3', 0.3);
    const combo = selectedCombo;
    setTable((prev) => {
      if (prev.skill.usesLeft <= 0 || prev.currentPlayer !== 0 || prev.winner !== null) return prev;
      const verdict = (seat: PlayerIndex) => (findPlayableCombos(prev.hands[seat], combo).length > 0 ? '有牌可压' : '压不过');
      // 写短：矮横屏技能条只有一行宽，结论（压不压得过）不能被省略号吃掉
      const text = `下家${verdict(1)} · 上家${verdict(2)}`;
      const skill = { ...prev.skill, usesLeft: prev.skill.usesLeft - 1, uses: prev.skill.uses + 1, answer: { key: [...prev.selectedIds].sort().join(','), text } };
      return withFlash({ ...prev, skill }, skillLabel(skill, escortName), true);
    });
  };
  const answer = table.skill.answer && table.skill.answer.key === askKey ? table.skill.answer.text : '';

  const toggleAutoPilot = (on: boolean) => {
    timeoutsRef.current = 0;
    setTimeoutWarned(false);
    setAutoReason('');
    setAutoPilot(on);
  };

  const toggleCard = (cardId: string) => {
    if (table.currentPlayer !== 0 || table.winner !== null) return;
    setTable((prev) => ({
      ...prev,
      selectedIds: prev.selectedIds.includes(cardId)
        ? prev.selectedIds.filter((id) => id !== cardId)
        : [...prev.selectedIds, cardId]
    }));
  };

  // 按钮与倒计时互斥：updater 里再确认一次仍轮到你，防同一帧出两手
  const playSelected = () => {
    if (!canPlay || !selectedCombo) return;
    markActed();
    setTable((prev) => (prev.phase === 'playing' && prev.currentPlayer === 0 && prev.winner === null ? applyPlay(prev, 0, selectedCards, selectedCombo, `你出牌：${selectedCombo.label} ${formatCards(selectedCards)}`) : prev));
  };

  const pass = () => {
    if (!canPass) return;
    markActed();
    onSfx('audio/sfx/sfx_button.mp3', 0.24);
    setTable((prev) => (prev.phase === 'playing' && prev.currentPlayer === 0 && prev.winner === null && prev.lastPlay && prev.lastPlay.player !== 0 ? applyPass(prev, 0, '你选择不要。') : prev));
  };

  const bidAction = (want: boolean) => {
    markActed();
    setTable((prev) => (prev.phase === 'bidding' && prev.bid.turn === 0 && prev.winner === null ? applyBid(prev, 0, want, escortName) : prev));
  };

  const selectHint = () => {
    if (!canHint || !suggestedCards) return;
    onSfx('audio/sfx/sfx_button.mp3', 0.18);
    setTable((prev) => ({ ...prev, selectedIds: suggestedCards.map((card) => card.id) }));
    setHintIndex((prev) => (playableHints.length > 0 ? (prev + 1) % playableHints.length : 0));
  };

  const leaveTable = () => {
    // 守城局：「弃城」二次确认后按失手（城防 −1，到 0 失郡）；关页、刷新不算弃城，反攻保留可重打
    if (defend && table.winner === null) {
      if (!window.confirm(`弃城按守城未克处理：${conquest?.fiefName ?? '本郡'}城防 −1，城防归零即失郡（不扣金）。确定弃城？`)) return;
      if (!settledRef.current) {
        settledRef.current = true;
        onResolved(false, 0, 0, true, 1, settleUses(false), false);
      }
      onReturnHome();
      return;
    }
    // 切磋局：离席不扣金、不计战绩
    if (practice) {
      onReturnHome();
      return;
    }
    if (table.winner === null && !window.confirm(`认输将损失 ${forfeitGold.toLocaleString()} 金（当前 ×${formatMult(Math.min(MAX_MULTIPLIER, table.multiplier * doubled))}${share < 1 ? ' · 农民半份' : ''}${doubled > 1 ? ` · 赤壁对赌，付缴获 ×${payRatio(forfeitGold)}` : ''}），确定回府？`)) {
      return;
    }
    if (table.winner === null && !settledRef.current) {
      settledRef.current = true;
      onResolved(false, 0, forfeitGold, true, forfeitMultiplier * share, settleUses(false), false);
    }
    onReturnHome();
  };

  const resetSelection = () => {
    setTable((prev) => ({ ...prev, selectedIds: [] }));
  };

  // 命中手牌：先看手指下露出的那张，落空再按横向位置推算
  const cardUnderPointer = (target: HTMLElement, clientX: number, clientY: number) => {
    const visibleCardId = cardIdFromPointer(target, clientX, clientY);
    if (visibleCardId && playerHand.some((card) => card.id === visibleCardId)) return visibleCardId;
    const index = handIndexFromPointer(target, clientX, clientY, twoRows);
    return displayedHand[index]?.id ?? null;
  };

  // 滑动选牌：按下开始一次手势，划过的每张牌翻转一次（主流斗地主的连选方式）
  const swipeRef = useRef<Set<string> | null>(null);
  const selectCardFromHand = (event: PointerEvent<HTMLElement>) => {
    // 木牛流马换牌中：叫地主阶段点一张手牌就换
    if (event.button === 0 && table.phase === 'bidding' && table.skill.swapping && table.winner === null) {
      event.preventDefault();
      event.stopPropagation();
      const cardId = cardUnderPointer(event.currentTarget, event.clientX, event.clientY);
      if (cardId) swapWith(cardId);
      return;
    }
    if (event.button !== 0 || table.phase !== 'playing' || table.currentPlayer !== 0 || table.winner !== null || playerHand.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const cardId = cardUnderPointer(event.currentTarget, event.clientX, event.clientY);
    swipeRef.current = new Set(cardId ? [cardId] : []);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 部分环境不支持 */ }
    if (cardId) toggleCard(cardId);
  };
  const swipeOverHand = (event: PointerEvent<HTMLElement>) => {
    const touched = swipeRef.current;
    if (!touched || table.currentPlayer !== 0 || table.winner !== null) return;
    const cardId = cardUnderPointer(event.currentTarget, event.clientX, event.clientY);
    if (!cardId || touched.has(cardId)) return;
    touched.add(cardId);
    toggleCard(cardId);
  };
  const endSwipe = () => {
    swipeRef.current = null;
  };

  // 技能条右侧的状态字：主动技能写剩余次数，被动写「生效中」
  function skillStateText() {
    if (!skillDef) return '';
    if (skillId === 'xiaoqiao') return conquest ? (defend ? '守城不加倍' : '攻郡不加倍') : doubled > 1 ? '已加倍' : table.skill.offer ? '可加倍' : bidding ? '叫完地主可加倍' : table.multiplier >= MAX_MULTIPLIER ? '倍数已满' : skillLevel < 2 && table.landlord !== 0 ? '当地主才可加倍' : '未加倍';
    if (skillId === 'zhurong') return `+${Math.round(fireBonus * 100)}%`;
    if (skillDef.uses[skillLevel - 1] > 0) return `×${usesLeft}`;
    return '生效中';
  }
  function skillActions() {
    const buttons: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean; hint?: string }[] = [];
    if (skillId === 'zhenji' && canRedeal) buttons.push({ label: '洛神·重发', onClick: redeal, primary: true });
    if (skillId === 'huangyueying' && bidding && table.winner === null) {
      if (table.skill.swapping) buttons.push({ label: table.skill.flipIndex !== null ? '不换了' : '收起', onClick: stopMuniu });
      else if (usesLeft > 0) buttons.push({ label: skillValue(table.skill) >= 1 ? '木牛流马·翻底牌' : '木牛流马·换牌', onClick: startMuniu, primary: true, disabled: !canMuniu });
    }
    if (skillId === 'xiaoqiao' && offerOpen) {
      buttons.push({ label: '加倍', onClick: () => chooseDouble(true), primary: true });
      buttons.push({ label: '不加倍', onClick: () => chooseDouble(false) });
    }
    if (skillId === 'bulianshi' && table.phase === 'playing' && table.winner === null && usesLeft > 0) buttons.push({ label: '问计', onClick: askAdvice, primary: true, disabled: !canAsk, hint: canAsk ? '问下家、上家压不压得过' : table.currentPlayer !== 0 ? '轮到你出牌时可问计' : '先选好能出的牌，再点问计' });
    return buttons;
  }
  function skillLines() {
    const lines: { key: string; text: string; cards?: Card[]; desc?: boolean }[] = [];
    if (!skillDef) return lines;
    const live = (seat: PlayerIndex, cards: Card[]) => cards.filter((card) => table.hands[seat].some((item) => item.id === card.id));
    if (table.winner !== null) return lines;
    if (skillId === 'diaochan') {
      const cards = live(2, moonScouted);
      lines.push({ key: 'moon', text: cards.length > 0 ? `${playerNames[2]}（上家）有` : `${playerNames[2]}（上家）探得的牌已出完`, cards });
    }
    if (skillId === 'daqiao' && !bidding) {
      if (table.landlord !== 0) {
        const mate = ([1, 2] as PlayerIndex[]).find((seat) => seat !== table.landlord)!;
        lines.push({ key: 'mate', text: `队友${playerNames[mate]}${skillVal >= 17 ? '整手' : `最大 ${skillVal} 张`}`, cards: sortCardsDescending(table.hands[mate]).slice(0, skillVal) });
      } else if (skillLevel >= 3) {
        lines.push({ key: 'next', text: `${playerNames[1]}（下家）最大`, cards: sortCardsDescending(table.hands[1]).slice(0, hasPerk('yingchuan') ? 3 : 2) });
      } else {
        lines.push({ key: 'idle', text: '当农民时亮出队友的牌' });
      }
    }
    if (skillId === 'caiwenji') {
      const fmt = (sum: { bombs: number; jokers: number; twos: number }) => `炸弹 ${sum.bombs} · 王 ${sum.jokers} · 2 ${sum.twos}`;
      if (skillLevel === 1) lines.push({ key: 'all', text: `两家尚余：${fmt(unseenSummary(table.hands[0], table.played))}` });
      else for (const seat of [1, 2] as PlayerIndex[]) {
        // 三重：某家剩 2 张及以下时把他的牌亮在同一行（不另起一行，矮横屏技能条不长高）
        const reveal = skillLevel >= 3 && !bidding && table.hands[seat].length <= 2;
        lines.push({ key: `seat${seat}`, text: reveal ? `${playerNames[seat]}只剩` : `${playerNames[seat]}：${fmt(handSummary(table.hands[seat]))}`, ...(reveal ? { cards: table.hands[seat] } : {}) });
      }
    }
    if (skillId === 'bulianshi') lines.push(answer ? { key: 'answer', text: answer } : { key: 'tip', text: table.phase === 'playing' ? '选好能出的牌，再点「问计」' : '出牌时可问计' });
    if (skillId === 'huangyueying' && bidding) {
      if (table.skill.swapping) lines.push({ key: 'swap', text: table.skill.flipIndex !== null ? `点一张手牌，换翻开的 ${table.landlordCards[table.skill.flipIndex]?.label ?? ''}` : '点一张手牌，与一张底牌盲换' });
      else if (usesLeft > 0) lines.push({ key: 'tip', text: skillValue(table.skill) >= 1 ? `先翻开 ${skillValue(table.skill)} 张底牌，再决定换不换` : '拿一张手牌盲换底牌，换来的亮出' });
    }
    if (skillId === 'zhenji' && canRedeal) lines.push({ key: 'tip', text: `表态前可整桌重发${skillVal > 0 ? `，重发后多看 ${skillVal} 张底牌` : ''}` });
    if (skillId === 'xiaoqiao' && offerOpen) {
      // 按当前倍数、身份、本场实际失手额现算，不写死
      const gain = xiaoqiaoGain(table.multiplier);
      const payIf = (isDoubled: boolean) => payRatio(lossGold * lossMultOf(table.multiplier, isDoubled) * share);
      lines.push({ key: 'offer', text: `胜得${gain >= 2 ? '双倍' : ` ×${formatMult(gain)}`}；失手付缴获 ×${payIf(true)}（平时 ×${payIf(false)}）` });
    }
    if (skillId === 'sunshangxiang') lines.push({ key: 'desc', text: `你的炸弹、王炸 ×${formatMult(skillVal)}（平时 ×2）${table.skill.myBombs > 0 ? ` · 已炸 ${table.skill.myBombs} 次` : ''}`, desc: table.skill.myBombs === 0 });
    if (skillId === 'zhurong') lines.push({ key: 'desc', text: `长牌 ${table.skill.longCombos} 手 · 赢牌缴获 +${Math.round(fireBonus * 100)}%（上限 ${Math.round(skillVal * 100)}%）`, desc: table.skill.longCombos === 0 });
    if (skillId === 'mifuren') lines.push({ key: 'desc', text: defend ? '守城局失手不扣金，舍身待下局' : conquest ? `攻城未克护回 ${(conquest.stakeRefund ?? 0).toLocaleString()} 金军资` : `${skillVal > 0 ? `失手少付 ${Math.round(skillVal * 100)}% · ` : ''}失手 ×${MIFUREN_REFUND_MULTIPLIER} 起返还军令`, desc: true });
    return lines;
  }

  return (
    <main className="screen ddz-screen">
      <header className="ddz-topbar">
        {table.winner === null ? (
          <button type="button" className="ddz-topbar__quit" onClick={leaveTable}>{defend ? '弃城' : conquest ? '撤兵' : practice ? '离席' : `认输 −${forfeitGold.toLocaleString()}`}</button>
        ) : (
          <span className="ddz-topbar__quit is-idle">牌局结束</span>
        )}
        <div className="ddz-topbar__kitty" aria-label="地主底牌">
          <span>底牌</span>
          {/* 辽东「良马斥候」：叫地主前先看到一张底牌；洛神、木牛流马再多看几张 */}
          <MiniCardStrip cards={bidding ? table.landlordCards.slice(0, kittyVisible) : table.landlordCards} emptyLabel="叫完地主后亮出" center />
        </div>
        <div className="ddz-topbar__stake">
          <h2>{conquest ? `${defend ? '守卫' : '攻取'}${conquest.fiefName}` : practice ? '斗地主切磋' : '斗地主牌局'}</h2>
          <span className="ddz-multiplier">倍数 ×{formatMult(finalMultiplier)}</span>
          <span>胜 {wins} · 负 {losses}</span>
        </div>
      </header>

      <div className="ddz-counter" aria-label="记牌器">
        <span className="ddz-counter__label">记牌器</span>
        {counter.map((item) => (
          <span key={item.label} className={`ddz-counter__cell ${item.left === 0 ? 'is-gone' : ''}`}>
            <b>{item.label}</b>
            <i>{item.left}</i>
          </span>
        ))}
      </div>

      {scouted.length > 0 && table.winner === null && (
        <p className="ddz-scout" role="note">谋士探得 {playerNames[1]} 手里有：<b>{formatCards(scouted)}</b></p>
      )}

      <section className="ddz-table" aria-label="三人斗地主牌桌">
        <PlayerSeat
          profile={profiles[1]}
          roleLabel={roleOf(1)}
          handCount={table.hands[1].length}
          recentCards={table.recentMoves[1]}
          recentAction={table.recentActions[1]}
          active={table.winner === null && (bidding ? table.bid.turn === 1 : table.currentPlayer === 1)}
          // 逆时针出牌：自己出完轮到下家（1 号位）坐右手边，再到上家（2 号位）坐左手边
          seat="right"
        />
        <PlayerSeat
          profile={profiles[2]}
          roleLabel={roleOf(2)}
          handCount={table.hands[2].length}
          recentCards={table.recentMoves[2]}
          recentAction={table.recentActions[2]}
          active={table.winner === null && (bidding ? table.bid.turn === 2 : table.currentPlayer === 2)}
          seat="left"
        />
        {table.flash && (
          <div key={table.flash.id} className={`ddz-flash ${table.flash.big ? 'is-big' : ''}`} aria-hidden="true">{table.flash.text}</div>
        )}
        <div className="ddz-center" aria-live="polite">
          <span>{bidding ? `叫地主 · 倍数 ×${table.multiplier}` : table.lastPlay ? `${playerNames[table.lastPlay.player]} · ${table.lastPlay.combo.label}` : '自由出牌'}</span>
          <strong>{centerCopy}</strong>
        </div>
        <PlayerSeat
          profile={profiles[0]}
          roleLabel={roleOf(0)}
          handCount={table.hands[0].length}
          recentCards={table.recentMoves[0]}
          recentAction={table.recentActions[0]}
          active={table.winner === null && (bidding ? table.bid.turn === 0 : table.currentPlayer === 0)}
          seat="self"
          self
        />
        {escort && skillDef && skillLevel > 0 && (
          <SkillBar
            escort={escort}
            skillName={skillDef.name}
            level={skillLevel as 1 | 2 | 3}
            stateText={skillStateText()}
            actions={skillActions()}
            lines={skillLines()}
          />
        )}
      </section>

      {table.winner !== null && (
        <div className={`doudizhu-result-banner ${playerWins ? 'is-win' : 'is-loss'}`} role="status">
          <strong>{defend && conquest ? (playerWins ? `守住${conquest.fiefName}` : '守城未克') : conquest ? (playerWins ? `${conquest.fiefName}归附` : '攻城未克') : practice ? (playerWins ? '切磋得胜' : '再切磋一局') : playerWins ? '牌局得胜' : '下局再战'}</strong>
          <span>{statusCopy}</span>
        </div>
      )}

      <section className="ddz-actions" aria-live="polite">
        {autoPilot && table.winner === null ? (
          <>
            <p className="ddz-readout">{autoReason ? `${autoReason} · ` : '托管中 · '}系统代你{bidding ? '不叫' : '出牌'}</p>
            <div className="ddz-actions__row">
              <button type="button" className="ddz-btn ddz-btn--play" onClick={() => toggleAutoPilot(false)}>取消托管</button>
            </div>
          </>
        ) : bidding ? (
          <>
            <p className="ddz-readout">{timeoutWarned && table.bid.turn === 0 ? '已超时一次，再超时将托管' : table.bid.turn === 0 ? '地主拿底牌一打二、按全额结算；农民和队友联手、各按半额结算' : `等待 ${playerNames[table.bid.turn]} 表态`}</p>
            <div className="ddz-actions__row">
              {clock !== null && <span className={`ddz-clock ${clock <= 5 ? 'is-urgent' : ''}`} role="timer" aria-label={`剩余 ${clock} 秒`}>{clock}</span>}
              <button type="button" className="ddz-btn ddz-btn--pass" disabled={table.bid.turn !== 0} onClick={() => bidAction(false)}>{table.bid.candidate === null ? '不叫' : '不抢'}</button>
              <button type="button" className="ddz-btn ddz-btn--hint" disabled={table.bid.turn !== 0} onClick={() => bidAction(true)}>{table.bid.candidate === null ? '叫地主' : '抢地主'}</button>
              <button type="button" className="ddz-btn ddz-btn--auto" onClick={() => toggleAutoPilot(true)}>托管</button>
            </div>
          </>
        ) : table.winner === null ? (
          <>
            <p className="ddz-readout">{table.currentPlayer === 0 ? (timeoutWarned ? `已超时一次，再超时将托管 · ${selectedCopy}` : selectedCopy) : `等待 ${playerNames[table.currentPlayer]} 出牌`}</p>
            <div className="ddz-actions__row">
              {clock !== null && <span className={`ddz-clock ${clock <= 5 ? 'is-urgent' : ''}`} role="timer" aria-label={`剩余 ${clock} 秒`}>{clock}</span>}
              <button type="button" className="ddz-btn ddz-btn--pass" onClick={pass} disabled={!canPass}>不要</button>
              <button type="button" className="ddz-btn ddz-btn--hint" onClick={selectHint} disabled={!canHint}>提示</button>
              <button type="button" className="ddz-btn ddz-btn--play" onClick={playSelected} disabled={!canPlay}>出牌</button>
              <button type="button" className="ddz-btn ddz-btn--reset" onClick={resetSelection} disabled={table.selectedIds.length === 0}>重选</button>
              <button type="button" className="ddz-btn ddz-btn--auto" onClick={() => toggleAutoPilot(true)}>托管</button>
            </div>
          </>
        ) : (
          <div className="ddz-actions__row">
            {onPlayAgain && <button type="button" className="ddz-btn ddz-btn--hint" onClick={onPlayAgain}>{playAgainLabel ?? '再来一局'}</button>}
            <button type="button" className="ddz-btn ddz-btn--play" onClick={onReturnHome}>返回家业</button>
          </div>
        )}
      </section>

      <section className={`player-hand ${twoRows ? 'player-hand--two-rows' : ''} ${table.winner !== null && playerHand.length === 0 ? 'is-empty' : ''} ${table.skill.swapping && bidding ? 'is-swapping' : ''}`} aria-label="你的手牌" onPointerDownCapture={selectCardFromHand} onPointerMove={swipeOverHand} onPointerUp={endSwipe} onPointerCancel={endSwipe}>
        {displayedHand.map((card, index) => {
          const selected = table.selectedIds.includes(card.id);
          const joker = isJoker(card);
          return (
            <button
              key={card.id}
              type="button"
              className={`poker-card ${card.red ? 'is-red' : ''} ${joker ? 'is-joker' : ''} ${selected ? 'is-selected' : ''} ${twoRows && handRowLayout(index, displayedHand.length, true).row === 0 ? 'is-upper-row' : ''}`}
              style={handCardStyle(index, displayedHand.length, selected, twoRows)}
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (table.phase === 'bidding' && table.skill.swapping) swapWith(card.id);
                  else toggleCard(card.id);
                }
              }}
              aria-pressed={selected}
              aria-label={`${card.suit}${card.rank}`}
              data-card-id={card.id}
              data-rank={card.rank}
              data-suit={card.suit}
            >
              <span className="poker-card__corner" aria-hidden="true">
                {joker ? (
                  <>
                    <span className="poker-card__joker-word">JOKER</span>
                    {/* 两行手牌的上排只露上半截，竖排 JOKER 只看得到「JO」，改显示「大王」「小王」 */}
                    <span className="poker-card__joker-cn">{card.value === 17 ? '大' : '小'}王</span>
                  </>
                ) : (
                  <>
                    <b>{card.rank}</b>
                    <SuitIcon suit={card.suit} className="poker-card__suit" />
                  </>
                )}
              </span>
              {joker ? (
                <span className="poker-card__art" aria-hidden="true">
                  <JokerArt big={card.value === 17} />
                </span>
              ) : (
                // 参照黄金岛牌面：中间留白，右下角倒置一组数字 + 花色
                <span className="poker-card__index-br" aria-hidden="true">
                  <b>{card.rank}</b>
                  <SuitIcon suit={card.suit} className="poker-card__suit" />
                </span>
              )}
            </button>
          );
        })}
      </section>

    </main>
  );
}

function SkillBar({
  escort,
  skillName,
  level,
  stateText,
  actions,
  lines
}: {
  escort: EscortInfo;
  skillName: string;
  level: 1 | 2 | 3;
  stateText: string;
  actions: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean; hint?: string }[];
  lines: { key: string; text: string; cards?: Card[]; desc?: boolean }[];
}) {
  return (
    <div className={`ddz-skillbar ${actions.length > 0 ? 'has-actions' : ''}`} role="group" aria-label="伴侣技能">
      <div className="ddz-skillbar__head">
        <ImageWithFallback src={imageUrl(escort.imagePath, 96)} alt={escort.name} className="ddz-skillbar__avatar" />
        <b className="ddz-skillbar__name">{escort.name}·{skillName}</b>
        <i className="ddz-skillbar__lv">{SKILL_LEVEL_NAME[level]}</i>
        {stateText && <span className="ddz-skillbar__state">{stateText}</span>}
      </div>
      {actions.length > 0 && (
        <div className="ddz-skillbar__actions">
          {actions.map((action) => (
            <button key={action.label} type="button" className={`ddz-skillbar__btn ${action.primary ? 'is-primary' : ''}`} disabled={action.disabled} title={action.hint} aria-description={action.hint} onClick={action.onClick}>{action.label}</button>
          ))}
        </div>
      )}
      {lines.map((line) => (
        <div key={line.key} className={`ddz-skillbar__line ${line.desc ? 'is-desc' : ''}`} data-line={line.key}>
          <span>{line.text}</span>
          {line.cards && line.cards.length > 0 && (
            // 牌多（大乔亮整手）时单独占一行，叠放步长按技能条宽度收紧，整手都留在条内
            <div className={`ddz-skillbar__cards ${line.cards.length > 8 ? 'is-many' : ''}`} style={{ '--n': line.cards.length } as CSSProperties}>
              <MiniCardStrip cards={line.cards} emptyLabel="" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PlayerSeat({
  profile,
  handCount,
  recentCards,
  recentAction,
  active,
  seat,
  self = false,
  roleLabel
}: {
  profile: PlayerProfile;
  handCount: number;
  recentCards: Card[];
  recentAction: SeatAction;
  active: boolean;
  seat: 'left' | 'right' | 'self';
  self?: boolean;
  /** 叫地主前显示「叫牌」，之后按实际身份 */
  roleLabel: string;
}) {
  return (
    <article className={`ddz-seat ddz-seat--${seat} ${active ? 'is-active' : ''}`}>
      <div className="ddz-seat__avatar">
        <ImageWithFallback src={imageUrl(profile.imagePath, 160)} alt={profile.name} />
        <span className={`ddz-seat__role ${roleLabel === '地主' ? 'is-landlord' : ''}`}>{roleLabel}</span>
      </div>
      <div className="ddz-seat__info">
        <strong className="ddz-seat__name">{profile.name}</strong>
        <span className="ddz-seat__count">{handCount} 张</span>
        <span className="ddz-seat__badge">{active ? (self ? '出牌中' : '思考中') : profile.style ? `${AI_STYLE_LABEL[profile.style]}${profile.skill ? AI_SKILL_LABEL[profile.skill] : ''}` : profile.title}</span>
      </div>
      <div className="ddz-seat__play">
        {recentCards.length > 0 && <MiniCardStrip key={recentCards.map((card) => card.id).join()} cards={recentCards} emptyLabel="" />}
        <SeatActionLine action={recentAction} active={active} self={self} hasCards={recentCards.length > 0} bidding={roleLabel === '叫牌'} />
      </div>
    </article>
  );
}

function SeatActionLine({
  action,
  active,
  self,
  hasCards,
  bidding = false
}: {
  action: SeatAction;
  active: boolean;
  self: boolean;
  hasCards: boolean;
  bidding?: boolean;
}) {
  const kind = active ? 'active' : action.kind;
  if (bidding) {
    const bidLabel = active ? (self ? '轮到你叫牌' : '正在叫牌') : action.kind === 'idle' ? '等待叫牌' : action.label;
    return <div className={`ddz-seat__action ddz-seat__action--${kind}`}>{bidLabel}</div>;
  }
  const label = active
    ? self
      ? '轮到你出牌'
      : '正在思考'
    : action.kind === 'pass'
      ? '不要'
      : hasCards
        ? action.label
        : '等待出牌';

  return <div className={`ddz-seat__action ddz-seat__action--${kind}`}>{label}</div>;
}

function MiniCardStrip({ cards, emptyLabel, center = false }: { cards: Card[]; emptyLabel: string; center?: boolean }) {
  const displayCards = sortCardsDescending(cards);
  return (
    <div className={`mini-card-strip ${center ? 'mini-card-strip--center' : ''} ${cards.length === 0 ? 'is-empty' : ''}`}>
      {displayCards.length > 0 ? (
        displayCards.map((card) => <MiniCard key={card.id} card={card} />)
      ) : (
        <span className="mini-card-empty">{emptyLabel}</span>
      )}
    </div>
  );
}

function MiniCard({ card }: { card: Card }) {
  // 大小王小牌：同数字牌排法，左上「大」「小」、其下「王」，大王红、小王黑
  const joker = isJoker(card);
  return (
    <span className={`mini-card ${card.red ? 'is-red' : ''} ${joker ? 'is-joker' : ''}`} aria-label={card.label} data-rank={card.rank}>
      <b className="mini-card__rank">{joker ? (card.value === 17 ? '大' : '小') : card.rank}</b>
      {joker ? <i className="mini-card__suit">王</i> : <SuitIcon suit={card.suit} className="mini-card__suit" />}
    </span>
  );
}

function isJoker(card: Card) {
  return card.value >= 16;
}

/** 两行时：前一半在上排（往上抬 46px），后一半在下排 */
function handRowLayout(index: number, count: number, twoRows: boolean) {
  if (!twoRows) return { row: 0, indexInRow: index, countInRow: count, rows: 1 };
  const upper = Math.ceil(count / 2);
  return index < upper
    ? { row: 0, indexInRow: index, countInRow: upper, rows: 2 }
    : { row: 1, indexInRow: index - upper, countInRow: count - upper, rows: 2 };
}

// 手牌紧密叠放（参照黄金岛跑得快）：后一张压住前一张，只露左侧一条角标，整手居中。
// 步长 = min(露出宽度, 手牌区放得下的宽度)；露出宽度按牌宽比例算，牌少时放宽一些
const HAND_OVERLAP_SAFE_GAP = 6;
function handStepRatio(countInRow: number) {
  if (countInRow <= 6) return 0.6;
  if (countInRow >= 11) return 0.46;
  return 0.6 - ((countInRow - 6) / 5) * 0.14;
}

function handCardStyle(index: number, count: number, selected: boolean, twoRows: boolean): CSSProperties {
  const { row, indexInRow, countInRow, rows } = handRowLayout(index, count, twoRows);
  const offset = indexInRow - (countInRow - 1) / 2;
  const cardWidth = 'var(--hand-card-edge) * 2';
  const step = countInRow <= 1
    ? '0px'
    : `min(${cardWidth} * ${handStepRatio(countInRow).toFixed(3)}, (100% - ${cardWidth} - ${HAND_OVERLAP_SAFE_GAP * 2}px) / ${countInRow - 1})`;
  const rowLift = rows === 2 && row === 0 ? 46 : 0;
  // 选中的牌要一眼看得出来
  const selectedRise = selected ? (rows === 2 ? 12 : 18) : 0;

  return {
    left: `calc(50% + ${offset} * ${step})`,
    transform: `translateX(-50%) translateY(${-rowLift - selectedRise}px)`,
    zIndex: row * 100 + indexInRow + 1
  };
}

/**
 * 手指没落在任何一张牌上（牌缝、上抬留下的空当）时按实际排布反算：
 * 先按纵向定行（两行时下排在上排之上叠放），再取左边缘在手指左侧的最后一张——叠放下露出的就是它。
 */
function handIndexFromPointer(hand: HTMLElement, clientX: number, clientY: number, twoRows: boolean) {
  const cards = [...hand.querySelectorAll<HTMLElement>('.poker-card')];
  if (cards.length === 0) return -1;
  const boxes = cards.map((card, index) => ({ index, box: card.getBoundingClientRect(), upper: card.classList.contains('is-upper-row') }));
  let candidates = boxes;
  if (twoRows) {
    const lower = boxes.filter((item) => !item.upper);
    const resting = lower.filter((item) => !cards[item.index].classList.contains('is-selected'));
    const lowerTop = resting.length > 0 ? Math.min(...resting.map((item) => item.box.top)) : Math.min(...lower.map((item) => item.box.top)) + 12;
    candidates = clientY >= lowerTop ? lower : boxes.filter((item) => item.upper);
    if (candidates.length === 0) candidates = boxes;
  }
  // 只在牌的实际范围内吸附：手牌居中后两侧空出一大片桌面，点那里不该选中端牌
  const rowLeft = Math.min(...candidates.map((item) => item.box.left));
  const rowRight = Math.max(...candidates.map((item) => item.box.right));
  const rowTop = Math.min(...candidates.map((item) => item.box.top));
  const rowBottom = Math.max(...candidates.map((item) => item.box.bottom));
  if (clientX < rowLeft || clientX > rowRight || clientY < rowTop || clientY > rowBottom) return -1;
  const hit = candidates.filter((item) => item.box.left <= clientX).at(-1);
  return hit ? hit.index : -1;
}

function cardIdFromPointer(hand: EventTarget & HTMLElement, clientX: number, clientY: number) {
  const cardElement = document.elementsFromPoint(clientX, clientY)
    .map((element) => element.closest<HTMLButtonElement>('.poker-card'))
    .find((element): element is HTMLButtonElement => element !== null && hand.contains(element));

  return cardElement?.dataset.cardId ?? null;
}

const MAX_MULTIPLIER = 8;
const LONG_COMBOS = new Set<ComboType>(['straight', 'pair-straight', 'airplane', 'airplane-one', 'airplane-pair']);
/** 倍数可能带小数（枭姬 ×2.5、赤壁失手 ×1.5）：最多两位，去掉尾零 */
function formatMult(value: number) {
  return String(Math.round(value * 100) / 100);
}
const FLASH_TEXT: Partial<Record<ComboType, string>> = {
  bomb: '炸弹',
  rocket: '王炸',
  straight: '顺子',
  'pair-straight': '连对',
  airplane: '飞机',
  'airplane-one': '飞机',
  'airplane-pair': '飞机'
};
/** 记牌器显示的点数（从大到小） */
const COUNTER_RANKS: Array<{ label: string; match: (card: Card) => boolean; total: number }> = [
  { label: '大', match: (card) => card.value === 17, total: 1 },
  { label: '小', match: (card) => card.value === 16, total: 1 },
  ...['2', 'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3'].map((rank) => ({ label: rank, match: (card: Card) => card.rank === rank, total: 4 }))
];

/** 春天：地主一手走完、农民一张没出；反春：农民赢且地主只出过一手 */
function springOf(table: TableState) {
  const farmers = ([0, 1, 2] as PlayerIndex[]).filter((index) => index !== table.landlord);
  if (table.winner === table.landlord && farmers.every((index) => table.plays[index] === 0)) return '春天';
  if (table.winner !== null && table.winner !== table.landlord && table.plays[table.landlord] <= 1) return '反春';
  return null;
}

/** 测试与旧存档回归用：设了这个开关就跳过叫地主，玩家直接当地主 */
const SKIP_BID_KEY = 'jiaye-ddz-skip-bid';
// 出牌倒计时（秒）；测试用 localStorage 覆盖，0 表示不计时
const AUTO_PILOT_AFTER_TIMEOUTS = 2;
const TURN_SECONDS_KEY = 'jiaye-ddz-turn-seconds';
const TURN_SECONDS = 20;
const BID_SECONDS = 15;
/** 打满这么多局之前算新手：倒计时加倍、超时不进托管 */
const NOVICE_GAMES = 5;
function turnSeconds(bidding: boolean, novice: boolean) {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(TURN_SECONDS_KEY) : null;
    if (raw !== null && raw !== '' && Number.isFinite(Number(raw))) return Math.max(0, Number(raw));
  } catch {
    /* 存储被禁用时走默认 */
  }
  return (bidding ? BID_SECONDS : TURN_SECONDS) * (novice ? 2 : 1);
}

/** 桌心提示一行字（系统代操作时告诉玩家发生了什么） */
function withFlash(table: TableState, text: string, big = false): TableState {
  return { ...table, flash: { id: (table.flash?.id ?? 0) + 1, text, big } };
}

function skipBidding() {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(SKIP_BID_KEY) === '1';
  } catch {
    return false;
  }
}

/** 随行伴侣的牌局状态：开局按等级给次数 */
function newSkillState(escort: EscortInfo | null | undefined): SkillState {
  const skill = escort ? partnerSkills[escort.id] : null;
  return {
    id: skill ? escort!.id : null,
    level: skill ? escort!.level : 0,
    usesLeft: skill ? skill.uses[escort!.level - 1] : 0,
    doubled: 1,
    offer: false,
    myBombs: 0,
    longCombos: 0,
    peeked: 0,
    swapping: false,
    flipIndex: null,
    answer: null,
    uses: 0
  };
}

/** 重新发牌时技能状态：次数与已发动次数带过去，其余按新牌重来 */
function carrySkill(skill: SkillState): SkillState {
  return { ...skill, doubled: 1, offer: false, myBombs: 0, longCombos: 0, peeked: 0, swapping: false, flipIndex: null, answer: null };
}

const skillValue = (skill: SkillState) => (skill.id && skill.level > 0 ? partnerSkills[skill.id].values[skill.level - 1] : 0);
const skillLabel = (skill: SkillState, name: string) => (skill.id ? `${name}·${partnerSkills[skill.id].name}` : '');

/** forceLandlord：守城「城主坐庄」，跳过叫地主，玩家直接当地主 */
function createInitialTable(skill: SkillState, escortName = '', forceLandlord = false): TableState {
  const deal = createDoudizhuDeal();
  const kittyIds = new Set(deal.landlordCards.map((card) => card.id));
  const base: TableState = {
    // 发牌：每人 17 张，三张底牌留给叫到地主的人
    hands: { 0: deal.hands[0].filter((card) => !kittyIds.has(card.id)), 1: deal.hands[1], 2: deal.hands[2] },
    landlordCards: deal.landlordCards,
    selectedIds: [],
    currentPlayer: 0,
    consecutivePasses: 0,
    lastPlay: null,
    recentMoves: { 0: [], 1: [], 2: [] },
    recentActions: createSeatActions(),
    history: ['发牌完毕，由你先叫地主。'],
    winner: null,
    multiplier: 1,
    plays: { 0: 0, 1: 0, 2: 0 },
    played: [],
    flash: null,
    phase: 'bidding',
    landlord: 0,
    bid: { turn: 0, candidate: null, firstCaller: null, acted: 0, rebidUsed: false, words: { 0: null, 1: null, 2: null } },
    skill,
    // 貂蝉「闭月」开局即发动：桌心播报
    ...(skill.id === 'diaochan' && escortName ? { flash: { id: 1, text: skillLabel(skill, escortName), big: true } } : {})
  };
  if (forceLandlord) return finishBidding({ ...base, history: ['城主坐庄：你当地主，先出牌。'], bid: { ...base.bid, candidate: 0 } }, escortName);
  return skipBidding() ? finishBidding({ ...base, bid: { ...base.bid, candidate: 0 } }, escortName) : base;
}

/** 甄姬「洛神」：整桌重发，倍数回到 ×1；二重起重发后多看底牌 */
function redealTable(table: TableState, escortName: string): TableState {
  const skill = { ...carrySkill(table.skill), usesLeft: table.skill.usesLeft - 1, uses: table.skill.uses + 1, peeked: skillValue(table.skill) };
  const next = createInitialTable(skill, escortName);
  return withFlash({ ...next, history: ['洛神：整桌重新发牌。', ...next.history].slice(0, 12), flash: table.flash }, skillLabel(skill, escortName), true);
}

/** 黄月英「木牛流马」二重起：先翻开没看过的底牌（三重翻两张，换其中大的），再决定拿哪张手牌换 */
function flipKitty(table: TableState, visibleBase: number, escortName: string): TableState {
  const total = table.landlordCards.length;
  const want = Math.max(1, skillValue(table.skill));
  const opened = Math.max(0, Math.min(want, total - visibleBase));
  const indices = opened > 0 ? Array.from({ length: opened }, (_v, i) => visibleBase + i) : [total - 1];
  const index = indices.reduce((best, i) => (table.landlordCards[i].value > table.landlordCards[best].value ? i : best), indices[0]);
  const skill = { ...table.skill, usesLeft: table.skill.usesLeft - 1, uses: table.skill.uses + 1, peeked: table.skill.peeked + opened, swapping: true, flipIndex: index };
  return withFlash({ ...table, skill }, `${skillLabel(skill, escortName)} · 翻开 ${indices.map((i) => table.landlordCards[i].label).join(' ')}`, true);
}

/** 黄月英「木牛流马」：手牌 cardId 与底牌互换（盲换随机挑一张没看过的，换完那格亮出） */
function swapKitty(table: TableState, cardId: string, visibleBase: number, escortName: string): TableState {
  const card = table.hands[0].find((item) => item.id === cardId);
  if (!card || table.phase !== 'bidding' || !table.skill.swapping) return table;
  const kitty = [...table.landlordCards];
  let index = table.skill.flipIndex;
  let { peeked, usesLeft, uses } = table.skill;
  if (index === null) {
    // 盲换：从没亮出的底牌里随机挑，挑中的挪到亮出区
    const hidden = kitty.map((_c, i) => i).filter((i) => i >= visibleBase);
    const pick = hidden.length > 0 ? hidden[Math.floor(ddzRandom() * hidden.length)] : Math.floor(ddzRandom() * kitty.length);
    const slot = Math.min(visibleBase, kitty.length - 1);
    [kitty[slot], kitty[pick]] = [kitty[pick], kitty[slot]];
    index = slot;
    peeked += visibleBase < kitty.length ? 1 : 0;
    usesLeft -= 1;
    uses += 1;
  }
  const got = kitty[index];
  kitty[index] = card;
  return withFlash({
    ...table,
    landlordCards: kitty,
    hands: { ...table.hands, 0: sortCards([...table.hands[0].filter((item) => item.id !== cardId), got]) },
    selectedIds: [],
    skill: { ...table.skill, peeked, usesLeft, uses, swapping: false, flipIndex: null },
    history: [`木牛流马：以 ${card.label} 换得 ${got.label}。`, ...table.history].slice(0, 12)
  }, `木牛流马 · 换得 ${got.label}`, true);
}

/** 叫抢结束：地主拿底牌、先出牌；小乔「赤壁」此时可选加倍，大乔「同心」亮出队友 */
function finishBidding(table: TableState, escortName = ''): TableState {
  const landlord = table.bid.candidate ?? 0;
  const skill = table.skill;
  // 叫抢已把倍数抢到封顶 8 时加倍多赢不到，不再弹
  const offer = skill.id === 'xiaoqiao' && (landlord === 0 || skill.level >= 2) && table.multiplier < MAX_MULTIPLIER;
  const daqiaoOn = skill.id === 'daqiao' && (landlord !== 0 || skill.level >= 3);
  const next: TableState = {
    ...table,
    phase: 'playing',
    landlord,
    currentPlayer: landlord,
    hands: { ...table.hands, [landlord]: sortCards([...table.hands[landlord], ...table.landlordCards]) },
    recentActions: createSeatActions(),
    history: [`${landlord === 0 ? '你' : '对手'}成为地主，获得三张底牌。`, ...table.history].slice(0, 12),
    skill: { ...skill, offer, swapping: false, flipIndex: null, uses: skill.uses + (daqiaoOn ? 1 : 0) }
  };
  return daqiaoOn && escortName ? withFlash(next, skillLabel(skill, escortName), true) : next;
}

/** 表态一次：叫/抢翻倍，一圈后若首叫者被抢过还能回抢一次；无人叫则重发 */
function applyBid(table: TableState, player: PlayerIndex, want: boolean, escortName = ''): TableState {
  const { bid } = table;
  const isCall = bid.candidate === null;
  const word: BidWord = isCall ? (want ? '叫地主' : '不叫') : want ? '抢地主' : '不抢';
  const candidate = want ? player : bid.candidate;
  const firstCaller = bid.firstCaller ?? (want && isCall ? player : null);
  const multiplier = want && !isCall ? Math.min(MAX_MULTIPLIER, table.multiplier * 2) : table.multiplier;
  const isRebid = bid.acted >= 3;
  const acted = bid.acted + 1;
  const next: TableState = {
    ...table,
    multiplier,
    bid: { ...bid, candidate, firstCaller, acted, rebidUsed: bid.rebidUsed || isRebid, words: { ...bid.words, [player]: word }, turn: nextPlayer(player) },
    // 表过态就收起木牛流马的换牌手势
    skill: player === 0 ? { ...table.skill, swapping: false, flipIndex: null } : table.skill,
    recentActions: { ...table.recentActions, [player]: { kind: want ? 'play' : 'pass', label: word } }
  };
  if (isRebid) return finishBidding(next, escortName);
  if (acted < 3) return next;
  // 一圈结束
  if (candidate === null) return withFlash({ ...createInitialTable(carrySkill(table.skill)), history: ['三家都不叫，重新发牌。'], flash: table.flash }, '三家都不叫，重新发牌');
  if (firstCaller !== null && firstCaller !== candidate && !next.bid.rebidUsed) {
    return { ...next, bid: { ...next.bid, turn: firstCaller } };
  }
  return finishBidding(next, escortName);
}

/** AI 叫抢：按大牌与炸弹估牌力，高手档门槛略低（更敢叫） */
function aiWantsLandlord(hand: Card[], skill: AiSkill, contested: boolean) {
  const counts = new Map<number, number>();
  for (const card of hand) counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  const bombs = [...counts.values()].filter((n) => n === 4).length;
  const score = (counts.get(17) ? 3 : 0) + (counts.get(16) ? 2 : 0) + (counts.get(15) ?? 0) * 2 + (counts.get(14) ?? 0) + bombs * 4;
  const threshold = (skill === 'master' ? 7 : skill === 'novice' ? 9 : 8) + (contested ? 2 : 0);
  return score >= threshold;
}

function createSeatActions(): Record<PlayerIndex, SeatAction> {
  return {
    0: { kind: 'idle', label: '等待出牌' },
    1: { kind: 'idle', label: '等待出牌' },
    2: { kind: 'idle', label: '等待出牌' }
  };
}

// 对手按已打场次轮换，每局换一对，性格不同打法也不同
function createPlayerProfiles(lord: Lord, gamesPlayed: number, skill: AiSkill): Record<PlayerIndex, PlayerProfile> {
  const pool = OPPONENT_POOL.map((id) => lords.find((item) => item.id === id))
    .filter((item): item is Lord => item !== undefined && item.id !== lord.id);
  const firstOpponent = pool[gamesPlayed % pool.length] ?? lord;
  const secondOpponent = pool[(gamesPlayed + 3) % pool.length] ?? firstOpponent;

  return {
    0: { name: lord.name, title: lord.title, role: '地主', imagePath: lord.imagePath, style: null },
    1: { name: firstOpponent.name, title: firstOpponent.title, role: '农民', imagePath: firstOpponent.imagePath, style: LORD_AI_STYLE[firstOpponent.id] ?? 'balanced', skill },
    2: { name: secondOpponent.name, title: secondOpponent.title, role: '农民', imagePath: secondOpponent.imagePath, style: LORD_AI_STYLE[secondOpponent.id] ?? 'balanced', skill }
  };
}

function resolveSingleAiTurn(table: TableState, playerNames: Record<PlayerIndex, string>, styles: Record<PlayerIndex, AiStyle | null>, skill: AiSkill): TableState {
  const player = table.currentPlayer;
  const target = table.lastPlay && table.lastPlay.player !== player ? table.lastPlay.combo : null;
  // 身份按牌局实际地主算：地主没有队友，农民的队友是另一位农民
  const landlord = table.landlord;
  const others = ([0, 1, 2] as PlayerIndex[]).filter((index) => index !== player);
  const isLandlord = player === landlord;
  const teammate = isLandlord ? null : others.find((index) => index !== landlord) ?? null;
  const teammateLeads = Boolean(table.lastPlay && teammate !== null && table.lastPlay.player === teammate);
  const pressure = isLandlord ? Math.min(...others.map((index) => table.hands[index].length)) : table.hands[landlord].length;
  const teammateCards = teammate !== null ? table.hands[teammate].length : undefined;
  const cards = chooseAiPlay(table.hands[player], target, styles[player] ?? 'balanced', { landlordCards: pressure, teammateLeads, teammateCards, skill, unseen: others.flatMap((index) => table.hands[index]) });
  const combo = cards ? evaluateCards(cards) : null;

  if (cards && combo && canBeat(combo, target)) {
    return applyPlay(table, player, cards, combo, `${playerNames[player]}出牌：${combo.label} ${formatCards(cards)}`);
  }

  return applyPass(table, player, `${playerNames[player]}不要。`);
}

function applyPlay(table: TableState, player: PlayerIndex, cards: Card[], combo: Combo, history: string): TableState {
  const playedIds = new Set(cards.map((card) => card.id));
  const hand = table.hands[player].filter((card) => !playedIds.has(card.id));
  const nextHands = {
    ...table.hands,
    [player]: hand
  };
  const winner = hand.length === 0 ? player : null;
  const isBomb = combo.type === 'bomb' || combo.type === 'rocket';
  const mine = player === 0;
  const skill = table.skill;
  // 孙尚香「枭姬」：你打出的炸弹、王炸不是 ×2 而是按等级翻（仍封顶 ×8）
  const quad = isBomb && mine && skill.id === 'sunshangxiang';
  const bombFactor = quad ? skillValue(skill) : 2;
  const multiplier = isBomb ? Math.min(MAX_MULTIPLIER, table.multiplier * bombFactor) : table.multiplier;
  // 祝融「烈火」：你每打出一手 5 张以上的顺子、连对、飞机，赢牌缴获 +5%，到上限为止
  const fire = mine && skill.id === 'zhurong' && LONG_COMBOS.has(combo.type) && cards.length >= 5;
  const fireCounts = fire && skill.longCombos * ZHURONG_STEP < skillValue(skill) - 1e-9;
  const flashText = FLASH_TEXT[combo.type];
  const flashCopy = quad ? `弓腰姬 ×${formatMult(bombFactor)}` : fireCounts ? `${flashText ?? ''} · 烈火 +${Math.round(ZHURONG_STEP * 100)}%` : isBomb ? `${flashText} ×2` : flashText;

  return {
    ...table,
    multiplier,
    plays: { ...table.plays, [player]: table.plays[player] + 1 },
    played: [...table.played, ...cards],
    skill: mine
      ? { ...skill, offer: false, answer: null, myBombs: skill.myBombs + (isBomb ? 1 : 0), longCombos: skill.longCombos + (fire ? 1 : 0), uses: skill.uses + (quad ? 1 : 0) + (fireCounts ? 1 : 0) }
      : { ...skill, offer: false },
    flash: flashCopy ? { id: (table.flash?.id ?? 0) + 1, text: flashCopy, big: isBomb || fireCounts } : table.flash,
    hands: nextHands,
    selectedIds: [],
    currentPlayer: nextPlayer(player),
    consecutivePasses: 0,
    lastPlay: { player, cards, combo },
    recentMoves: { ...table.recentMoves, [player]: cards },
    recentActions: { ...table.recentActions, [player]: { kind: 'play', label: combo.label } },
    history: [history, ...table.history].slice(0, 12),
    winner
  };
}

function applyPass(table: TableState, player: PlayerIndex, history: string): TableState {
  const passes = table.consecutivePasses + 1;
  const roundCleared = passes >= 2;
  return {
    ...table,
    // 任何人出过手（含不要）就收起赤壁的加倍选择
    skill: player === 0 ? { ...table.skill, offer: false, answer: null } : { ...table.skill, offer: false },
    selectedIds: [],
    currentPlayer: nextPlayer(player),
    consecutivePasses: roundCleared ? 0 : passes,
    lastPlay: roundCleared ? null : table.lastPlay,
    recentMoves: { ...table.recentMoves, [player]: [] },
    recentActions: { ...table.recentActions, [player]: { kind: 'pass', label: roundCleared ? '不要，本轮清牌' : '不要' } },
    history: [roundCleared ? `${history} 本轮清牌。` : history, ...table.history].slice(0, 12)
  };
}

function nextPlayer(player: PlayerIndex): PlayerIndex {
  return (((player + 1) % 3) as PlayerIndex);
}
