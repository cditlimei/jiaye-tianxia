/**
 * 叫地主后的身份标定：笨玩家（永远出最小可出牌）当地主 / 当农民时的胜率。
 * AI 的身份上下文与 DouDizhuGame.resolveSingleAiTurn 一致。用法: node scripts/doudizhu-role-sim.mjs [局数] [skill]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const GAMES = Number(process.argv[2] ?? 600);
const SKILL = process.argv[3] ?? 'veteran';
const compiled = ts.transpileModule(readFileSync('src/lib/doudizhu.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const modulePath = path.join(tmpdir(), `jiaye-doudizhu-role-${Date.now()}.mjs`);
writeFileSync(modulePath, compiled);
const ddz = await import(pathToFileURL(modulePath).href);
const next = (p) => (p + 1) % 3;

function play(landlord) {
  const deal = ddz.createDoudizhuDeal();
  const kitty = new Set(deal.landlordCards.map((c) => c.id));
  const hands = { 0: deal.hands[0].filter((c) => !kitty.has(c.id)), 1: deal.hands[1], 2: deal.hands[2] };
  hands[landlord] = ddz.sortCards([...hands[landlord], ...deal.landlordCards]);
  let current = landlord, passes = 0, last = null;
  for (let turn = 0; turn < 600; turn += 1) {
    const player = current;
    const target = last && last.player !== player ? last.combo : null;
    let cards;
    if (player === 0) cards = ddz.findFirstPlayable(hands[0], target);
    else {
      const others = [0, 1, 2].filter((i) => i !== player);
      const isLandlord = player === landlord;
      const teammate = isLandlord ? null : others.find((i) => i !== landlord);
      const teammateLeads = Boolean(last && teammate !== null && last.player === teammate);
      const pressure = isLandlord ? Math.min(...others.map((i) => hands[i].length)) : hands[landlord].length;
      cards = ddz.chooseAiPlay(hands[player], target, 'balanced', { landlordCards: pressure, teammateLeads, skill: SKILL, unseen: others.flatMap((i) => hands[i]) });
    }
    const combo = cards ? ddz.evaluateCards(cards) : null;
    if (cards && combo && ddz.canBeat(combo, target)) {
      const ids = new Set(cards.map((c) => c.id));
      hands[player] = hands[player].filter((c) => !ids.has(c.id));
      last = { player, combo }; passes = 0;
      if (hands[player].length === 0) return player;
    } else {
      passes += 1;
      if (passes >= 2) { passes = 0; last = null; }
    }
    current = next(player);
  }
  throw new Error('max_turns');
}

let landlordWins = 0, farmerWins = 0;
for (let i = 0; i < GAMES; i += 1) if (play(0) === 0) landlordWins += 1;
for (let i = 0; i < GAMES; i += 1) { const landlord = 1 + (i % 2); if (play(landlord) !== landlord) farmerWins += 1; }
console.log(`${SKILL} | 笨玩家当地主胜率 ${(100 * landlordWins / GAMES).toFixed(1)}% | 当农民胜率 ${(100 * farmerWins / GAMES).toFixed(1)}%`);
