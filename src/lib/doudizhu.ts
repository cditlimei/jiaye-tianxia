export type PlayerIndex = 0 | 1 | 2;
export type ComboType =
  | 'single'
  | 'pair'
  | 'triple'
  | 'triple-one'
  | 'triple-pair'
  | 'straight'
  | 'pair-straight'
  | 'airplane'
  | 'airplane-one'
  | 'airplane-pair'
  | 'quad-single'
  | 'quad-pair'
  | 'bomb'
  | 'rocket';

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

interface ValueGroup {
  value: number;
  cards: Card[];
  count: number;
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
  airplane: '飞机',
  'airplane-one': '飞机带单',
  'airplane-pair': '飞机带对',
  'quad-single': '四带二',
  'quad-pair': '四带两对',
  bomb: '炸弹',
  rocket: '王炸'
};

const LEAD_COMBO_PRIORITY: Record<ComboType, number> = {
  straight: 0,
  'pair-straight': 1,
  airplane: 2,
  'airplane-one': 3,
  'airplane-pair': 4,
  'triple-pair': 5,
  'triple-one': 6,
  triple: 7,
  pair: 8,
  single: 9,
  'quad-single': 10,
  'quad-pair': 11,
  bomb: 12,
  rocket: 13
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

export function sortCardsDescending(cards: Card[]) {
  return [...cards].sort((left, right) => right.value - left.value || left.suit.localeCompare(right.suit));
}

export function evaluateCards(cards: Card[]): Combo | null {
  if (cards.length === 0) return null;

  const sorted = sortCards(cards);
  const groups = groupCards(sorted);
  const values = groups.map((group) => group.value);
  const counts = groups.map((group) => group.count).sort((left, right) => right - left);
  const length = sorted.length;

  if (length === 1) return combo('single', sorted[0].value, length);
  if (length === 2 && values.includes(16) && values.includes(17)) return combo('rocket', 17, length);
  if (length === 2 && counts[0] === 2) return combo('pair', values[0], length);
  if (length === 3 && counts[0] === 3) return combo('triple', values[0], length);
  if (length === 4 && counts[0] === 4) return combo('bomb', values[0], length);
  if (length === 4 && counts[0] === 3) return combo('triple-one', valueWithCount(groups, 3), length);
  if (length === 5 && counts[0] === 3 && counts[1] === 2) return combo('triple-pair', valueWithCount(groups, 3), length);

  const straight = evaluateStraight(groups, length);
  if (straight) return straight;

  const pairStraight = evaluatePairStraight(groups, length);
  if (pairStraight) return pairStraight;

  const airplane = evaluateAirplane(groups, length);
  if (airplane) return airplane;

  const quadplex = evaluateQuadplex(groups, length);
  if (quadplex) return quadplex;

  return null;
}

export function canBeat(candidate: Combo | null, target: Combo | null) {
  if (!candidate) return false;
  if (!target) return true;
  if (candidate.type === 'rocket' && target.type === 'rocket') return false;
  if (candidate.type === 'rocket') return true;
  if (target.type === 'rocket') return false;
  if (candidate.type === 'bomb' && target.type !== 'bomb') return true;
  if (target.type === 'bomb' && candidate.type !== 'bomb') return false;
  return candidate.type === target.type && candidate.length === target.length && candidate.value > target.value;
}

export function findPlayableCombos(hand: Card[], target: Combo | null) {
  const candidates = dedupeCandidateCards(collectCandidateCombos(sortCards(hand)));
  const playable = candidates.filter((cards) => canBeat(evaluateCards(cards), target));
  return playable.sort((left, right) => compareCandidates(left, right, target));
}

export function findFirstPlayable(hand: Card[], target: Combo | null) {
  return findPlayableCombos(hand, target)[0] ?? null;
}

export function formatCards(cards: Card[]) {
  return sortCardsDescending(cards).map((card) => card.label).join(' ');
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

function groupCards(cards: Card[]) {
  const groups = new Map<number, Card[]>();
  for (const card of cards) {
    groups.set(card.value, [...(groups.get(card.value) ?? []), card]);
  }
  return [...groups.entries()]
    .map(([value, groupCardsByValue]) => ({
      value,
      cards: sortCards(groupCardsByValue),
      count: groupCardsByValue.length
    }))
    .sort((left, right) => left.value - right.value);
}

function valueWithCount(groups: ValueGroup[], count: number) {
  return groups.find((group) => group.count === count)?.value ?? groups[0].value;
}

function evaluateStraight(groups: ValueGroup[], length: number) {
  if (length < 5) return null;
  if (!groups.every((group) => group.count === 1)) return null;
  if (!isRun(groups.map((group) => group.value))) return null;
  if (groups.some((group) => group.value >= 15)) return null;
  return combo('straight', groups[groups.length - 1].value, length);
}

function evaluatePairStraight(groups: ValueGroup[], length: number) {
  if (length < 6 || length % 2 !== 0) return null;
  if (!groups.every((group) => group.count === 2)) return null;
  if (!isRun(groups.map((group) => group.value))) return null;
  if (groups.some((group) => group.value >= 15)) return null;
  return combo('pair-straight', groups[groups.length - 1].value, length);
}

function evaluateAirplane(groups: ValueGroup[], length: number) {
  if (length >= 6 && length % 3 === 0 && groups.every((group) => group.count === 3)) {
    const tripletValues = groups.map((group) => group.value);
    if (tripletValues.length >= 2 && isRun(tripletValues) && tripletValues.every((value) => value < 15)) {
      return combo('airplane', tripletValues[tripletValues.length - 1], length);
    }
  }

  if (length >= 8 && length % 4 === 0) {
    const sequenceLength = length / 4;
    const triplets = groups.filter((group) => group.count === 3);
    const attachments = groups.filter((group) => group.count !== 3).flatMap((group) => group.cards);
    const tripletValues = triplets.map((group) => group.value);
    if (
      sequenceLength >= 2 &&
      triplets.length === sequenceLength &&
      attachments.length === sequenceLength &&
      isRun(tripletValues) &&
      tripletValues.every((value) => value < 15) &&
      !hasBothJokers(attachments)
    ) {
      return combo('airplane-one', tripletValues[tripletValues.length - 1], length);
    }
  }

  if (length >= 10 && length % 5 === 0) {
    const sequenceLength = length / 5;
    const triplets = groups.filter((group) => group.count === 3);
    const pairs = groups.filter((group) => group.count === 2);
    const tripletValues = triplets.map((group) => group.value);
    if (
      sequenceLength >= 2 &&
      triplets.length === sequenceLength &&
      pairs.length === sequenceLength &&
      groups.length === triplets.length + pairs.length &&
      isRun(tripletValues) &&
      tripletValues.every((value) => value < 15)
    ) {
      return combo('airplane-pair', tripletValues[tripletValues.length - 1], length);
    }
  }

  return null;
}

function evaluateQuadplex(groups: ValueGroup[], length: number) {
  const quad = groups.find((group) => group.count === 4);
  if (!quad) return null;

  const attachments = groups.filter((group) => group.value !== quad.value);
  const attachmentCards = attachments.flatMap((group) => group.cards);
  if (length === 6 && attachments.length === 2 && attachments.every((group) => group.count === 1) && !hasBothJokers(attachmentCards)) {
    return combo('quad-single', quad.value, length);
  }

  if (length === 8 && attachments.length === 2 && attachments.every((group) => group.count === 2)) {
    return combo('quad-pair', quad.value, length);
  }

  return null;
}

function isRun(values: number[]) {
  return values.length > 0 && values.every((value, index) => index === 0 || value === values[index - 1] + 1);
}

function hasBothJokers(cards: Card[]) {
  return cards.some((card) => card.value === 16) && cards.some((card) => card.value === 17);
}

function collectCandidateCombos(hand: Card[]) {
  const groups = groupCards(hand);
  const candidates: Card[][] = [];
  const push = (cards: Card[]) => {
    if (evaluateCards(cards)) candidates.push(sortCards(cards));
  };

  for (const card of hand) push([card]);
  for (const group of groups) {
    if (group.count >= 2 && group.value < 16) push(group.cards.slice(0, 2));
    if (group.count >= 3) push(group.cards.slice(0, 3));
    if (group.count === 4) push(group.cards);
  }

  const rocket = findRocket(hand);
  if (rocket) push(rocket);

  addTripleCombos(groups, push);
  addStraightCombos(groups, push);
  addAirplaneCombos(groups, push);
  addQuadplexCombos(groups, push);

  return candidates;
}

function addTripleCombos(groups: ValueGroup[], push: (cards: Card[]) => void) {
  const triples = groups.filter((group) => group.count >= 3);
  for (const triple of triples) {
    const tripleCards = triple.cards.slice(0, 3);
    const singles = groups.filter((group) => group.value !== triple.value).flatMap((group) => group.cards);
    const pairs = groups.filter((group) => group.value !== triple.value && group.count >= 2 && group.value < 16);

    for (const single of singles) push([...tripleCards, single]);
    for (const pair of pairs) push([...tripleCards, ...pair.cards.slice(0, 2)]);
  }
}

function addStraightCombos(groups: ValueGroup[], push: (cards: Card[]) => void) {
  const singleValues = groups.filter((group) => group.value < 15).map((group) => group.value);
  for (const run of valueRuns(singleValues, 5)) {
    for (const values of runSlices(run, 5)) {
      push(values.map((value) => cardOfValue(groups, value, 1)).flat());
    }
  }

  const pairValues = groups.filter((group) => group.value < 15 && group.count >= 2).map((group) => group.value);
  for (const run of valueRuns(pairValues, 3)) {
    for (const values of runSlices(run, 3)) {
      push(values.map((value) => cardOfValue(groups, value, 2)).flat());
    }
  }
}

function addAirplaneCombos(groups: ValueGroup[], push: (cards: Card[]) => void) {
  const tripletValues = groups.filter((group) => group.value < 15 && group.count >= 3).map((group) => group.value);
  for (const run of valueRuns(tripletValues, 2)) {
    for (const values of runSlices(run, 2)) {
      const tripletCards = values.map((value) => cardOfValue(groups, value, 3)).flat();
      const tripletValueSet = new Set(values);
      const remainingCards = groups.filter((group) => !tripletValueSet.has(group.value)).flatMap((group) => group.cards);
      const pairGroups = groups.filter((group) => !tripletValueSet.has(group.value) && group.count >= 2 && group.value < 16);

      push(tripletCards);
      for (const attachments of combinations(remainingCards, values.length, 8).filter((cards) => !hasBothJokers(cards))) {
        push([...tripletCards, ...attachments]);
      }
      for (const pairs of combinations(pairGroups, values.length, 8)) {
        push([...tripletCards, ...pairs.flatMap((group) => group.cards.slice(0, 2))]);
      }
    }
  }
}

function addQuadplexCombos(groups: ValueGroup[], push: (cards: Card[]) => void) {
  const quads = groups.filter((group) => group.count === 4);
  for (const quad of quads) {
    const remainingCards = groups.filter((group) => group.value !== quad.value).flatMap((group) => group.cards);
    const pairGroups = groups.filter((group) => group.value !== quad.value && group.count >= 2 && group.value < 16);

    for (const attachments of combinations(remainingCards, 2, 8).filter((cards) => !hasBothJokers(cards))) {
      push([...quad.cards, ...attachments]);
    }
    for (const pairs of combinations(pairGroups, 2, 8)) {
      push([...quad.cards, ...pairs.flatMap((group) => group.cards.slice(0, 2))]);
    }
  }
}

function valueRuns(values: number[], minLength: number) {
  const runs: number[][] = [];
  let current: number[] = [];
  for (const value of values) {
    if (current.length === 0 || value === current[current.length - 1] + 1) {
      current.push(value);
    } else {
      if (current.length >= minLength) runs.push(current);
      current = [value];
    }
  }
  if (current.length >= minLength) runs.push(current);
  return runs;
}

function runSlices(run: number[], minLength: number) {
  const slices: number[][] = [];
  for (let start = 0; start < run.length; start += 1) {
    for (let end = start + minLength; end <= run.length; end += 1) {
      slices.push(run.slice(start, end));
    }
  }
  return slices;
}

function cardOfValue(groups: ValueGroup[], value: number, count: number) {
  return groups.find((group) => group.value === value)?.cards.slice(0, count) ?? [];
}

function combinations<T>(items: T[], count: number, limit = Number.POSITIVE_INFINITY) {
  const result: T[][] = [];
  const walk = (start: number, picked: T[]) => {
    if (result.length >= limit) return;
    if (picked.length === count) {
      result.push(picked);
      return;
    }
    for (let index = start; index <= items.length - (count - picked.length); index += 1) {
      walk(index + 1, [...picked, items[index]]);
    }
  };
  walk(0, []);
  return result;
}

function findRocket(hand: Card[]) {
  const rocket = [hand.find((card) => card.value === 16), hand.find((card) => card.value === 17)];
  return rocket.every(Boolean) ? (rocket as Card[]) : null;
}

function dedupeCandidateCards(candidates: Card[][]) {
  const seen = new Set<string>();
  return candidates.filter((cards) => {
    const key = cards.map((card) => card.id).sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareCandidates(left: Card[], right: Card[], target: Combo | null) {
  const leftCombo = evaluateCards(left);
  const rightCombo = evaluateCards(right);
  if (!leftCombo || !rightCombo) return 0;

  const priorityDiff = comboPriority(leftCombo, target) - comboPriority(rightCombo, target);
  if (priorityDiff !== 0) return priorityDiff;
  if (leftCombo.length !== rightCombo.length) return leftCombo.length - rightCombo.length;
  if (leftCombo.value !== rightCombo.value) return leftCombo.value - rightCombo.value;
  return highestCard(left) - highestCard(right);
}

function comboPriority(comboItem: Combo, target: Combo | null) {
  if (!target) return LEAD_COMBO_PRIORITY[comboItem.type];
  if (comboItem.type === 'rocket') return target.type === 'rocket' ? 0 : 12;
  if (comboItem.type === 'bomb') return target.type === 'bomb' ? 0 : 11;
  return 0;
}

function highestCard(cards: Card[]) {
  return Math.max(...cards.map((card) => card.value));
}
