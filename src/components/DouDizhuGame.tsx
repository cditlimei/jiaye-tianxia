import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { lords } from '../data/gameData';
import type { Lord } from '../data/gameData';
import { imageUrl } from '../lib/assets';
import type { Card, Combo, PlayerIndex } from '../lib/doudizhu';
import { canBeat, comboLabel, createDoudizhuDeal, evaluateCards, findFirstPlayable, formatCards, sortCards } from '../lib/doudizhu';
import { GameButton } from './common/GameButton';
import { ImageWithFallback } from './common/ImageWithFallback';

interface DouDizhuGameProps {
  lord: Lord;
  wins: number;
  losses: number;
  rewardGold: number;
  onSfx: (path: string, volume?: number) => void;
  onResolved: (win: boolean, rewardGold: number) => void;
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
  history: string[];
  winner: PlayerIndex | null;
}

interface PlayerProfile {
  name: string;
  title: string;
  role: '地主' | '农民';
  imagePath: string;
}

const OPPONENT_IDS = ['caocao', 'sunquan', 'liubei', 'zhouyu', 'zhaoyun', 'simayi'];

export function DouDizhuGame({ lord, wins, losses, rewardGold, onSfx, onResolved, onReturnHome }: DouDizhuGameProps) {
  const [table, setTable] = useState<TableState>(() => createInitialTable());
  const settledRef = useRef(false);
  const aiTimerRef = useRef<number | null>(null);
  const profiles = useMemo(() => createPlayerProfiles(lord), [lord]);
  const playerNames = useMemo(
    () => ({
      0: profiles[0].name,
      1: profiles[1].name,
      2: profiles[2].name
    }) satisfies Record<PlayerIndex, string>,
    [profiles]
  );
  const playerHand = table.hands[0];
  const selectedCards = useMemo(
    () => sortCards(playerHand.filter((card) => table.selectedIds.includes(card.id))),
    [playerHand, table.selectedIds]
  );
  const selectedCombo = useMemo(() => evaluateCards(selectedCards), [selectedCards]);
  const targetCombo = table.lastPlay?.player === 0 ? null : table.lastPlay?.combo ?? null;
  const suggestedCards = useMemo(() => findFirstPlayable(playerHand, targetCombo), [playerHand, targetCombo]);
  const canPlay = table.currentPlayer === 0 && canBeat(selectedCombo, targetCombo);
  const canPass = table.currentPlayer === 0 && Boolean(table.lastPlay && table.lastPlay.player !== 0);
  const canHint = table.currentPlayer === 0 && table.winner === null && Boolean(suggestedCards);
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
  const statusCopy = table.winner !== null
    ? table.winner === 0
      ? `牌局胜利，缴获 ${rewardGold.toLocaleString()} 金`
      : `${playerNames[table.winner]}先走完牌，本局失利`
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
        return resolveSingleAiTurn(prev, playerNames);
      });
      aiTimerRef.current = null;
    }, 560);

    return () => {
      if (aiTimerRef.current !== null) {
        window.clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }
    };
  }, [playerNames, table.currentPlayer, table.winner]);

  useEffect(() => {
    if (table.winner === null || settledRef.current) {
      return;
    }
    settledRef.current = true;
    const win = table.winner === 0;
    onSfx(win ? 'audio/sfx/sfx_victory.mp3' : 'audio/sfx/sfx_defeat.mp3', 0.58);
    onResolved(win, win ? rewardGold : 0);
  }, [onResolved, onSfx, rewardGold, table.winner]);

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
    onSfx('audio/sfx/sfx_button.mp3', 0.32);
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
  };

  const resetSelection = () => {
    setTable((prev) => ({ ...prev, selectedIds: [] }));
  };

  const selectCardFromHand = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || table.currentPlayer !== 0 || table.winner !== null || playerHand.length === 0) return;
    event.preventDefault();
    event.stopPropagation();

    const index = handIndexFromPointer(event.currentTarget.getBoundingClientRect(), event.clientX, playerHand.length);
    const card = playerHand[index];
    if (card) {
      toggleCard(card.id);
    }
  };

  return (
    <main className="screen doudizhu-screen">
      <aside className="orientation-tip" aria-hidden="true">
        <strong>横屏牌桌</strong>
        <span>把手机横过来，手牌和对局信息会更清楚。</span>
      </aside>

      <header className="screen-header doudizhu-header">
        <div>
          <span className="eyebrow">荆州 · 斗地主</span>
          <h2>斗地主牌局</h2>
        </div>
        <div className="doudizhu-header__side">
          <span className="battle-record">胜 {wins} · 负 {losses}</span>
          <GameButton variant="ghost" onClick={onReturnHome}>
            回府
          </GameButton>
        </div>
      </header>

      <section className="doudizhu-status" aria-live="polite">
        <div>
          <span>三人同桌 · {lord.name}坐庄</span>
          <strong>{statusCopy}</strong>
        </div>
        <div>
          <span>地主底牌</span>
          <strong>{formatCards(table.landlordCards)}</strong>
        </div>
        <div className="doudizhu-selection-status">
          <span>已选牌</span>
          <strong>{selectedCopy}</strong>
        </div>
      </section>

      <section className="doudizhu-tabletop" aria-label="三人斗地主牌桌">
        <div className="table-felt-lines" aria-hidden="true" />
        <div className="table-dealer-mark" aria-hidden="true">
          庄
        </div>
        <div className="landlord-kitty" aria-label="地主底牌">
          <span>地主底牌</span>
          <MiniCardStrip cards={table.landlordCards} emptyLabel="底牌未亮" center />
        </div>
        <PlayerSeat
          profile={profiles[1]}
          handCount={table.hands[1].length}
          recentCards={table.recentMoves[1]}
          active={table.currentPlayer === 1}
          seat="opponent-left"
        />
        <PlayerSeat
          profile={profiles[2]}
          handCount={table.hands[2].length}
          recentCards={table.recentMoves[2]}
          active={table.currentPlayer === 2}
          seat="opponent-right"
        />
        <div className="table-center">
          <div className="last-play-panel">
            <span>当前牌型</span>
            <strong>{table.lastPlay ? `${playerNames[table.lastPlay.player]} · ${table.lastPlay.combo.label}` : '自由出牌'}</strong>
            <MiniCardStrip cards={table.lastPlay?.cards ?? []} emptyLabel="桌面等待首轮出牌" center />
            <p>{table.lastPlay ? formatCards(table.lastPlay.cards) : '无人压牌，任意合法牌型可出。'}</p>
          </div>
          <div className="history-panel">
            {table.history.slice(0, 4).map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </div>
        <PlayerSeat
          profile={profiles[0]}
          handCount={table.hands[0].length}
          recentCards={table.recentMoves[0]}
          active={table.currentPlayer === 0}
          seat="self"
          self
        />
      </section>

      <section className="player-hand" aria-label="你的手牌" onPointerDownCapture={selectCardFromHand}>
        {playerHand.map((card, index) => {
          const selected = table.selectedIds.includes(card.id);
          return (
            <button
              key={card.id}
              type="button"
              className={`poker-card ${card.red ? 'is-red' : ''} ${selected ? 'is-selected' : ''}`}
              style={handCardStyle(index, playerHand.length, selected)}
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleCard(card.id);
                }
              }}
              aria-pressed={selected}
              aria-label={`${card.suit}${card.rank}`}
              data-rank={card.rank}
              data-suit={card.suit}
            >
              <span>{card.suit}</span>
              <strong>{card.rank}</strong>
            </button>
          );
        })}
      </section>

      <section className="doudizhu-actions">
        {table.winner === null ? (
          <>
            <p className="doudizhu-action-readout">{selectedCopy}</p>
            <GameButton variant="ghost" onClick={selectHint} disabled={!canHint}>
              提示
            </GameButton>
            <GameButton onClick={playSelected} disabled={!canPlay}>
              出牌
            </GameButton>
            <GameButton variant="secondary" onClick={pass} disabled={!canPass}>
              不要
            </GameButton>
            <GameButton variant="ghost" onClick={resetSelection} disabled={table.selectedIds.length === 0}>
              重选
            </GameButton>
          </>
        ) : (
          <GameButton block onClick={onReturnHome}>
            返回家业
          </GameButton>
        )}
      </section>
    </main>
  );
}

