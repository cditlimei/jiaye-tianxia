import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { lords } from '../data/gameData';
import type { Lord } from '../data/gameData';
import { imageUrl } from '../lib/assets';
import type { Card, Combo, PlayerIndex } from '../lib/doudizhu';
import { AI_SKILL_LABEL, AI_STYLE_LABEL, LORD_AI_STYLE, type AiSkill, type ComboType, canBeat, chooseAiPlay, comboLabel, createDoudizhuDeal, evaluateCards, findPlayableCombos, formatCards, sortCards, sortCardsDescending } from '../lib/doudizhu';
import type { AiStyle } from '../lib/doudizhu';
import { GameButton } from './common/GameButton';
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
  onResolved: (win: boolean, rewardGold: number, lossGold: number, forfeit?: boolean, multiplier?: number) => void;
  onReturnHome: () => void;
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
const HAND_EDGE_PERCENT = 7.2;
// 竖屏手牌超过这个张数就分两行，避免 20 张挤成一排看不清点数
const TWO_ROW_THRESHOLD = 12;
const PORTRAIT_QUERY = '(orientation: portrait) and (max-width: 700px)';

export function DouDizhuGame({ lord, wins, losses, rewardGold, aiSkill, lossGold, onSfx, onResolved, onReturnHome }: DouDizhuGameProps) {
  const [table, setTable] = useState<TableState>(() => createInitialTable());
  const [hintIndex, setHintIndex] = useState(0);
  const settledRef = useRef(false);
  const aiTimerRef = useRef<number | null>(null);
  const [gamesPlayedAtStart] = useState(() => wins + losses);
  const profiles = useMemo(() => createPlayerProfiles(lord, gamesPlayedAtStart, aiSkill), [aiSkill, lord, gamesPlayedAtStart]);
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
  const canPlay = table.currentPlayer === 0 && canBeat(selectedCombo, targetCombo);
  const canPass = table.currentPlayer === 0 && Boolean(table.lastPlay && table.lastPlay.player !== 0);
  const canHint = table.currentPlayer === 0 && table.winner === null && playableHints.length > 0;
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
  const spring = springOf(table);
  const finalMultiplier = Math.min(MAX_MULTIPLIER, table.multiplier * (spring ? 2 : 1));
  // 记牌器：去掉自己手牌和已出的牌，剩下的就是另外两家手里的
  const counter = COUNTER_RANKS.map((item) => ({
    label: item.label,
    left: item.total - playerHand.filter(item.match).length - table.played.filter(item.match).length
  }));
  const statusCopy = table.winner !== null
    ? table.winner === 0
      ? `胜 +${(rewardGold * finalMultiplier).toLocaleString()} 金${finalMultiplier > 1 ? `（×${finalMultiplier}${spring ? ` · ${spring}` : ''}）` : ''}`
      : `${playerNames[table.winner]}先走完 −${(lossGold * finalMultiplier).toLocaleString()} 金${finalMultiplier > 1 ? `（×${finalMultiplier}${spring ? ` · ${spring}` : ''}）` : ''}`
    : table.currentPlayer === 0
      ? targetCombo
        ? `请大过 ${playerNames[table.lastPlay!.player]} 的${comboLabel(targetCombo)}`
        : '本轮由你先出牌'
      : `${playerNames[table.currentPlayer]}思索中`;

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

    if (table.winner !== null || table.currentPlayer === 0) {
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
  }, [aiSkill, playerNames, styles, table.currentPlayer, table.winner]);

  useEffect(() => {
    if (table.winner === null || settledRef.current) {
      return;
    }
    settledRef.current = true;
    const win = table.winner === 0;
    onSfx(win ? 'audio/sfx/sfx_victory.mp3' : 'audio/sfx/sfx_defeat.mp3', 0.58);
    onResolved(win, win ? rewardGold * finalMultiplier : 0, lossGold * finalMultiplier, false, finalMultiplier);
  }, [finalMultiplier, lossGold, onResolved, onSfx, rewardGold, table.winner]);

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

  const toggleCard = (cardId: string) => {
    if (table.currentPlayer !== 0 || table.winner !== null) return;
    setTable((prev) => ({
      ...prev,
      selectedIds: prev.selectedIds.includes(cardId)
        ? prev.selectedIds.filter((id) => id !== cardId)
        : [...prev.selectedIds, cardId]
    }));
  };

  const playSelected = () => {
    if (!canPlay || !selectedCombo) return;
    setTable((prev) => applyPlay(prev, 0, selectedCards, selectedCombo, `你出牌：${selectedCombo.label} ${formatCards(selectedCards)}`));
  };

  const pass = () => {
    if (!canPass) return;
    onSfx('audio/sfx/sfx_button.mp3', 0.24);
    setTable((prev) => applyPass(prev, 0, '你选择不要。'));
  };

  const selectHint = () => {
    if (!canHint || !suggestedCards) return;
    onSfx('audio/sfx/sfx_button.mp3', 0.18);
    setTable((prev) => ({ ...prev, selectedIds: suggestedCards.map((card) => card.id) }));
    setHintIndex((prev) => (playableHints.length > 0 ? (prev + 1) % playableHints.length : 0));
  };

  const leaveTable = () => {
    if (table.winner === null && !window.confirm(`认输将损失 ${(lossGold * table.multiplier).toLocaleString()} 金（当前 ×${table.multiplier}），确定回府？`)) {
      return;
    }
    if (table.winner === null && !settledRef.current) {
      settledRef.current = true;
      onResolved(false, 0, lossGold * table.multiplier, true, table.multiplier);
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
    const index = handIndexFromPointer(target.getBoundingClientRect(), clientX, clientY, displayedHand.length, twoRows);
    return displayedHand[index]?.id ?? null;
  };

  // 滑动选牌：按下开始一次手势，划过的每张牌翻转一次（主流斗地主的连选方式）
  const swipeRef = useRef<Set<string> | null>(null);
  const selectCardFromHand = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || table.currentPlayer !== 0 || table.winner !== null || playerHand.length === 0) return;
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

  return (
    <main className="screen ddz-screen">
      <header className="ddz-topbar">
        {table.winner === null ? (
          <button type="button" className="ddz-topbar__quit" onClick={leaveTable}>认输 −{(lossGold * table.multiplier).toLocaleString()}</button>
        ) : (
          <span className="ddz-topbar__quit is-idle">牌局结束</span>
        )}
        <div className="ddz-topbar__kitty" aria-label="地主底牌">
          <span>底牌</span>
          <MiniCardStrip cards={table.landlordCards} emptyLabel="未亮" center />
        </div>
        <div className="ddz-topbar__stake">
          <h2>斗地主牌局</h2>
          <span className="ddz-multiplier">倍数 ×{finalMultiplier}</span>
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

      <section className="ddz-table" aria-label="三人斗地主牌桌">
        <PlayerSeat
          profile={profiles[1]}
          handCount={table.hands[1].length}
          recentCards={table.recentMoves[1]}
          recentAction={table.recentActions[1]}
          active={table.winner === null && table.currentPlayer === 1}
          seat="left"
        />
        <PlayerSeat
          profile={profiles[2]}
          handCount={table.hands[2].length}
          recentCards={table.recentMoves[2]}
          recentAction={table.recentActions[2]}
          active={table.winner === null && table.currentPlayer === 2}
          seat="right"
        />
        {table.flash && (
          <div key={table.flash.id} className={`ddz-flash ${table.flash.big ? 'is-big' : ''}`} aria-hidden="true">{table.flash.text}</div>
        )}
        <div className="ddz-center" aria-live="polite">
          <span>{table.lastPlay ? `${playerNames[table.lastPlay.player]} · ${table.lastPlay.combo.label}` : '自由出牌'}</span>
          <strong>{statusCopy}</strong>
        </div>
        <PlayerSeat
          profile={profiles[0]}
          handCount={table.hands[0].length}
          recentCards={table.recentMoves[0]}
          recentAction={table.recentActions[0]}
          active={table.winner === null && table.currentPlayer === 0}
          seat="self"
          self
        />
      </section>

      {table.winner !== null && (
        <div className={`doudizhu-result-banner ${table.winner === 0 ? 'is-win' : 'is-loss'}`} role="status">
          <strong>{table.winner === 0 ? '牌局得胜' : '下局再战'}</strong>
          <span>{statusCopy}</span>
        </div>
      )}

      <section className="ddz-actions" aria-live="polite">
        {table.winner === null ? (
          <>
            <p className="ddz-readout">{table.currentPlayer === 0 ? selectedCopy : `等待 ${playerNames[table.currentPlayer]} 出牌`}</p>
            <div className="ddz-actions__row">
              <button type="button" className="ddz-btn ddz-btn--pass" onClick={pass} disabled={!canPass}>不要</button>
              <button type="button" className="ddz-btn ddz-btn--hint" onClick={selectHint} disabled={!canHint}>提示</button>
              <button type="button" className="ddz-btn ddz-btn--play" onClick={playSelected} disabled={!canPlay}>出牌</button>
              <button type="button" className="ddz-btn ddz-btn--reset" onClick={resetSelection} disabled={table.selectedIds.length === 0}>重选</button>
            </div>
          </>
        ) : (
          <div className="ddz-actions__row">
            <button type="button" className="ddz-btn ddz-btn--play" onClick={onReturnHome}>返回家业</button>
          </div>
        )}
      </section>

      <section className={`player-hand ${twoRows ? 'player-hand--two-rows' : ''} ${table.winner !== null && playerHand.length === 0 ? 'is-empty' : ''}`} aria-label="你的手牌" onPointerDownCapture={selectCardFromHand} onPointerMove={swipeOverHand} onPointerUp={endSwipe} onPointerCancel={endSwipe}>
        {displayedHand.map((card, index) => {
          const selected = table.selectedIds.includes(card.id);
          const joker = isJoker(card);
          return (
            <button
              key={card.id}
              type="button"
              className={`poker-card ${card.red ? 'is-red' : ''} ${joker ? 'is-joker' : ''} ${selected ? 'is-selected' : ''}`}
              style={handCardStyle(index, displayedHand.length, selected, twoRows)}
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleCard(card.id);
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
                  card.rank
                ) : (
                  <>
                    <b>{card.rank}</b>
                    <i>{card.suit}</i>
                  </>
                )}
              </span>
              <strong className="poker-card__pip" aria-hidden="true">
                {joker ? card.rank : card.suit}
              </strong>
              <span className="poker-card__corner poker-card__corner--bottom" aria-hidden="true">
                {joker ? (
                  card.rank
                ) : (
                  <>
                    <b>{card.rank}</b>
                    <i>{card.suit}</i>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </section>

    </main>
  );
}

function PlayerSeat({
  profile,
  handCount,
  recentCards,
  recentAction,
  active,
  seat,
  self = false
}: {
  profile: PlayerProfile;
  handCount: number;
  recentCards: Card[];
  recentAction: SeatAction;
  active: boolean;
  seat: 'left' | 'right' | 'self';
  self?: boolean;
}) {
  return (
    <article className={`ddz-seat ddz-seat--${seat} ${active ? 'is-active' : ''}`}>
      <div className="ddz-seat__avatar">
        <ImageWithFallback src={imageUrl(profile.imagePath, 160)} alt={profile.name} />
        <span className={`ddz-seat__role ${profile.role === '地主' ? 'is-landlord' : ''}`}>{profile.role}</span>
      </div>
      <div className="ddz-seat__info">
        <strong className="ddz-seat__name">{profile.name}</strong>
        <span className="ddz-seat__count">{handCount} 张</span>
        <span className="ddz-seat__badge">{active ? (self ? '出牌中' : '思考中') : profile.style ? `${AI_STYLE_LABEL[profile.style]}${profile.skill ? AI_SKILL_LABEL[profile.skill] : ''}` : profile.title}</span>
      </div>
      <div className="ddz-seat__play">
        {recentCards.length > 0 && <MiniCardStrip key={recentCards.map((card) => card.id).join()} cards={recentCards} emptyLabel="" />}
        <SeatActionLine action={recentAction} active={active} self={self} hasCards={recentCards.length > 0} />
      </div>
    </article>
  );
}

function SeatActionLine({
  action,
  active,
  self,
  hasCards
}: {
  action: SeatAction;
  active: boolean;
  self: boolean;
  hasCards: boolean;
}) {
  const kind = active ? 'active' : action.kind;
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
  return (
    <span className={`mini-card ${card.red ? 'is-red' : ''} ${isJoker(card) ? 'is-joker' : ''}`}>
      <b className="mini-card__rank">{card.rank}</b>
      {!isJoker(card) && <i className="mini-card__suit">{card.suit}</i>}
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

function handCardStyle(index: number, count: number, selected: boolean, twoRows: boolean): CSSProperties {
  const { row, indexInRow, countInRow, rows } = handRowLayout(index, count, twoRows);
  const progress = countInRow <= 1 ? 0.5 : indexInRow / (countInRow - 1);
  const left = HAND_EDGE_PERCENT + progress * (100 - HAND_EDGE_PERCENT * 2);
  const spread = progress - 0.5;
  const rotate = rows === 2 ? 0 : spread * 4.8;
  const edgeDrop = rows === 2 ? 0 : Math.abs(spread) * 5;
  const rowLift = rows === 2 && row === 0 ? 46 : 0;
  // 选中的牌要一眼看得出来
  const selectedRise = selected ? (rows === 2 ? 9 : 13) : 0;

  return {
    left: `${left}%`,
    transform: `translateX(-50%) translateY(${edgeDrop - rowLift - selectedRise}px) rotate(${rotate}deg)`,
    zIndex: row * 100 + indexInRow + 1
  };
}

function handIndexFromPointer(handBox: DOMRect, clientX: number, clientY: number, count: number, twoRows: boolean) {
  if (count <= 1) return 0;

  const edge = handBox.width * (HAND_EDGE_PERCENT / 100);
  const span = Math.max(1, handBox.width - edge * 2);
  const progress = Math.min(1, Math.max(0, (clientX - handBox.left - edge) / span));
  if (!twoRows) return Math.round(progress * (count - 1));

  const upper = Math.ceil(count / 2);
  const inUpperRow = clientY < handBox.top + handBox.height * 0.45;
  const countInRow = inUpperRow ? upper : count - upper;
  const indexInRow = Math.round(progress * Math.max(0, countInRow - 1));
  return inUpperRow ? indexInRow : upper + indexInRow;
}

function cardIdFromPointer(hand: EventTarget & HTMLElement, clientX: number, clientY: number) {
  const cardElement = document.elementsFromPoint(clientX, clientY)
    .map((element) => element.closest<HTMLButtonElement>('.poker-card'))
    .find((element): element is HTMLButtonElement => element !== null && hand.contains(element));

  return cardElement?.dataset.cardId ?? null;
}

const MAX_MULTIPLIER = 8;
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
  if (table.winner === 0 && table.plays[1] + table.plays[2] === 0) return '春天';
  if (table.winner !== null && table.winner !== 0 && table.plays[0] <= 1) return '反春';
  return null;
}

function createInitialTable(): TableState {
  const deal = createDoudizhuDeal();
  return {
    hands: deal.hands,
    landlordCards: deal.landlordCards,
    selectedIds: [],
    currentPlayer: 0,
    consecutivePasses: 0,
    lastPlay: null,
    recentMoves: { 0: [], 1: [], 2: [] },
    recentActions: createSeatActions(),
    history: ['你成为地主，获得三张底牌。'],
    winner: null,
    multiplier: 1,
    plays: { 0: 0, 1: 0, 2: 0 },
    played: [],
    flash: null
  };
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
  const teammateLeads = Boolean(table.lastPlay && table.lastPlay.player !== player && table.lastPlay.player !== 0);
  const cards = chooseAiPlay(table.hands[player], target, styles[player] ?? 'balanced', { landlordCards: table.hands[0].length, teammateLeads, skill, unseen: [...table.hands[0], ...table.hands[player === 1 ? 2 : 1]] });
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
  const multiplier = isBomb ? Math.min(MAX_MULTIPLIER, table.multiplier * 2) : table.multiplier;
  const flashText = FLASH_TEXT[combo.type];

  return {
    ...table,
    multiplier,
    plays: { ...table.plays, [player]: table.plays[player] + 1 },
    played: [...table.played, ...cards],
    flash: flashText ? { id: (table.flash?.id ?? 0) + 1, text: isBomb ? `${flashText} ×2` : flashText, big: isBomb } : table.flash,
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
