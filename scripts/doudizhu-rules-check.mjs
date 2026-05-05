import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const source = readFileSync('src/lib/doudizhu.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const modulePath = path.join(tmpdir(), `jiaye-doudizhu-${Date.now()}.mjs`);
writeFileSync(modulePath, compiled);

const { canBeat, evaluateCards, findPlayableCombos } = await import(pathToFileURL(modulePath).href);

const suitByIndex = ['♠', '♥', '♣', '♦'];
const redSuits = new Set(['♥', '♦']);
const rankByValue = new Map([
  [3, '3'],
  [4, '4'],
  [5, '5'],
  [6, '6'],
  [7, '7'],
  [8, '8'],
  [9, '9'],
  [10, '10'],
  [11, 'J'],
  [12, 'Q'],
  [13, 'K'],
  [14, 'A'],
  [15, '2'],
  [16, '小王'],
  [17, '大王']
]);

function cards(values) {
  const seen = new Map();
  return values.map((value) => {
    const count = seen.get(value) ?? 0;
    seen.set(value, count + 1);
    const rank = rankByValue.get(value);
    const suit = value >= 16 ? '' : suitByIndex[count % suitByIndex.length];
    return {
      id: `${value}-${count}`,
      rank,
      suit,
      label: `${suit}${rank}`,
      value,
      red: value === 17 || redSuits.has(suit)
    };
  });
}

function typeOf(values) {
  return evaluateCards(cards(values))?.type ?? null;
}

function comboOf(values) {
  const combo = evaluateCards(cards(values));
  if (!combo) throw new Error(`missing_combo ${values.join(',')}`);
  return combo;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, label) {
  if (!value) throw new Error(label);
}

assertEqual(typeOf([3]), 'single', 'single');
assertEqual(typeOf([3, 3]), 'pair', 'pair');
assertEqual(typeOf([3, 3, 3]), 'triple', 'triple');
assertEqual(typeOf([3, 3, 3, 4]), 'triple-one', 'triple-one');
assertEqual(typeOf([3, 3, 3, 4, 4]), 'triple-pair', 'triple-pair');
assertEqual(typeOf([3, 4, 5, 6, 7]), 'straight', 'straight');
assertEqual(typeOf([11, 12, 13, 14, 15]), null, 'straight_excludes_2');
assertEqual(typeOf([3, 3, 4, 4, 5, 5]), 'pair-straight', 'pair-straight');
assertEqual(typeOf([3, 3, 3, 4, 4, 4]), 'airplane', 'airplane');
assertEqual(typeOf([3, 3, 3, 4, 4, 4, 5, 6]), 'airplane-one', 'airplane-one');
assertEqual(typeOf([3, 3, 3, 4, 4, 4, 5, 5, 6, 6]), 'airplane-pair', 'airplane-pair');
assertEqual(typeOf([3, 3, 3, 3, 4, 5]), 'quad-single', 'quad-single');
assertEqual(typeOf([3, 3, 3, 3, 4, 4]), null, 'quad-single_requires_distinct_kickers');
assertEqual(typeOf([3, 3, 3, 3, 4, 4, 5, 5]), 'quad-pair', 'quad-pair');
assertEqual(typeOf([3, 3, 3, 3]), 'bomb', 'bomb');
assertEqual(typeOf([16, 17]), 'rocket', 'rocket');

assertTrue(canBeat(comboOf([6, 6]), comboOf([5, 5])), 'pair_can_beat_pair');
assertTrue(!canBeat(comboOf([6, 6]), comboOf([5])), 'pair_cannot_beat_single');
assertTrue(canBeat(comboOf([3, 3, 3, 3]), comboOf([10, 11, 12, 13, 14])), 'bomb_beats_straight');
assertTrue(canBeat(comboOf([16, 17]), comboOf([15, 15, 15, 15])), 'rocket_beats_bomb');
assertTrue(!canBeat(comboOf([16, 17]), comboOf([16, 17])), 'rocket_cannot_beat_rocket');

const pairTarget = comboOf([5, 5]);
const pairHint = findPlayableCombos(cards([3, 3, 6, 6, 9]), pairTarget)[0];
assertEqual(evaluateCards(pairHint)?.type, 'pair', 'pair_hint_type');
assertEqual(evaluateCards(pairHint)?.value, 6, 'pair_hint_value');

const leadHint = findPlayableCombos(cards([3, 4, 5, 6, 7, 9, 10]), null)[0];
assertEqual(evaluateCards(leadHint)?.type, 'straight', 'lead_hint_prefers_combo');

console.log('doudizhu_rules_ok');
