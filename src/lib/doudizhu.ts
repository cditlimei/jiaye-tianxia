export type PlayerIndex = 0 | 1 | 2;
export type ComboType = 'single' | 'pair' | 'triple' | 'triple-one' | 'triple-pair' | 'straight' | 'pair-straight' | 'bomb' | 'rocket';

export interface Card {
  id: string;
  rank: string;
  suit: string;
  label: string;
  value: number;
  red: boolean;
}

export interface Combo {
  type: ComboType;
  value: number;
  length: number;
  label: string;
}

const RANKS = [
  { rank: '3', value: 3 },
  { rank: '4', value: 4 },
  { rank: '5', value: 5 },
  { rank: '6', value: 6 },
  { rank: '7', value: 7 },
  { rank: '8', value: 8 },
  { rank: '9', value: 9 },
  { rank: '10', value: 10 },
  { rank: 'J', value: 11 },
  { rank: 'Q', value: 12 },
  { rank: 'K', value: 13 },
  { rank: 'A', value: 14 },
  { rank: '2', value: 15 }
];

const SUITS = [
  { suit: 'spade', label: '♠', red: false },
  { suit: 'heart', label: '♥', red: true },
  { suit: 'club', label: '♣', red: false },
  { suit: 'diamond', label: '♦', red: true }
];

const COMBO_LABELS: Record<ComboType, string> = {
  single: '单张',
  pair: '对子',
  triple: '三张',
  'triple-one': '三带一',
  'triple-pair': '三带二',
  straight: '顺子',
  'pair-straight': '连对',
  bomb: '炸弹',
  rocket: '王炸'
};

export function createDoudizhuDeal() {
  const deck = shuffle(createDeck());
  const landlordCards = deck.slice(51);
  const hands: Record<PlayerIndex, Card[]> = {
    0: sortCards([...deck.slice(0, 17), ...landlordCards]),
    1: sortCards(deck.slice(17, 34)),
    2: sortCards(deck.slice(34, 51))
  };

  return {
    hands,
    landlordCards: sortCards(landlordCards)
  };
}

export function sortCards(cards: Card[]) {
  return [...cards].sort((left, right) => left.value - right.value || left.suit.localeCompare(right.suit));
}

export function evaluateCards(cards: Card[]): Combo | null {
  if (cards.length === 0) return null;

  const sorted = sortCards(cards);
  const counts = countByValue(sorted);
  const groups = [...counts.entries()].sort((left, right) => left[0] - right[0]);
  const values = groups.map(([value]) => value);
  const countValues = groups.map(([, count]) => count).sort((left, right) => right - left);

  if (sorted.length === 1) return combo('single', sorted[0].value, sorted.length);
  if (sorted.length === 2 && values.includes(16) && values.includes(17)) return combo('rocket', 17, sorted.length);
  if (sorted.length === 2 && countValues[0] === 2) return combo('pair', values[0], sorted.length);
  if (sorted.length === 3 && countValues[0] === 3) return combo('triple', values[0], sorted.length);
  if (sorted.length === 4 && countValues[0] === 4) return combo('bomb', values[0], sorted.length);
  if (sorted.length === 4 && countValues[0] === 3) return combo('triple-one', valueWithCount(groups, 3), sorted.length);
  if (sorted.length === 5 && countValues[0] === 3 && countValues[1] === 2) return combo('triple-pair', valueWithCount(groups, 3), sorted.length);

  if (sorted.length >= 5 && groups.every(([, count]) => count === 1) && isConsecutive(values) && values.every((value) => value < 15)) {
    return combo('straight', values[values.length - 1], sorted.length);
  }

  if (
    sorted.length >= 6 &&
    sorted.length % 2 === 0 &&
    groups.every(([, count]) => count === 2) &&
    isConsecutive(values) &&
    values.every((value) => value < 15)
  ) {
    return combo('pair-straight', values[values.length - 1], sorted.length);
  }

  return null;
}

export function canBeat(candidate: Combo | null, target: Combo | null) {
  if (!candidate) return false;
  if (!target) return true;
  if (candidate.type === 'rocket') return true;
  if (target.type === 'rocket') return false;
  if (candidate.type === 'bomb' && target.type !== 'bomb') return true;
  if (target.type === 'bomb' && candidate.type !== 'bomb') return false;
  return candidate.type === target.type && candidate.length === target.length && candidate.value > target.value;
}

export function findFirstPlayable(hand: Card[], target: Combo | null) {
  const sorted = sortCards(hand);
  if (!target) {
    return [sorted[0]];
  }

  const candidate = findMatchingCombo(sorted, target) ?? findBomb(sorted, target.type === 'bomb' ? target.value : -1) ?? findRocket(sorted);
  return candidate ?? null;
}

