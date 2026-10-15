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

const { canBeat, evaluateCards, findPlayableCombos, chooseAiPlay } = await import(pathToFileURL(modulePath).href);

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
assertEqual(typeOf([3, 3, 3, 4, 4, 4, 4, 5]), 'airplane-one', 'airplane-one wing from bomb');
assertEqual(typeOf([4, 4, 4, 4, 5, 5, 5, 6]), 'airplane-one', 'airplane-one wing from bomb low');
assertEqual(typeOf([3, 3, 3, 4, 4, 4, 5, 5, 5, 9, 9, 9]), 'airplane-one', 'airplane-one same-rank wings');
assertEqual(typeOf([3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6]), 'airplane', 'four-triplet airplane stays plain');
assertEqual(comboOf([3, 3, 3, 4, 4, 4, 5, 5, 5, 9, 9, 9]).value, 5, 'airplane-one same-rank wings value');
const bombWingHint = findPlayableCombos(cards([3, 3, 3, 4, 4, 4, 4, 5]), null)
  .map((hint) => evaluateCards(hint)?.type);
assertTrue(bombWingHint.includes('airplane-one'), 'airplane-one hint with bomb wing');
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

// AI 性格：地主出单 K，手里只有 2 能压
const bigOnly = cards([3, 3, 4, 5, 6, 15]);
const kingTarget = comboOf([13]);
assertEqual(chooseAiPlay(bigOnly, kingTarget, 'cautious', { landlordCards: 12, teammateLeads: false }), null, 'cautious keeps the 2 while landlord has many cards');
assertTrue(chooseAiPlay(bigOnly, kingTarget, 'cautious', { landlordCards: 3, teammateLeads: false }) !== null, 'cautious spends the 2 under pressure');
assertTrue(chooseAiPlay(bigOnly, kingTarget, 'aggressive', { landlordCards: 12, teammateLeads: false }) !== null, 'aggressive beats with the 2 right away');
// 只有炸弹能压：激进在地主剩 6 张内炸，均衡 8 张内，稳健 2 张内
const bombOnly = cards([3, 3, 3, 3, 4, 5]);
const twoTarget = comboOf([15]);
assertTrue(chooseAiPlay(bombOnly, twoTarget, 'aggressive', { landlordCards: 6, teammateLeads: false }) !== null, 'aggressive bombs at 6');
assertEqual(chooseAiPlay(bombOnly, twoTarget, 'cautious', { landlordCards: 6, teammateLeads: false }), null, 'cautious holds bomb at 6');
assertTrue(chooseAiPlay(bombOnly, twoTarget, 'cautious', { landlordCards: 2, teammateLeads: false }) !== null, 'cautious bombs at 2');
// 队友领出：谁都不炸队友
assertEqual(chooseAiPlay(bombOnly, twoTarget, 'aggressive', { landlordCards: 2, teammateLeads: true }), null, 'nobody bombs a teammate');
// 队友出单 5：只有 A 能跟时不顶队友；Q 以下照跟；队友只剩一两张一律不要；顶完能一手走完才用 A
const fiveTarget = comboOf([5]);
assertEqual(chooseAiPlay(cards([3, 3, 4, 14]), fiveTarget, 'balanced', { landlordCards: 12, teammateLeads: true, teammateCards: 8 }), null, 'no ace over a teammate');
assertEqual(evaluateCards(chooseAiPlay(cards([3, 4, 12, 14]), fiveTarget, 'balanced', { landlordCards: 12, teammateLeads: true, teammateCards: 8 }))?.value, 12, 'follows teammate with Q');
assertEqual(chooseAiPlay(cards([3, 4, 12, 14]), fiveTarget, 'balanced', { landlordCards: 12, teammateLeads: true, teammateCards: 2 }), null, 'never covers a teammate with two cards left');
assertEqual(evaluateCards(chooseAiPlay(cards([14, 4, 4]), fiveTarget, 'balanced', { landlordCards: 12, teammateLeads: true, teammateCards: 8 }))?.value, 14, 'ace over teammate only when it finishes next turn');
// 激进领出先甩长牌
const leadHand = cards([3, 4, 5, 6, 7, 9, 9, 12]);
assertEqual(chooseAiPlay(leadHand, null, 'aggressive', { landlordCards: 17, teammateLeads: false }).length, 5, 'aggressive leads the straight');
assertTrue(chooseAiPlay(leadHand, null, 'cautious', { landlordCards: 17, teammateLeads: false }) !== null, 'cautious still leads something');