function PlayerSeat({
  profile,
  handCount,
  recentCards,
  active,
  seat,
  self = false
}: {
  profile: PlayerProfile;
  handCount: number;
  recentCards: Card[];
  active: boolean;
  seat: 'opponent-left' | 'opponent-right' | 'self';
  self?: boolean;
}) {
  return (
    <article className={`table-seat table-seat--${seat} ${active ? 'is-active' : ''} ${self ? 'is-self' : ''}`}>
      <ImageWithFallback src={imageUrl(profile.imagePath, 160)} alt={profile.name} className="table-seat__avatar" />
      <div className="table-seat__copy">
        <strong>{profile.name}</strong>
        <span>{profile.role} · {profile.title}</span>
        <em>{handCount} 张手牌</em>
      </div>
      <MiniCardStrip cards={recentCards} emptyLabel="静待出牌" />
    </article>
  );
}

function MiniCardStrip({ cards, emptyLabel, center = false }: { cards: Card[]; emptyLabel: string; center?: boolean }) {
  return (
    <div className={`mini-card-strip ${center ? 'mini-card-strip--center' : ''} ${cards.length === 0 ? 'is-empty' : ''}`}>
      {cards.length > 0 ? (
        cards.map((card) => <MiniCard key={card.id} card={card} />)
      ) : (
        <span className="mini-card-empty">{emptyLabel}</span>
      )}
    </div>
  );
}