export function formatCards(cards: Card[]) {
  return sortCards(cards).map((card) => card.label).join(' ');
}

export function comboLabel(comboItem: Combo | null) {
  return comboItem ? COMBO_LABELS[comboItem.type] : '自由出牌';
}

function createDeck() {
  const cards: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      cards.push({
        id: `${suit.suit}-${rank.rank}`,
        rank: rank.rank,
        suit: suit.label,
        label: `${suit.label}${rank.rank}`,
        value: rank.value,
        red: suit.red
      });
    }
  }

  cards.push({ id: 'joker-small', rank: '小王', suit: '', label: '小王', value: 16, red: false });
  cards.push({ id: 'joker-big', rank: '大王', suit: '', label: '大王', value: 17, red: true });
  return cards;
}

function shuffle(cards: Card[]) {
  const next = [...cards];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function combo(type: ComboType, value: number, length: number): Combo {
  return {
    type,
    value,
    length,
    label: COMBO_LABELS[type]
  };
}

function countByValue(cards: Card[]) {
  const counts = new Map<number, number>();
  for (const card of cards) {
    counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  }
  return counts;
}

function valueWithCount(groups: Array<[number, number]>, count: number) {
  return groups.find(([, itemCount]) => itemCount === count)?.[0] ?? groups[0][0];
}

function isConsecutive(values: number[]) {
  return values.every((value, index) => index === 0 || value === values[index - 1] + 1);
}

function findMatchingCombo(hand: Card[], target: Combo) {
  switch (target.type) {
    case 'single':
      return hand.find((card) => card.value > target.value) ? [hand.find((card) => card.value > target.value)!] : null;
    case 'pair':
      return cardsOfSameValue(hand, 2, target.value);
    case 'triple':
      return cardsOfSameValue(hand, 3, target.value);
    case 'triple-one':
      return findTripleWithKicker(hand, target.value, false);
    case 'triple-pair':
      return findTripleWithKicker(hand, target.value, true);
    case 'straight':
      return findStraight(hand, target.length, target.value);
    case 'pair-straight':
      return findPairStraight(hand, target.length, target.value);
    case 'bomb':
      return findBomb(hand, target.value);
    case 'rocket':
      return null;
  }
}

function cardsOfSameValue(hand: Card[], count: number, minValue: number) {
  const values = [...countByValue(hand).entries()]
    .filter(([value, itemCount]) => value > minValue && itemCount >= count)
    .map(([value]) => value)
    .sort((left, right) => left - right);
  const value = values[0];
  return value ? hand.filter((card) => card.value === value).slice(0, count) : null;
}

function findTripleWithKicker(hand: Card[], minValue: number, pairKicker: boolean) {
  const triple = cardsOfSameValue(hand, 3, minValue);
  if (!triple) return null;
  const rest = hand.filter((card) => card.value !== triple[0].value);
  const kicker = pairKicker ? cardsOfSameValue(rest, 2, -1) : rest.slice(0, 1);
  return kicker && kicker.length > 0 ? [...triple, ...kicker] : null;
}

function findStraight(hand: Card[], length: number, minHighValue: number) {
  const uniqueValues = [...new Set(hand.map((card) => card.value).filter((value) => value < 15))].sort((left, right) => left - right);
  for (let index = 0; index <= uniqueValues.length - length; index += 1) {
    const values = uniqueValues.slice(index, index + length);
    if (values[values.length - 1] > minHighValue && isConsecutive(values)) {
      return values.map((value) => hand.find((card) => card.value === value)!);
    }
  }
  return null;
}

function findPairStraight(hand: Card[], length: number, minHighValue: number) {
  const pairLength = length / 2;
  const pairValues = [...countByValue(hand).entries()]
    .filter(([value, count]) => value < 15 && count >= 2)
    .map(([value]) => value)
    .sort((left, right) => left - right);

  for (let index = 0; index <= pairValues.length - pairLength; index += 1) {
    const values = pairValues.slice(index, index + pairLength);
    if (values[values.length - 1] > minHighValue && isConsecutive(values)) {
      return values.flatMap((value) => hand.filter((card) => card.value === value).slice(0, 2));
    }
  }
  return null;
}

function findBomb(hand: Card[], minValue: number) {
  return cardsOfSameValue(hand, 4, minValue);
}

function findRocket(hand: Card[]) {
  const rocket = [hand.find((card) => card.value === 16), hand.find((card) => card.value === 17)];
  return rocket.every(Boolean) ? (rocket as Card[]) : null;
}
