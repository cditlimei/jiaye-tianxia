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

/** mulberry32：给定种子的可复现随机数（测试复现牌局用） */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 测试开关：localStorage 里 jiaye-ddz-seed=<整数> 时，洗牌与 AI 的随机都走这一条种子流；没设就是 Math.random */
export const DDZ_SEED_KEY = 'jiaye-ddz-seed';
let tableRandom: (() => number) | null | undefined;
function readSeed(): number | null {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(DDZ_SEED_KEY) : null;
    if (raw === null || raw.trim() === '' || !Number.isFinite(Number(raw))) return null;
    return Math.floor(Number(raw));
  } catch {
    return null;
  }
}
/** 牌桌随机源：首次调用时读开关，之后整页共用同一条流（再来一局接着往下发） */
export function ddzRandom(): number {
  if (tableRandom === undefined) {
    const seed = readSeed();
    tableRandom = seed === null ? null : seededRandom(seed);
  }
  return tableRandom ? tableRandom() : Math.random();
}
/** 模拟脚本用：直接换随机源（传 null 回到 Math.random / 开关） */
export function setDdzRandom(rand: (() => number) | null | undefined) {
  tableRandom = rand;
}

export function createDoudizhuDeal(rand: () => number = ddzRandom) {
  const deck = shuffle(createDeck(), rand);
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

export type AiStyle = 'aggressive' | 'cautious' | 'balanced';

export const AI_STYLE_LABEL: Record<AiStyle, string> = { aggressive: '激进', cautious: '稳健', balanced: '均衡' };

// 主公性格决定牌桌上的打法：激进派敢压敢炸，稳健派攒大牌，均衡派中规中矩
export const LORD_AI_STYLE: Record<string, AiStyle> = {
  caocao: 'aggressive', lvbu: 'aggressive', zhangfei: 'aggressive',
  guanyu: 'balanced', zhaoyun: 'balanced', zhouyu: 'balanced',
  liubei: 'cautious', sunquan: 'cautious', simayi: 'cautious', zhugeliang: 'cautious', luxun: 'cautious',
  machao: 'aggressive', sunce: 'aggressive'
};

/** 农民 AI 的牌艺：初级场生手会放水，中级场老手是原有打法，高级场高手会配合、卡单牌与压死地主 */
export type AiSkill = 'novice' | 'veteran' | 'master';

export const AI_SKILL_LABEL: Record<AiSkill, string> = { novice: '生手', veteran: '老手', master: '高手' };

export interface AiContext {
  /** 地主剩余手牌数 */
  landlordCards: number;
  /** 当前要压的牌是否是队友打出的 */
  teammateLeads: boolean;
  /** 队友剩余手牌数（地主没有队友时不传） */
  teammateCards?: number;
  skill?: AiSkill;
  /** 未见牌（地主与队友手牌合集，不知归属）：高手按它推断哪手牌必不被压 */
  unseen?: Card[];
  /** 测试用随机源 */
  rand?: () => number;
}

const isBig = (combo: Combo) => combo.type === 'bomb' || combo.type === 'rocket';

/** 农民 AI 的出牌决策；返回 null 表示不要 */
export function chooseAiPlay(hand: Card[], target: Combo | null, style: AiStyle, ctx: AiContext): Card[] | null {
  const whole = evaluateCards(hand);
  if (whole && canBeat(whole, target)) return hand;

  const playable = findPlayableCombos(hand, target);
  if (playable.length === 0) return null;
  const skill = ctx.skill ?? 'veteran';
  const rand = ctx.rand ?? ddzRandom;
  // 队友只剩一两张、又是队友的牌：一律不要，让队友走完（自己能一手出完已在上面处理）
  if (ctx.teammateLeads && ctx.teammateCards !== undefined && ctx.teammateCards <= 2) return null;

  if (skill === 'novice') return chooseNovicePlay(hand, target, playable, ctx, rand);
  if (skill === 'master') {
    // 两手走完：手里剩「一手必不被压 + 一手任意牌」时，先出必不被压的保住出牌权
    const finisher = ctx.unseen ? findTwoStepFinish(hand, target, playable, ctx.unseen) : null;
    if (finisher) return finisher;
    const masterPlay = chooseMasterPlay(hand, target, playable, ctx);
    if (masterPlay !== undefined) return masterPlay;
  }

  if (ctx.teammateLeads) {
    // 队友出的牌：只用 Q 以下的普通小牌跟，不炸队友；
    // 压下去后剩下的牌一手能出完时才舍得用 K/A（激进派在地主快走完时也会用 2 顶上）
    const limit = style === 'aggressive' && ctx.landlordCards <= 3 ? 15 : 14;
    const normal = playable.filter((cards) => !isBig(evaluateCards(cards)!));
    const follow = normal.find((cards) => evaluateCards(cards)!.value <= 12)
      ?? normal.find((cards) => evaluateCards(cards)!.value <= limit && leavesOneHand(hand, cards));
    return follow ?? null;
  }

  if (!target) {
    if (style === 'aggressive') {
      // 领出时先甩长牌型（顺子/连对/飞机），把节奏打快
      const longest = [...playable].filter((cards) => !isBig(evaluateCards(cards)!)).sort((a, b) => b.length - a.length || (evaluateCards(a)!.value - evaluateCards(b)!.value))[0];
      return longest ?? playable[0];
    }
    return playable[0];
  }

  // 压地主
  const normal = playable.filter((cards) => !isBig(evaluateCards(cards)!));
  const bombs = playable.filter((cards) => isBig(evaluateCards(cards)!));
  const smallest = normal[0] ?? null;
  const smallestValue = smallest ? evaluateCards(smallest)!.value : 99;

  if (style === 'cautious') {
    // 稳健：2 和王留着，除非地主快走完或自己也快走完
    const pressure = ctx.landlordCards <= 4 || hand.length <= 3;
    if (smallest && (smallestValue <= 14 || pressure)) return smallest;
    if (bombs.length > 0 && ctx.landlordCards <= 2) return bombs[0];
    return null;
  }
  if (style === 'aggressive') {
    if (smallest) return smallest;
    // 没普通牌能压：地主手牌不多或对方出的是大牌时就炸
    if (bombs.length > 0 && (ctx.landlordCards <= 6 || target.value >= 13)) return bombs[0];
    return null;
  }
  // 均衡
  if (smallest) return smallest;
  if (bombs.length > 0 && ctx.landlordCards <= 8) return bombs[0];
  return null;
}

/** 打出这手后剩下的牌恰好是一手合法牌型（下一轮能直接走完） */
function leavesOneHand(hand: Card[], cards: Card[]) {
  const played = new Set(cards.map((card) => card.id));
  const rest = hand.filter((card) => !played.has(card.id));
  return rest.length > 0 && evaluateCards(rest) !== null;
}

/** 未见牌里能否出现炸弹（四张同点或双王）：有可能就没有「必不被压」 */
function bombPossible(unseen: Card[]) {
  const counts = new Map<number, number>();
  for (const card of unseen) counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  if ([...counts.values()].some((n) => n >= 4)) return true;
  return unseen.filter((card) => card.value >= 16).length >= 2;
}

/** 单张/对子/三张在未见牌里没有更大的同型，且没人可能有炸弹 */
function isUnbeatable(combo: Combo, unseen: Card[]) {
  if (combo.type === 'rocket') return true;
  if (bombPossible(unseen)) return combo.type === 'bomb' && !unseen.some((card) => card.value >= 16) && !hasHigherBomb(combo.value, unseen);
  const need = combo.type === 'single' ? 1 : combo.type === 'pair' ? 2 : combo.type === 'triple' ? 3 : combo.type === 'bomb' ? 4 : 0;
  if (need === 0) return false;
  const counts = new Map<number, number>();
  for (const card of unseen) counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  return ![...counts.entries()].some(([value, n]) => value > combo.value && n >= need);
}

function hasHigherBomb(value: number, unseen: Card[]) {
  const counts = new Map<number, number>();
  for (const card of unseen) counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  return [...counts.entries()].some(([v, n]) => v > value && n >= 4);
}

/** 先出必不被压的一手，剩下的刚好是一手合法牌型，下一轮直接走完 */
function findTwoStepFinish(hand: Card[], target: Combo | null, playable: Card[][], unseen: Card[]) {
  for (const cards of playable) {
    const combo = evaluateCards(cards);
    if (!combo || !canBeat(combo, target) || !isUnbeatable(combo, unseen)) continue;
    const played = new Set(cards.map((card) => card.id));
    const rest = hand.filter((card) => !played.has(card.id));
    if (rest.length > 0 && evaluateCards(rest)) return cards;
  }
  return null;
}

/** 生手：该压不压、大牌舍不得出、领出只会甩最小的单牌 */
function chooseNovicePlay(hand: Card[], target: Combo | null, playable: Card[][], ctx: AiContext, rand: () => number): Card[] | null {
  const normal = playable.filter((cards) => !isBig(evaluateCards(cards)!));
  if (ctx.teammateLeads) {
    // 队友的牌也会去压，帮倒忙
    const follow = normal.find((cards) => evaluateCards(cards)!.value <= 12);
    return follow && rand() < 0.5 ? follow : null;
  }
  if (!target) return playable[0];
  const smallest = normal[0] ?? null;
  if (!smallest) return ctx.landlordCards <= 2 && playable.length > 0 ? playable[0] : null;
  const value = evaluateCards(smallest)!.value;
  // 要用 A/2/王去压时，大半时候舍不得；地主快走完才肯拼
  if (value >= 14 && ctx.landlordCards > 2 && rand() < 0.7) return null;
  // 普通牌也有三成概率看漏
  if (value >= 10 && ctx.landlordCards > 3 && rand() < 0.3) return null;
  return smallest;
}

/** 高手：地主剩单张就不领单张、剩对子就不领对子；地主快走完时用最大的牌封死；炸弹该出就出。返回 undefined 交回给性格打法 */
function chooseMasterPlay(hand: Card[], target: Combo | null, playable: Card[][], ctx: AiContext): Card[] | null | undefined {
  const normal = playable.filter((cards) => !isBig(evaluateCards(cards)!));
  const bombs = playable.filter((cards) => isBig(evaluateCards(cards)!));
  if (ctx.teammateLeads) {
    // 队友的牌按性格打法跟（实测「队友压住就不接」反而让出牌变慢，地主胜率升 5~10pp）
    return undefined;
  }
  if (!target) {
    // 注意：「地主快走完时领牌先出必不被压的牌」实测让地主胜率反升 5pp，别再加
    if (ctx.landlordCards === 1) {
      const nonSingle = normal.find((cards) => evaluateCards(cards)!.type !== 'single');
      if (nonSingle) return nonSingle;
      // 只剩单张可领：领最大的单张
      const singles = normal.filter((cards) => evaluateCards(cards)!.type === 'single');
      return singles[singles.length - 1] ?? playable[0];
    }
    if (ctx.landlordCards === 2) {
      const nonPair = normal.find((cards) => evaluateCards(cards)!.type !== 'pair' && evaluateCards(cards)!.type !== 'single');
      if (nonPair) return nonPair;
      const pairs = normal.filter((cards) => evaluateCards(cards)!.type === 'pair');
      if (pairs.length > 0) return pairs[pairs.length - 1];
    }
    return undefined;
  }
  // 地主只剩一两张：用能压住的最大的牌封死，不给它接的机会
  if (ctx.landlordCards <= 2 && normal.length > 0) return normal[normal.length - 1];
  if (normal.length === 0 && bombs.length > 0 && (ctx.landlordCards <= 6 || target.value >= 13 || hand.length <= 6)) return bombs[0];
  return undefined;
}

export interface CardSummary {
  bombs: number;
  jokers: number;
  twos: number;
}

/** 一手牌里的炸弹（含王炸）、王、2 的张数 */
export function handSummary(cards: Card[]): CardSummary {
  const counts = new Map<number, number>();
  for (const card of cards) counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  const jokers = (counts.get(16) ?? 0) + (counts.get(17) ?? 0);
  const bombs = [...counts.entries()].filter(([value, n]) => value <= 15 && n === 4).length + (jokers === 2 ? 1 : 0);
  return { bombs, jokers, twos: counts.get(15) ?? 0 };
}

/** 另外两家合起来尚余：54 张减去自己手牌和已出的牌；炸弹按「四张都没现身的点数 + 双王都没现身」算 */
export function unseenSummary(own: Card[], played: Card[]): CardSummary {
  const gone = new Set([...own, ...played].map((card) => card.id));
  return handSummary(createDeck().filter((card) => !gone.has(card.id)));
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

function shuffle(cards: Card[], rand: () => number) {
  const next = [...cards];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rand() * (index + 1));
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
    // 主流规则：翅膀可以是任意单牌，包括炸弹拆出的第四张和与主体同点数的牌，但不能同时带大小王
    const sequenceLength = length / 4;
    const run = findHighestTripletRun(groups, sequenceLength);
    if (run !== null) {
      const runValues = new Set(run);
      const attachments = groups.flatMap((group) => (runValues.has(group.value) ? group.cards.slice(3) : group.cards));
      if (attachments.length === sequenceLength && !hasBothJokers(attachments)) {
        return combo('airplane-one', run[run.length - 1], length);
      }
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

function findHighestTripletRun(groups: ValueGroup[], sequenceLength: number) {
  if (sequenceLength < 2) return null;
  const tripletValues = groups.filter((group) => group.count >= 3 && group.value < 15).map((group) => group.value);
  for (let end = tripletValues.length - 1; end >= sequenceLength - 1; end -= 1) {
    const run = tripletValues.slice(end - sequenceLength + 1, end + 1);
    if (isRun(run)) return run;
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
      const remainingCards = [
        ...groups.filter((group) => !tripletValueSet.has(group.value)).flatMap((group) => group.cards),
        ...groups.filter((group) => tripletValueSet.has(group.value)).flatMap((group) => group.cards.slice(3))
      ];
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
