import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lord } from '../data/gameData';
import type { Card, Combo, PlayerIndex } from '../lib/doudizhu';
import { canBeat, comboLabel, createDoudizhuDeal, evaluateCards, findFirstPlayable, formatCards, sortCards } from '../lib/doudizhu';
import { GameButton } from './common/GameButton';

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

const PLAYER_META: Record<PlayerIndex, { name: string; role: string }> = {
  0: { name: '主公', role: '地主' },
  1: { name: '许都散骑', role: '农民' },
  2: { name: '江东游侠', role: '农民' }
};

export function DouDizhuGame({ lord, wins, losses, rewardGold, onSfx, onResolved, onReturnHome }: DouDizhuGameProps) {
  const [table, setTable] = useState<TableState>(() => createInitialTable());
  const settledRef = useRef(false);
  const playerHand = table.hands[0];
  const selectedCards = useMemo(
    () => sortCards(playerHand.filter((card) => table.selectedIds.includes(card.id))),
    [playerHand, table.selectedIds]
  );
  const selectedCombo = useMemo(() => evaluateCards(selectedCards), [selectedCards]);
  const targetCombo = table.lastPlay?.player === 0 ? null : table.lastPlay?.combo ?? null;
  const canPlay = table.currentPlayer === 0 && canBeat(selectedCombo, targetCombo);
  const canPass = table.currentPlayer === 0 && Boolean(table.lastPlay && table.lastPlay.player !== 0);
  const statusCopy = table.winner !== null
    ? table.winner === 0
      ? `牌局胜利，缴获 ${rewardGold.toLocaleString()} 金`
      : `${PLAYER_META[table.winner].name}先走完牌，本局失利`
    : table.currentPlayer === 0
      ? targetCombo
        ? `请大过 ${PLAYER_META[table.lastPlay!.player].name} 的${comboLabel(targetCombo)}`
        : '本轮由你先出牌'
      : `${PLAYER_META[table.currentPlayer].name}思索中`;

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
    setTable((prev) => resolveAiTurns(applyPlay(prev, 0, selectedCards, selectedCombo, `你出牌：${selectedCombo.label} ${formatCards(selectedCards)}`)));
  };

  const pass = () => {
    if (!canPass) return;
    onSfx('audio/sfx/sfx_button.mp3', 0.24);
    setTable((prev) => resolveAiTurns(applyPass(prev, 0, '你选择不要。')));
  };

  const resetSelection = () => {
    setTable((prev) => ({ ...prev, selectedIds: [] }));
  };

  return (
    <main className="screen doudizhu-screen">
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
          <span>{lord.name}坐庄</span>
          <strong>{statusCopy}</strong>
        </div>
        <div>
          <span>地主底牌</span>
          <strong>{formatCards(table.landlordCards)}</strong>
        </div>
      </section>

      <section className="opponent-row" aria-label="对手">
        <OpponentSeat player={1} handCount={table.hands[1].length} recentCards={table.recentMoves[1]} />
        <OpponentSeat player={2} handCount={table.hands[2].length} recentCards={table.recentMoves[2]} />
      </section>

      <section className="card-table" aria-label="牌桌">
        <div className="last-play-panel">
          <span>当前牌型</span>
          <strong>{table.lastPlay ? `${PLAYER_META[table.lastPlay.player].name} · ${table.lastPlay.combo.label}` : '自由出牌'}</strong>
          <p>{table.lastPlay ? formatCards(table.lastPlay.cards) : '无人压牌，任意合法牌型可出。'}</p>
        </div>
        <div className="history-panel">
          {table.history.slice(0, 4).map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      </section>

      <section className="player-hand" aria-label="你的手牌">
        {playerHand.map((card) => (
          <button
            key={card.id}
            type="button"
            className={`poker-card ${card.red ? 'is-red' : ''} ${table.selectedIds.includes(card.id) ? 'is-selected' : ''}`}
            onClick={() => toggleCard(card.id)}
            aria-pressed={table.selectedIds.includes(card.id)}
          >
            <span>{card.suit}</span>
            <strong>{card.rank}</strong>
          </button>
        ))}
      </section>

      <section className="doudizhu-actions">
        {table.winner === null ? (
          <>
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

function OpponentSeat({ player, handCount, recentCards }: { player: PlayerIndex; handCount: number; recentCards: Card[] }) {
  return (
    <article className="opponent-seat">
      <div>
        <strong>{PLAYER_META[player].name}</strong>
        <span>{PLAYER_META[player].role} · {handCount} 张</span>
      </div>
      <p>{recentCards.length > 0 ? formatCards(recentCards) : '静待出牌'}</p>
    </article>
  );
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

function resolveAiTurns(table: TableState): TableState {
  let next = table;
  let guard = 0;

  while (next.currentPlayer !== 0 && next.winner === null && guard < 8) {
    guard += 1;
    const player = next.currentPlayer;
    const target = next.lastPlay && next.lastPlay.player !== player ? next.lastPlay.combo : null;
    const cards = findFirstPlayable(next.hands[player], target);
    const combo = cards ? evaluateCards(cards) : null;

    if (cards && combo && canBeat(combo, target)) {
      next = applyPlay(next, player, cards, combo, `${PLAYER_META[player].name}出牌：${combo.label} ${formatCards(cards)}`);
    } else {
      next = applyPass(next, player, `${PLAYER_META[player].name}不要。`);
    }
  }

  return next;
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