function MiniCard({ card }: { card: Card }) {
  return (
    <span className={`mini-card ${card.red ? 'is-red' : ''}`}>
      <span>{card.suit}</span>
      <strong>{card.rank}</strong>
    </span>
  );
}

function handCardStyle(index: number, count: number, selected: boolean): CSSProperties {
  const progress = count <= 1 ? 0.5 : index / (count - 1);
  const spread = progress - 0.5;
  const rotate = spread * 4.8;
  const edgeDrop = Math.abs(spread) * 5;
  const selectedRise = selected ? 11 : 0;

  return {
    left: `clamp(calc(var(--hand-card-edge) + 6px), ${progress * 100}%, calc(100% - var(--hand-card-edge) - 6px))`,
    transform: `translateX(-50%) translateY(${edgeDrop - selectedRise}px) rotate(${rotate}deg)`,
    zIndex: selected ? 70 + index : index + 1
  };
}

function handIndexFromPointer(handBox: DOMRect, clientX: number, count: number) {
  if (count <= 1) return 0;

  const progress = Math.min(1, Math.max(0, (clientX - handBox.left) / handBox.width));
  return Math.round(progress * (count - 1));
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
    history: ['你成为地主，获得三张底牌。'],
    winner: null
  };
}

function createPlayerProfiles(lord: Lord): Record<PlayerIndex, PlayerProfile> {
  const opponents = OPPONENT_IDS.map((id) => lords.find((item) => item.id === id))
    .filter((item): item is Lord => item !== undefined && item.id !== lord.id)
    .slice(0, 2);
  const fallbackOpponents = lords.filter((item) => item.id !== lord.id && !opponents.some((opponent) => opponent.id === item.id));
  const firstOpponent = opponents[0] ?? fallbackOpponents[0] ?? lord;
  const secondOpponent = opponents[1] ?? fallbackOpponents[1] ?? firstOpponent;

  return {
    0: { name: lord.name, title: lord.title, role: '地主', imagePath: lord.imagePath },
    1: { name: firstOpponent.name, title: firstOpponent.title, role: '农民', imagePath: firstOpponent.imagePath },
    2: { name: secondOpponent.name, title: secondOpponent.title, role: '农民', imagePath: secondOpponent.imagePath }
  };
}

function resolveSingleAiTurn(table: TableState, playerNames: Record<PlayerIndex, string>): TableState {
  const player = table.currentPlayer;
  const target = table.lastPlay && table.lastPlay.player !== player ? table.lastPlay.combo : null;
  const cards = findFirstPlayable(table.hands[player], target);
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

  return {
    ...table,
    hands: nextHands,
    selectedIds: [],
    currentPlayer: nextPlayer(player),
    consecutivePasses: 0,
    lastPlay: { player, cards, combo },
    recentMoves: { ...table.recentMoves, [player]: cards },
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
    history: [roundCleared ? `${history} 本轮清牌。` : history, ...table.history].slice(0, 12)
  };
}

function nextPlayer(player: PlayerIndex): PlayerIndex {
  return (((player + 1) % 3) as PlayerIndex);
}