// ===== v2.2 邻郡反攻：只打末端郡（丢它不连带丢别的郡）。改 fiefs.ts 相邻关系时必须跑这里 =====
{
  const { mkdtempSync, mkdirSync, readdirSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'jiaye-siege-'));
  mkdirSync(path.join(dir, 'data'));
  mkdirSync(path.join(dir, 'lib'));
  const names = ['types', ...['data', 'lib'].flatMap((d) => readdirSync(path.join('src', d)).filter((n) => n.endsWith('.ts')).map((n) => `${d}/${n.slice(0, -3)}`))];
  for (const name of names) {
    const out = ts.transpileModule(readFileSync(`src/${name}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from '(\.\.?\/[^']+)'/g, "from '$1.mjs'");
    writeFileSync(path.join(dir, `${name}.mjs`), out);
  }
  const sg = await import(pathToFileURL(path.join(dir, 'lib/siege.mjs')).href);
  const ff = await import(pathToFileURL(path.join(dir, 'data/fiefs.mjs')).href);
  const ids = (list) => list.map((f) => f.id).sort().join(',');
  const all = { nanyang: 'farming', runan: 'farming', yingchuan: 'farming', changsha: 'farming', bajun: 'farming', liaodong: 'farming' };
  assertEqual(ids(sg.exposedFiefs(all)), 'bajun,liaodong,runan', 'six fiefs: only runan/bajun/liaodong are exposed');
  assertEqual(ids(sg.exposedFiefs({ nanyang: 'farming' })), 'nanyang', 'single fief is exposed');
  assertEqual(ids(sg.exposedFiefs({ nanyang: 'farming', yingchuan: 'farming', runan: 'farming' })), 'runan,yingchuan', 'nanyang hub not exposed while it links others');
  assertEqual(ids(sg.exposedFiefs({ nanyang: 'farming', changsha: 'farming' })), 'changsha,nanyang', 'two home neighbours both exposed');
  assertEqual(ids(sg.exposedFiefs({})), '', 'no fiefs, nothing exposed');
  // 任意一种连通持有：拿掉任一末端郡后剩下的仍全部连通
  const catalog = ff.fiefs.map((f) => f.id);
  for (let mask = 1; mask < 1 << catalog.length; mask += 1) {
    const holding = Object.fromEntries(catalog.filter((_id, i) => mask & (1 << i)).map((id) => [id, 'farming']));
    if (Object.keys(ff.connectedHoldings(holding)).length !== Object.keys(holding).length) continue;
    for (const fief of sg.exposedFiefs(holding)) {
      const rest = { ...holding };
      delete rest[fief.id];
      assertEqual(Object.keys(ff.connectedHoldings(rest)).length, Object.keys(rest).length, `losing ${fief.id} from ${Object.keys(holding).join('+')} keeps the rest connected`);
    }
    assertTrue(sg.exposedFiefs(holding).length > 0, `connected holding ${Object.keys(holding).join('+')} always has an exposed fief`);
  }
  // 选郡：保护期内不选；城防低优先；同城防选得郡晚的
  const now = 1_000_000_000_000;
  const old = now - sg.FIEF_PROTECT_MS - 1;
  const base = { fiefs: all, fiefWalls: {}, fiefTakenAt: Object.fromEntries(catalog.map((id) => [id, old - 100])) };
  assertEqual(sg.pickSiegeTarget({ ...base, fiefTakenAt: { ...base.fiefTakenAt, liaodong: old } }, now)?.id, 'liaodong', 'later-taken exposed fief first');
  assertEqual(sg.pickSiegeTarget({ ...base, fiefWalls: { bajun: 1 } }, now)?.id, 'bajun', 'lower walls first');
  assertEqual(sg.pickSiegeTarget({ ...base, fiefTakenAt: { ...base.fiefTakenAt, runan: now - 1000, bajun: now - 1000, liaodong: now - 1000 } }, now), null, 'all exposed fiefs protected → none');
  assertEqual(sg.pickSiegeTarget({ ...base, fiefTakenAt: { ...base.fiefTakenAt, runan: now - 1000, bajun: now - 1000, liaodong: now - 1000 } }, now, { ignoreProtect: true })?.id !== undefined, true, 'siege-now ignores protection');
  assertEqual(sg.pickSiegeTarget(base, now, { target: 'nanyang' })?.id !== 'nanyang', true, 'forced target must still be exposed');
  // 牌艺降档：高手→老手→生手，整军再降一档
  const find = (id) => ff.fiefs.find((f) => f.id === id);
  assertEqual(sg.siegeSkill(find('liaodong'), 'farming'), 'veteran', 'master attacker drops to veteran');
  assertEqual(sg.siegeSkill(find('liaodong'), 'military'), 'novice', 'military fief drops one more');
  assertEqual(sg.siegeSkill(find('nanyang'), 'military'), 'novice', 'novice stays novice');
  // 逾期最低扣到 1；守城局进行中不判逾期
  const siege = { fiefId: 'runan', attacker: '袁术', skill: 'novice', startedAt: now - 2, dueAt: now - 1 };
  const st = { siege, nextSiegeAt: 0, fiefWalls: { runan: 1 }, fiefTakenAt: {}, lostFiefs: {}, peakFiefs: 2, fiefs: { nanyang: 'farming', runan: 'farming' }, homeLevel: 5, legacyPoints: 0, activeBattle: null, day: 9 };
  const exp = sg.expireSiege(st, now);
  assertEqual(`${exp.siege}|${exp.fiefWalls.runan}|${exp.nextSiegeAt - now}`, `null|1|${sg.SIEGE_INTERVAL_MS}`, 'expiry keeps at least 1 wall');
  assertEqual(sg.expireSiege({ ...st, activeBattle: { mode: 'land', lossGold: 0, conquest: { fiefId: 'runan', policyId: 'farming', stake: 0, kind: 'defend' } } }, now).siege, siege, 'no expiry while defending');
  // 天下归心后不起反攻
  const ending = { ...st, siege: null, fiefWalls: {}, nextSiegeAt: now - 1, fiefs: all, homeLevel: 6, legacyPoints: 20 };
  assertEqual(sg.advanceSiege(ending, now, { force: true }).siege, null, 'no siege after the ending');
  // 被围郡成了腹地 / 天下归心：失手不失郡，进行中的反攻作罢（守城局在打时不动）
  const hub = { ...st, siege: { ...siege, fiefId: 'nanyang', dueAt: now + 1000 }, fiefWalls: { nanyang: 1, runan: 2 }, eventLog: [] };
  assertEqual(sg.canLoseFief(hub, 'nanyang'), false, 'hub fief cannot be lost');
  assertEqual(sg.canLoseFief(hub, 'runan'), true, 'exposed fief can be lost');
  assertEqual(sg.canLoseFief({ ...ending, fiefWalls: { bajun: 1 } }, 'bajun'), false, 'no fief loss after the ending');
  const relieved = sg.releaseStaleSiege(hub, now);
  assertEqual(`${relieved.siege}|${relieved.nextSiegeAt - now}|${relieved.eventLog[0]?.title}`, `null|${sg.SIEGE_INTERVAL_MS}|南阳围解`, 'siege on a hub fief is released');
  assertEqual(sg.releaseStaleSiege({ ...hub, activeBattle: { mode: 'land', lossGold: 0, conquest: { fiefId: 'nanyang', policyId: 'farming', stake: 0, kind: 'defend' } } }, now).siege?.fiefId, 'nanyang', 'no release while defending');
  const fine = { ...st, siege: { ...siege, dueAt: now + 1000 }, eventLog: [] };
  assertEqual(sg.releaseStaleSiege(fine, now), fine, 'exposed siege untouched');
  assertEqual(sg.releaseStaleSiege({ ...ending, siege: { ...siege, fiefId: 'bajun', dueAt: now + 1000 }, eventLog: [] }, now).siege, null, 'siege released at the ending');
  console.log('siege_rules_ok');
}

console.log('doudizhu_rules_ok');
